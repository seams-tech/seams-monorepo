import { createECDH } from 'node:crypto';
import { setTimeout } from 'node:timers/promises';

export function deliveryRecipient() {
  const recipient = createECDH('prime256v1');
  recipient.generateKeys();
  return recipient.getPublicKey().toString('base64url');
}

export class ConcurrentTargetPreparationFixture {
  barrier = Promise.withResolvers();
  created = 0;
  constructor(planner) {
    this.planner = planner;
  }

  async createTargetPreparationV1(input) {
    this.created++;
    if (this.created === 2) this.barrier.resolve();
    await this.barrier.promise;
    return this.planner.createTargetPreparationV1(input);
  }
}

export class PausedTargetPreparationFixture {
  entered = Promise.withResolvers();
  released = Promise.withResolvers();

  constructor(planner) {
    this.planner = planner;
  }

  async createTargetPreparationV1(input) {
    const preparation = await this.planner.createTargetPreparationV1(input);
    this.entered.resolve();
    await this.released.promise;
    return preparation;
  }

  async waitForPreparation() {
    const controller = new AbortController();
    try {
      await Promise.race([
        this.entered.promise,
        setTimeout(15_000, null, { signal: controller.signal }).then(failPreparationTimeout),
      ]);
    } finally {
      controller.abort();
    }
  }
}

function failPreparationTimeout() {
  throw new Error('Target preparation must reach the persistence barrier');
}
