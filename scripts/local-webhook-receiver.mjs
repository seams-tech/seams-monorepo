import { createHmac, timingSafeEqual } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';

const secretFile = process.argv[2];
if (!secretFile) {
  throw new Error('Usage: node scripts/local-webhook-receiver.mjs <signing-secret-file>');
}
const secret = readFileSync(secretFile, 'utf8').trim();
if (!/^whsec_[A-Za-z0-9_-]+$/.test(secret)) {
  throw new Error('The signing secret file must contain the endpoint’s whsec_ secret.');
}

let failNextDelivery = false;

function failNext() {
  failNextDelivery = true;
  console.log('The next verified delivery will receive HTTP 500.');
}

function verifySignature(request, body) {
  const timestamp = request.headers['x-console-webhook-timestamp'];
  const signature = request.headers['x-console-webhook-signature'];
  if (typeof timestamp !== 'string' || !/^\d+$/.test(timestamp)) return false;
  if (Math.abs(Date.now() / 1000 - Number(timestamp)) > 300) return false;
  if (typeof signature !== 'string' || !/^v1=[a-f0-9]{64}$/.test(signature)) return false;

  const expected = createHmac('sha256', secret).update(`${timestamp}.`).update(body).digest();
  return timingSafeEqual(expected, Buffer.from(signature.slice(3), 'hex'));
}

async function receive(request, response) {
  if (request.method === 'GET' && request.url === '/health') {
    response.end('ready');
    return;
  }
  if (request.method !== 'POST' || request.url !== '/webhooks/seams') {
    response.writeHead(404).end('not found');
    return;
  }

  try {
    const chunks = [];
    let bytes = 0;
    for await (const chunk of request) {
      bytes += chunk.length;
      if (bytes > 1_048_576) {
        response.writeHead(413).end('payload too large');
        return;
      }
      chunks.push(chunk);
    }
    const body = Buffer.concat(chunks);
    if (!verifySignature(request, body)) {
      response.writeHead(401).end('invalid signature or timestamp');
      return;
    }
    const event = JSON.parse(body.toString('utf8'));
    if (
      event === null ||
      typeof event !== 'object' ||
      Array.isArray(event) ||
      typeof event.id !== 'string' ||
      typeof event.type !== 'string' ||
      typeof event.createdAt !== 'string' ||
      event.data === null ||
      typeof event.data !== 'object' ||
      Array.isArray(event.data)
    ) {
      response.writeHead(400).end('invalid event');
      return;
    }

    const status = failNextDelivery ? 500 : 200;
    failNextDelivery = false;
    console.log(
      JSON.stringify({
        receivedAt: new Date().toISOString(),
        signatureValid: true,
        status,
        event,
      }),
    );
    response.writeHead(status).end(status === 200 ? 'accepted' : 'intentional test failure');
  } catch {
    response.writeHead(400).end('invalid request');
  }
}

function listening() {
  console.log(`Listening on http://127.0.0.1:4404/webhooks/seams (PID ${process.pid})`);
  console.log(`To test failure and replay: kill -USR1 ${process.pid}`);
}

process.on('SIGUSR1', failNext);
createServer(receive).listen(4404, '127.0.0.1', listening);
