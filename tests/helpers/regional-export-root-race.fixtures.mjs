import { setTimeout } from 'node:timers/promises';

export class PausedExportRootWrites {
  entered = Promise.withResolvers();
  released = Promise.withResolvers();
  arrivals = 0;

  constructor(port) {
    this.port = port;
  }

  async waitForWrites() {
    const controller = new AbortController();
    try {
      await Promise.race([
        this.entered.promise,
        setTimeout(15_000, null, { signal: controller.signal }).then(failRaceTimeout),
      ]);
    } finally {
      controller.abort();
    }
  }

  async pause() {
    this.arrivals++;
    if (this.arrivals === 2) this.entered.resolve();
    await this.released.promise;
  }

  async registerRecipientV1(input) {
    await this.pause();
    return this.port.registerRecipientV1(input);
  }

  async submitPackageV1(input) {
    await this.pause();
    return this.port.submitPackageV1(input);
  }

  readTransferV1(linkSessionId) {
    return this.port.readTransferV1(linkSessionId);
  }
}

function failRaceTimeout() {
  throw new Error('Both authenticated relay writes must reach the persistence barrier');
}
