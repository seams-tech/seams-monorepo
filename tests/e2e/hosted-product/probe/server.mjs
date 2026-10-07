import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';

const gatewayOrigin = 'https://staging.api.wallet.seams.sh';
const bootId = randomUUID();
const maximumBodyBytes = 4 * 1024 * 1024;

function identity() {
  return {
    bootId,
    source: process.env.PROBE_SOURCE_REVISION,
    applicationId: process.env.CLOUDFLARE_APPLICATION_ID,
    instanceId: process.env.CLOUDFLARE_DURABLE_OBJECT_ID,
    location: process.env.CLOUDFLARE_LOCATION,
    region: process.env.CLOUDFLARE_REGION,
    country: process.env.CLOUDFLARE_COUNTRY_A2,
  };
}

function send(response, status, value) {
  response.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' });
  response.end(JSON.stringify(value));
}

async function readBody(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > maximumBodyBytes) throw new Error('Request body exceeds probe limit');
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

function forwardHeaders(input) {
  const headers = new Headers(input);
  for (const name of [...headers.keys()]) {
    if (
      name.startsWith('cf-') ||
      ['host', 'content-length', 'connection', 'accept-encoding', 'x-forwarded-for', 'x-real-ip'].includes(name)
    ) {
      headers.delete(name);
    }
  }
  return headers;
}

async function handle(request, response) {
  try {
    if (request.method === 'GET' && request.url === '/identity') {
      send(response, 200, identity());
      return;
    }
    if (request.method !== 'POST' || request.url !== '/forward') {
      send(response, 404, { error: 'Unknown probe operation' });
      return;
    }
    const input = await readBody(request);
    const target = new URL(input.url);
    if (target.origin !== gatewayOrigin || target.username || target.password) {
      throw new Error('Only the staging Gateway is admitted');
    }
    if (!['GET', 'POST', 'OPTIONS'].includes(input.method)) throw new Error('Unsupported method');
    if (input.bootId !== bootId) throw new Error('Probe restarted; reacquire its identity');
    const start = performance.now();
    const result = await fetch(target, {
      method: input.method,
      headers: forwardHeaders(input.headers),
      body: input.method === 'POST' ? Buffer.from(input.bodyBase64, 'base64') : undefined,
      redirect: 'manual',
      signal: AbortSignal.timeout(90_000),
    });
    const headersMs = performance.now() - start;
    const body = Buffer.from(await result.arrayBuffer());
    const headers = Object.fromEntries(result.headers);
    delete headers['content-encoding'];
    delete headers['content-length'];
    delete headers['transfer-encoding'];
    send(response, 200, {
      identity: identity(),
      status: result.status,
      headers,
      bodyBase64: body.toString('base64'),
      headersMs,
      completedMs: performance.now() - start,
    });
  } catch (error) {
    send(response, 502, { error: error instanceof Error ? error.message : 'Regional forwarding failed' });
  }
}

createServer(handle).listen(8080, '0.0.0.0');
