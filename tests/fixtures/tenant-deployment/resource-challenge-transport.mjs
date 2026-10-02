const nativeFetch = globalThis.fetch;
const provider = new URL(process.env.TENANT_CHALLENGE_PROVIDER);
const consoleOrigin = new URL(process.env.TENANT_CHALLENGE_CONSOLE);
if (provider.hostname !== '127.0.0.1' || consoleOrigin.hostname !== '127.0.0.1')
  throw new Error('Challenge fixtures require loopback');

function fixtureFetch(input, init) {
  const url = new URL(input);
  if (url.origin === provider.origin && url.pathname === '/oidc') return nativeFetch(url, init);
  if (url.origin === 'https://api.cloudflare.com' && url.pathname.endsWith('/query'))
    return nativeFetch(new URL('/query', provider), init);
  if (url.origin === 'https://api.cloudflare.com' && url.pathname.includes('/workers/scripts/'))
    return nativeFetch(new URL(url.pathname, provider), init);
  if (url.pathname === '/internal/tenant-deployment/v1/verify-resource')
    return nativeFetch(new URL(url.pathname, consoleOrigin), init);
  throw new Error('Unexpected challenge CLI network request');
}
globalThis.fetch = fixtureFetch;
