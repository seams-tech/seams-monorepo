import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const [directory, checkout] = process.argv.slice(2);
assert.equal(process.argv.length, 4, 'Usage: prepare-yao.mjs DIRECTORY WALLET_CHECKOUT');
const scripts = path.join(checkout, 'crates/router-ab-cloudflare/scripts');
const { loadFixture, configureRouterJwt, buildEd25519ExecuteRequest } = await import(
  pathToFileURL(path.join(scripts, 'test-private-d1.mjs')).href
);
const { proxySource } = await import(
  pathToFileURL(path.join(scripts, 'yao-peer-disconnect-proxy.mjs')).href
);
const fixture = loadFixture();
configureRouterJwt(fixture);
const roles = ['router', 'deriver-a', 'deriver-b', 'signing-worker', 'tenant-root-control-plane'];
const configs = {};
for (const role of roles) {
  const config = JSON.parse(await readFile(path.join(directory, role + '.json'), 'utf8'));
  Object.assign(config.vars, fixture[role.replaceAll('-', '_') + '_env']);
  configs[role] = config;
}
const signingSecret = 'private-d1-router-signing-worker-ecdsa-auth';
configs.router.vars.ROUTER_AB_ROUTER_TO_SIGNING_WORKER_ECDSA_AUTH_SECRET = signingSecret;
configs['signing-worker'].vars.ROUTER_AB_ROUTER_TO_SIGNING_WORKER_ECDSA_AUTH_SECRET = signingSecret;
configs['signing-worker'].vars.ROUTER_AB_GATEWAY_TO_SIGNING_WORKER_PRESIGN_AUTH_SECRET =
  'private-d1-gateway-signing-worker-presign-auth';
for (const binding of configs.router.services) {
  if (binding.binding === 'DERIVER_A') binding.service = 'yao-execution-capture';
}
for (const binding of configs['deriver-a'].services) {
  if (binding.binding === 'DERIVER_B') binding.service = 'yao-connection-proxy';
}
for (const [role, config] of Object.entries(configs)) await save(role + '.json', config);
await writeFile(path.join(directory, 'yao-fixture.json'), JSON.stringify(fixture), { mode: 0o600 });
await writeFile(path.join(directory, 'yao-proxy.mjs'), proxySource);
await writeFile(
  path.join(directory, 'yao-capture.mjs'),
  `
let execution = null;
export default {
  async fetch(request, env) {
    const pathname = new URL(request.url).pathname;
    if (pathname === '/captured') return Response.json(execution);
    if (pathname.endsWith('/execute-pair') && execution === null) {
      execution = await request.clone().json();
    }
    return env.REAL_A.fetch(request);
  }
};
`,
);
await writeFile(
  path.join(directory, 'yao-order.mjs'),
  "export default { fetch() { return new Response('ok'); } };\n",
);
await save('proxy.json', {
  name: 'yao-connection-proxy',
  main: 'yao-proxy.mjs',
  compatibility_date: '2026-06-12',
  durable_objects: { bindings: [{ name: 'PROXY_OBJECT', class_name: 'YaoConnectionProxy' }] },
  migrations: [{ tag: 'v1', new_sqlite_classes: ['YaoConnectionProxy'] }],
  vars: { CONNECTION: 'disconnect' },
  services: [
    { binding: 'REAL_B', service: configs['deriver-b'].name },
    { binding: 'ORDER', service: 'yao-connection-order' },
  ],
});
await save('capture.json', {
  name: 'yao-execution-capture',
  main: 'yao-capture.mjs',
  compatibility_date: '2026-06-12',
  services: [{ binding: 'REAL_A', service: configs['deriver-a'].name }],
});
await save('order.json', {
  name: 'yao-connection-order',
  main: 'yao-order.mjs',
  compatibility_date: '2026-06-12',
});
await save('yao-inputs.json', {
  creation: fixture.tenant_root_creation.fresh,
  secondCreation: fixture.tenant_root_creation.second_tenant,
  internalCredential: fixture.router_env.ROUTER_AB_INTERNAL_SERVICE_AUTH_SECRET,
  gatewayCredential: fixture.router_env.ROUTER_AB_GATEWAY_TO_ROUTER_AUTH_SECRET,
  envelope: buildEd25519ExecuteRequest(fixture, 'activation', { custody_lineage_b64u: 'pending' }),
  secondEnvelope: buildEd25519ExecuteRequest(fixture, 'second_tenant_activation', {
    custody_lineage_b64u: 'pending',
  }),
});

async function save(name, value) {
  await writeFile(path.join(directory, name), JSON.stringify(value, null, 2) + '\n', {
    mode: 0o600,
  });
}
