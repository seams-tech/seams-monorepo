import { serializeConsolePolicyRules } from './rules';
import type { ConsolePolicyRules } from './types';

const DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/u;

export class ConsolePolicyRulesDigest {
  private readonly reviewDigestBrand = true;

  private constructor(readonly value: string) {}

  static async fromRules(rules: ConsolePolicyRules): Promise<ConsolePolicyRulesDigest> {
    const rulesJson = JSON.stringify(serializeConsolePolicyRules(rules));
    const digest = new Uint8Array(
      await crypto.subtle.digest('SHA-256', new TextEncoder().encode(rulesJson)),
    );
    let hex = '';
    for (const byte of digest) hex += byte.toString(16).padStart(2, '0');
    return new ConsolePolicyRulesDigest(`sha256:${hex}`);
  }

  static parse(
    raw: unknown,
  ): { readonly ok: true; readonly digest: ConsolePolicyRulesDigest } | { readonly ok: false } {
    if (typeof raw !== 'string' || !DIGEST_PATTERN.test(raw)) return { ok: false };
    return { ok: true, digest: new ConsolePolicyRulesDigest(raw) };
  }
}
