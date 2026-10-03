import assert from 'node:assert/strict';
import { fork } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export async function createRestartingRegionalGateway(options) {
  const directory = await mkdtemp(join(options.localRoot, 'regional-d1-'));
  const scenario = new RestartingRegionalGateway(options, directory);
  try {
    await scenario.start('create');
    return scenario;
  } catch (error) {
    await scenario.close();
    throw error;
  }
}

class RestartingRegionalGateway {
  ready = Promise.resolve();
  restarts = [];

  constructor(options, directory) {
    this.options = options;
    this.directory = directory;
  }

  async start(mode) {
    this.process = new GatewayProcess();
    await this.process.call({
      kind: 'start',
      options: { ...this.options, databaseState: { directory: this.directory, mode } },
    });
  }

  async call(message) {
    await this.ready;
    return this.process.call(message);
  }

  async routeContext(context, region) {
    await context.unroute('http://127.0.0.1:4100/**');
    await context.route('http://127.0.0.1:4100/**', this.intercept.bind(this, region));
  }

  async intercept(region, route) {
    const result = await this.call({
      kind: 'request',
      region,
      request: serializeRequest(route.request()),
    });
    if (result.kind === 'aborted') await route.abort(result.reason);
    else await route.fulfill(result.response);
  }

  requestsFor(region, readinessRequests) {
    return {
      get: readinessRequests.get.bind(readinessRequests),
      post: this.post.bind(this, region),
    };
  }

  async post(region, url, options) {
    const result = await this.call({
      kind: 'request',
      region,
      request: {
        url,
        method: 'POST',
        headers: options.headers,
        body: Buffer.from(
          typeof options.data === 'string' ? options.data : JSON.stringify(options.data),
        ),
      },
    });
    assert.equal(result.kind, 'response');
    return new ApiResponse(result.response);
  }

  finalizationCommitter(region) {
    return this.commitAndRestart.bind(this, region);
  }

  async commitAndRestart(region, route) {
    const status = await this.call({
      kind: 'commit',
      region,
      request: serializeRequest(route.request()),
    });
    assert.equal(status, 200, 'Restart must follow a committed recovery');
    this.ready = this.restart(region);
    await this.ready;
    return status;
  }

  async restart(region) {
    const previous = this.process;
    await previous.drain();
    const observations = await previous.call({ kind: 'observations' });
    await previous.stop();
    await this.start('reopen');
    assert.notEqual(this.process.child.pid, previous.child.pid);
    await this.process.call({ kind: 'restore-observations', observations });
    this.restarts.push({
      ingress: region,
      oldPid: previous.child.pid,
      newPid: this.process.child.pid,
      oldProcessExit: previous.exitCode,
      databaseMode: 'reopen',
      afterCommitStatus: 200,
    });
  }

  async verifyGoogleRecovery(home, ingress) {
    await this.call({ kind: 'verify-google-recovery', home, ingress });
    await this.writeRestartEvidence([{ home, ingress }]);
  }

  async verifyMixedHomes(wallets, registrations) {
    await this.call({ kind: 'verify-mixed-homes', wallets, registrations });
    await this.writeRestartEvidence(wallets.map(recoveryRoute));
  }

  async writeRestartEvidence(routes) {
    assert.equal(this.restarts.length, routes.length);
    for (const [index, route] of routes.entries()) {
      const restart = this.restarts[index];
      assert.equal(restart.ingress, route.ingress);
      if (index > 0) assert.equal(restart.oldPid, this.restarts[index - 1].newPid);
    }
    await writeFile(
      join(this.options.output, 'restart-evidence.json'),
      JSON.stringify(
        {
          routes,
          restarts: this.restarts,
          scope:
            'Gateway/Console Node process and its D1 workerd stop after committed recovery, before the masked response reaches the client. A fresh process reopens the same four databases. Only test observations are restored in memory; Router roles remain running. This is an orderly restart after commit.',
        },
        null,
        2,
      ),
    );
  }

  async close() {
    await this.ready.catch(ignoreFailure);
    if (this.process) await this.process.stop();
    await rm(this.directory, { recursive: true, force: true });
  }
}

class GatewayProcess {
  nextId = 0;
  pending = new Map();
  exited = Promise.withResolvers();
  exitCode = null;

  constructor() {
    this.child = fork(new URL('./regional-gateway-process.mjs', import.meta.url), {
      execArgv: [],
      detached: true,
      serialization: 'advanced',
      stdio: ['ignore', 'inherit', 'inherit', 'ipc'],
    });
    this.child.on('message', this.receive.bind(this));
    this.child.on('exit', this.onExit.bind(this));
    this.child.on('error', this.onError.bind(this));
  }

  async call(message) {
    if (!this.child.connected) throw new Error('Regional Gateway process is disconnected');
    const id = this.nextId++;
    const result = Promise.withResolvers();
    const timeout = setTimeout(this.failRequest.bind(this, id), 30_000);
    this.pending.set(id, { ...result, timeout });
    this.child.send({ ...message, id });
    return result.promise;
  }

  receive(message) {
    const result = this.pending.get(message.id);
    if (!result) return;
    clearTimeout(result.timeout);
    this.pending.delete(message.id);
    if (message.ok) result.resolve(message.value);
    else result.reject(new Error(message.stack ?? message.message));
  }

  failRequest(id) {
    this.receive({ id, ok: false, message: 'Regional Gateway process request timed out' });
  }

  onError(error) {
    for (const id of this.pending.keys()) this.receive({ id, ok: false, message: error.message });
  }

  onExit(code, signal) {
    this.exitCode = code;
    this.onError(new Error(`Regional Gateway process exited (${code ?? signal})`));
    this.exited.resolve();
  }

  async drain() {
    await Promise.all([...this.pending.values()].map(pendingPromise));
  }

  async stop() {
    if (this.child.exitCode !== null || this.child.signalCode !== null) return;
    try {
      await this.drain();
      await this.call({ kind: 'close' });
      await this.exited.promise;
      assert.equal(this.exitCode, 0);
    } catch (error) {
      if (this.child.exitCode === null && this.child.signalCode === null) {
        process.kill(-this.child.pid, 'SIGKILL');
        await this.exited.promise;
      }
      throw error;
    }
  }
}

class ApiResponse {
  constructor(response) {
    this.response = response;
  }
  status() {
    return this.response.status;
  }
  ok() {
    return this.response.status >= 200 && this.response.status < 300;
  }
  async text() {
    return this.response.body.toString();
  }
  async json() {
    return JSON.parse(await this.text());
  }
}

function serializeRequest(request) {
  return {
    url: request.url(),
    method: request.method(),
    headers: request.headers(),
    body: request.postDataBuffer(),
  };
}

function pendingPromise(pending) {
  return pending.promise;
}

function recoveryRoute(wallet) {
  return { home: wallet.home, ingress: wallet.travel };
}

function ignoreFailure() {}
