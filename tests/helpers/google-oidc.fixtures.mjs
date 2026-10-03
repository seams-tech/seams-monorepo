import { generateKeyPairSync, sign } from 'node:crypto';

export class GoogleOidcFixture {
  constructor() {
    const keys = generateKeyPairSync('rsa', { modulusLength: 2048 });
    this.privateKey = keys.privateKey;
    this.jwk = {
      ...keys.publicKey.export({ format: 'jwk' }),
      kid: 'regional-test',
      use: 'sig',
      alg: 'RS256',
    };
    this.originalFetch = globalThis.fetch;
  }
  install() {
    globalThis.fetch = this.fetch.bind(this);
  }
  restore() {
    globalThis.fetch = this.originalFetch;
  }
  fetch(input, init) {
    const url = typeof input === 'string' ? input : input.url;
    if (url === 'https://www.googleapis.com/oauth2/v3/certs') {
      return Promise.resolve(
        Response.json({ keys: [this.jwk] }, { headers: { 'cache-control': 'max-age=3600' } }),
      );
    }
    return this.originalFetch(input, init);
  }
  token(subject, overrides = {}) {
    const payload = {
      iss: 'https://accounts.google.com',
      sub: subject,
      aud: 'regional-google-test',
      exp: Math.floor(Date.now() / 1000) + 600,
      email: `${subject.toLowerCase()}@example.test`,
      email_verified: true,
      ...overrides,
    };
    const header = Buffer.from(JSON.stringify({ alg: 'RS256', kid: 'regional-test' })).toString(
      'base64url',
    );
    const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
    const message = `${header}.${body}`;
    return `${message}.${sign('RSA-SHA256', Buffer.from(message), this.privateKey).toString('base64url')}`;
  }
}
