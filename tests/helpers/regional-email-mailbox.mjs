import assert from 'node:assert/strict';

// This fixture replaces external email delivery. It never reads wallet storage.
export class RegionalEmailMailbox {
  messages = [];
  reads = 0;

  async deliver(message) {
    this.messages.push(message);
    return { ok: true, providerMessageId: `mailbox-${this.messages.length}` };
  }

  async intercept(route) {
    const lookup = route.request().postDataJSON();
    let delivered = null;
    for (const message of this.messages) {
      if (message.walletId !== lookup.walletId) continue;
      if (lookup.challengeId && message.challengeId !== lookup.challengeId) continue;
      if (lookup.challengeSubjectId && message.userId !== lookup.challengeSubjectId) continue;
      if (message.expiresAtMs <= Date.now()) continue;
      delivered = message;
    }
    assert.ok(delivered, 'The email provider must deliver the requested OTP before it is read');
    this.reads += 1;
    await route.fulfill({ json: { ok: true, otpCode: delivered.otpCode } });
  }

  evidence() {
    return {
      delivered: this.messages.length,
      reads: this.reads,
      scope:
        'Local email-provider fixture. Codes stay in memory. No development outbox or Console request supplies an OTP.',
    };
  }
}
