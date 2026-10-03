import { createRegionalRealGateway } from './regional-real-gateway.mjs';

let scenario;
process.on('message', dispatch);

async function dispatch(message) {
  try {
    const value = await execute(message);
    process.send({ id: message.id, ok: true, value }, message.kind === 'close' ? exit : undefined);
  } catch (error) {
    process.send({ id: message.id, ok: false, message: error.message, stack: error.stack });
  }
}

async function execute(message) {
  switch (message.kind) {
    case 'start':
      scenario = await createRegionalRealGateway(message.options);
      return { pid: process.pid };
    case 'request': {
      const route = new BrowserRoute(message.request);
      await scenario.gateways.get(message.region).intercept(route);
      return route.result;
    }
    case 'commit':
      return scenario.gateways
        .get(message.region)
        .commitRecoveryFinalization(new BrowserRoute(message.request));
    case 'verify-google-recovery':
      await scenario.verifyGoogleRecovery(message.home, message.ingress);
      return null;
    case 'verify-mixed-homes':
      await scenario.verifyMixedHomes(message.wallets, message.registrations);
      return null;
    case 'observations':
      return [...scenario.gateways].map(recoveryObservations);
    case 'restore-observations':
      for (const observation of message.observations) {
        const gateway = scenario.gateways.get(observation.region);
        gateway.requests = observation.requests;
        gateway.recoveryPrepare = observation.recoveryPrepare;
        gateway.recoveryFinalizationStatuses = observation.recoveryFinalizationStatuses;
      }
      return null;
    case 'close':
      if (scenario) await scenario.close();
      return null;
    default:
      throw new Error(`Unknown regional test command: ${message.kind}`);
  }
}

// Only test observations cross the restart. Production objects are rebuilt from D1.
function recoveryObservations([region, gateway]) {
  return {
    region,
    requests: gateway.requests,
    recoveryPrepare: gateway.recoveryPrepare,
    recoveryFinalizationStatuses: gateway.recoveryFinalizationStatuses,
  };
}

class BrowserRoute {
  constructor(request) {
    this.browserRequest = new BrowserRequest(request);
  }

  request() {
    return this.browserRequest;
  }

  async fulfill(response) {
    this.result = { kind: 'response', response };
  }

  async abort(reason) {
    this.result = { kind: 'aborted', reason };
  }
}

class BrowserRequest {
  constructor(request) {
    this.value = request;
  }
  url() {
    return this.value.url;
  }
  method() {
    return this.value.method;
  }
  headers() {
    return this.value.headers;
  }
  postData() {
    return this.value.body?.toString() ?? null;
  }
  postDataBuffer() {
    return this.value.body;
  }
}

function exit() {
  process.exit(0);
}
