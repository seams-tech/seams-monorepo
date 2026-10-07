import { setTimeout } from 'node:timers/promises';

export class ControlledEmailVerification {
  verifyRegistration(input) {
    return {
      ok: true,
      email: input.proofEmail,
      challengeSubjectId: input.providerSubject,
      challengeId: input.challengeId,
    };
  }

  readEnrollment() {
    return null;
  }
}

export class PausedEmailGrantStore {
  entered = Promise.withResolvers();
  released = Promise.withResolvers();

  constructor(store) {
    this.store = store;
  }

  async issueV1(record) {
    this.entered.resolve();
    await this.released.promise;
    return this.store.issueV1(record);
  }

  async waitForGrant() {
    const controller = new AbortController();
    try {
      await Promise.race([
        this.entered.promise,
        setTimeout(15_000, null, { signal: controller.signal }).then(failGrantTimeout),
      ]);
    } finally {
      controller.abort();
    }
  }
}

function failGrantTimeout() {
  throw new Error('Email verification must reach grant persistence');
}
