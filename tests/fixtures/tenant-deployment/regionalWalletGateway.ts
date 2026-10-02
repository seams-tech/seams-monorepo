/// <reference types="@cloudflare/workers-types" />
import { WorkerEntrypoint } from 'cloudflare:workers';
import { parseWalletId, type D1DatabaseLike } from '@seams/wallet-server/cloud-host';
import { ConsoleRegistrationHomeAdmission } from '../../../packages/wallet-console-server-ts/src/walletPlacement/registrationAdmission';
import {
  ConsoleRegistrationSetupDispatcher,
  WalletRegionalDispatch,
  dispatchKnownWalletHome,
  type RegionalGatewayBindings,
} from '../../../packages/wallet-console-server-ts/src/walletPlacement/regionalDispatch';
import {
  WalletHome,
  regionForRegistrationIngress,
} from '../../../packages/wallet-console-server-ts/src/walletPlacement/home';
import { parseTenantRuntimeWriterV1 } from '../../../packages/wallet-console-server-ts/src/tenantDeployment/homeVerification';
import { gatewaySetupInput } from './registrationHomeAdmission';

type Env = RegionalGatewayBindings & {
  CONSOLE: { fetch(request: Request): Promise<Response> };
  SIGNER_DB: D1DatabaseLike;
  HOME_JSON: string;
  CATALOG_JSON: string;
};

async function handle(request: Request, env: Env, entry: 'ingress' | 'home'): Promise<Response> {
  // Authentication is a controlled fixture; reservation, dispatch and D1 are production implementations.
  if (request.headers.get('Authorization') !== 'Bearer test-application')
    return new Response(null, { status: 401 });
  const home = WalletHome.parse(JSON.parse(env.HOME_JSON));
  const authority = new ConsoleRegistrationHomeAdmission({
    service: env.CONSOLE,
    writer: parseTenantRuntimeWriterV1('gateway', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),
    scope: {
      namespace: 'shared',
      organizationId: 'owner',
      projectId: 'project',
      environmentId: 'test',
    },
    localResource: home,
    catalogJson: env.CATALOG_JSON,
    ingressRegion: regionForRegistrationIngress(request, 'US'),
  });
  const transport = new WalletRegionalDispatch(env, entry);
  const forwarded = await dispatchKnownWalletHome(request, authority, transport);
  if (forwarded) return forwarded;
  const body: unknown = await request.json();
  if (!body || typeof body !== 'object' || Array.isArray(body))
    return new Response(null, { status: 400 });
  if (new URL(request.url).pathname === '/wallets/register/setup') {
    if (!('operationId' in body) || typeof body.operationId !== 'string')
      return new Response(null, { status: 400 });
    const input = gatewaySetupInput({
      operationId: body.operationId,
      origin: 'https://wallet.test',
    });
    const original = new Request(request.url, {
      method: 'POST',
      headers: request.headers,
      body: JSON.stringify(body),
    });
    const dispatched = await new ConsoleRegistrationSetupDispatcher(
      authority,
      transport,
      original,
    ).dispatch(input);
    if (dispatched)
      return Response.json(dispatched.body, {
        status: dispatched.status,
        headers: dispatched.headers,
      });
    const admitted = await authority.reserve(input);
    if (!admitted.ok) return Response.json(admitted, { status: 409 });
    if (request.headers.get('x-test-response') === 'redirect')
      return Response.redirect('https://untrusted.invalid', 307);
    const reservation = admitted.reservation;
    await env.SIGNER_DB.prepare(
      'INSERT OR IGNORE INTO effects (ceremony_id, wallet_id, region) VALUES (?1, ?2, ?3)',
    )
      .bind(reservation.ceremonyId, reservation.walletId, home.region)
      .run();
    return Response.json({ ok: true, reservation, region: home.region, authenticatedAtHome: true });
  }
  if (!('registrationCeremonyId' in body) || typeof body.registrationCeremonyId !== 'string')
    return new Response(null, { status: 400 });
  const assignment = await authority.findHome({
    kind: 'ceremony',
    ceremonyId: body.registrationCeremonyId,
  });
  if (!assignment) return new Response(null, { status: 404 });
  const walletId = parseWalletId(assignment.wallet.walletId);
  if (!walletId.ok) throw new Error(walletId.error.message);
  const admitted = await authority.admitHome({
    ceremonyId: body.registrationCeremonyId,
    walletId: walletId.value,
  });
  if (!admitted.ok) return Response.json(admitted, { status: 409 });
  const completed = await authority.complete({
    ceremonyId: body.registrationCeremonyId,
    walletId: walletId.value,
    outcome: 'established',
  });
  if (!completed.ok) return Response.json(completed, { status: 409 });
  return Response.json({ ok: true, region: home.region, walletId: assignment.wallet.walletId });
}

export class WalletHomeGateway extends WorkerEntrypoint<Env> {
  override fetch(request: Request): Promise<Response> {
    return handle(request, this.env, 'home');
  }
}

export default {
  fetch(request: Request, env: Env): Promise<Response> {
    return handle(request, env, 'ingress');
  },
};
