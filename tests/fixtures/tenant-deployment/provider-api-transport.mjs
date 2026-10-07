import './allocated-regional-targets.mjs';
const nativeFetch = globalThis.fetch;
const fixtureOrigin = new URL(process.env.TENANT_PROVIDER_FIXTURE_ORIGIN);
if (fixtureOrigin.hostname !== '127.0.0.1')
  throw new Error('Provider fixture must run on loopback');

function fixtureFetch(input, init) {
  const url = new URL(input);
  if (url.origin !== 'https://api.cloudflare.com' || init.method !== 'GET') {
    throw new Error('Unexpected provider fixture request');
  }
  return nativeFetch(new URL(url.pathname, fixtureOrigin), init);
}

globalThis.fetch = fixtureFetch;
