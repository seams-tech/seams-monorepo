import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, relative, resolve } from 'node:path';

export async function observePresignAlarms(publicRoot, worker, observations) {
  const scriptPath = resolve(publicRoot, '.artifacts/r155b/presign-alarm-observer.mjs');
  const productionModule = JSON.stringify(relative(dirname(scriptPath), worker.scriptPath));
  await mkdir(dirname(scriptPath), { recursive: true });
  await writeFile(scriptPath, `
import { RouterAbSigningWorkerPresignSessionDurableObject as ProductionPresignHost } from ${productionModule};
export * from ${productionModule};
export { default } from ${productionModule};

export class RouterAbSigningWorkerPresignSessionDurableObject {
  constructor(state, env) {
    this.state = state;
    this.observer = env.ALARM_OBSERVER;
    this.production = new ProductionPresignHost(state, env);
  }

  fetch(request) {
    return this.production.fetch(request);
  }

  async alarm() {
    const startedAtMs = Date.now();
    const response = await this.production.alarm();
    const observation = {
      startedAtMs,
      status: response.status,
      nextAlarm: await this.state.storage.getAlarm(),
    };
    await this.observer.fetch('https://alarm-observer.test', {
      method: 'POST',
      body: JSON.stringify(observation),
    });
    return response;
  }
}
`);
  return {
    ...worker,
    scriptPath,
    serviceBindings: {
      ...worker.serviceBindings,
      ALARM_OBSERVER: recordAlarm.bind(null, observations),
    },
  };
}

async function recordAlarm(observations, request) {
  observations.push(await request.json());
  return new Response('recorded');
}
