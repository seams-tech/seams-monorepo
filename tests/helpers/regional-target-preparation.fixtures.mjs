import { createECDH } from 'node:crypto';

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
