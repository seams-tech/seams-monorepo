const nativeFetch = globalThis.fetch;
const provider = new URL(process.env.FRONTEND_PROVIDER_ORIGIN);
if (provider.hostname !== '127.0.0.1') throw new Error('Pages fixture requires loopback');

function fixtureFetch(input, init) {
  const url = new URL(input);
  let project;
  switch (url.origin) {
    case 'https://test.sign.seams.sh':
      project = 'fixture-testnet';
      break;
    case 'https://sign.seams.sh':
      project = 'fixture-mainnet';
      break;
    default:
      throw new Error(`Unexpected frontend network request: ${url.origin}`);
  }
  return nativeFetch(new URL(`/${project}${url.pathname}`, provider), init);
}

globalThis.fetch = fixtureFetch;
