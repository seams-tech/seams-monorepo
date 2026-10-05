import { parseWalletId } from '@seams/wallet-server/cloud-host';
import { ConsoleRegistrationHomeAdmission } from '../../packages/wallet-console-server-ts/src/walletPlacement/registrationAdmission';
import { expect } from '@playwright/test';
import type { Miniflare } from 'miniflare';
import { parseTenantRuntimeWriterV1 } from '../../packages/wallet-console-server-ts/src/tenantDeployment/resourceVerification';
import {
  RegistrationSetupAllocation,
  WalletHomeCatalog,
  type WalletHome,
  type WalletOwnershipKey,
} from '../../packages/wallet-console-server-ts/src/walletPlacement/home';
import { WalletHomeServiceClient } from '../../packages/wallet-console-server-ts/src/walletPlacement/serviceClient';
import { relocationWriterVersion } from '../fixtures/tenant-deployment/walletRelocationResources';

type ReplyMode =
  | 'honest'
  | 'wrong_wallet'
  | 'wrong_writer'
  | 'invalid_generation'
  | 'wrong_status'
  | 'wrong_registration';

class ExecutionConsole {
  constructor(
    private readonly worker: Awaited<ReturnType<Miniflare['getWorker']>>,
    private readonly mode: ReplyMode,
  ) {}

  async fetch(request: Request): Promise<Response> {
    const sent = await request.json();
    if (this.mode === 'wrong_registration') sent.requestDigest = 'b'.repeat(64);
    const response = await this.worker.fetch(request.url, {
      method: request.method,
      headers: Object.fromEntries(request.headers),
      body: JSON.stringify(sent),
    });
    const body = await response.json();
    if (body.ok === true && body.authority) {
      switch (this.mode) {
        case 'wrong_wallet':
          body.authority.wallet.walletId = 'unrelated';
          break;
        case 'wrong_writer':
          body.authority.versionId = '00000000-0000-4000-8000-000000000000';
          break;
        case 'invalid_generation':
          body.authority.generation = 0;
          break;
        case 'honest':
        case 'wrong_status':
        case 'wrong_registration':
          break;
      }
    }
    return Response.json(body, { status: this.mode === 'wrong_status' ? 409 : response.status });
  }
}

async function executionClient(
  runtime: Miniflare,
  wallet: WalletOwnershipKey,
  home: WalletHome,
  homes: readonly WalletHome[],
  mode: ReplyMode,
) {
  const worker = await runtime.getWorker('ingress-b');
  const writer = parseTenantRuntimeWriterV1(
    'gateway',
    relocationWriterVersion(home.databaseId, 'gateway'),
    { accountId: home.accountId, databaseId: home.databaseId },
  );
  const client = new WalletHomeServiceClient(
    new ExecutionConsole(worker, mode),
    writer,
    {
      namespace: wallet.namespace,
      organizationId: wallet.organizationId,
      projectId: wallet.projectId,
      environmentId: wallet.environmentId,
    },
    WalletHomeCatalog.parse(homes),
  );
  return client;
}

export async function executionAdmissionClient(
  runtime: Miniflare,
  wallet: WalletOwnershipKey,
  home: WalletHome,
  homes: readonly WalletHome[],
  mode: ReplyMode,
) {
  return (await executionClient(runtime, wallet, home, homes, mode)).executionAuthority(wallet);
}

async function registrationRuntimeAuthority(
  runtime: Miniflare,
  wallet: WalletOwnershipKey,
  home: WalletHome,
  homes: readonly WalletHome[],
  mode: ReplyMode,
) {
  const worker = await runtime.getWorker('ingress-b');
  const walletId = parseWalletId(wallet.walletId);
  if (!walletId.ok) throw new Error('Invalid fixture wallet identity');
  const admission = new ConsoleRegistrationHomeAdmission({
    service: new ExecutionConsole(worker, mode),
    writer: parseTenantRuntimeWriterV1(
      'gateway',
      relocationWriterVersion(home.databaseId, 'gateway'),
      { accountId: home.accountId, databaseId: home.databaseId },
    ),
    scope: {
      namespace: wallet.namespace,
      organizationId: wallet.organizationId,
      projectId: wallet.projectId,
      environmentId: wallet.environmentId,
    },
    environmentKey: 'test',
    localResource: { accountId: home.accountId, databaseId: home.databaseId },
    catalogJson: JSON.stringify(homes),
    ingressRegion: home.region,
  });
  return { admission, walletId: walletId.value };
}

async function registrationRuntimeAdmission(
  runtime: Miniflare,
  wallet: WalletOwnershipKey,
  home: WalletHome,
  homes: readonly WalletHome[],
  ceremonyId: string,
  mode: ReplyMode,
) {
  const { admission, walletId } = await registrationRuntimeAuthority(
    runtime,
    wallet,
    home,
    homes,
    mode,
  );
  return admission.admitHome({ walletId, ceremonyId });
}

export async function establishedRuntimeAdmission(
  runtime: Miniflare,
  wallet: WalletOwnershipKey,
  home: WalletHome,
  homes: readonly WalletHome[],
) {
  const { admission, walletId } = await registrationRuntimeAuthority(
    runtime,
    wallet,
    home,
    homes,
    'honest',
  );
  return admission.admitEstablishedHome({ walletId });
}

export async function verifyRegistrationExecutionAdmission(
  runtime: Miniflare,
  wallet: WalletOwnershipKey,
  source: WalletHome,
  destination: WalletHome,
  homes: readonly WalletHome[],
) {
  const client = await executionClient(runtime, wallet, source, homes, 'honest');
  const reserved = await client.reserve({
    allocation: 'provided',
    wallet,
    ingressRegion: source.region,
    registrationId: 'registration-execution',
    requestDigest: 'a'.repeat(64),
    proposedRegistrationAllocation: RegistrationSetupAllocation.parse({
      ceremonyId: 'wrc_execution',
      preparationId: 'regprep_execution',
      walletAuthorityId: 'wallet-authority:execution',
      deviceId: 'device:execution',
      walletAuthMethodId: 'wallet-auth-method:execution',
    }),
  });
  if (!reserved.ok || reserved.assignment.state !== 'reserved')
    throw new Error('Registration reservation was not created');
  const assignment = reserved.assignment;
  expect(
    await registrationRuntimeAdmission(
      runtime,
      wallet,
      source,
      homes,
      assignment.registrationAllocation.ceremonyId,
      'honest',
    ),
  ).toEqual({ ok: true, ownershipGeneration: 1, purpose: 'registration' });
  await expect(
    registrationRuntimeAdmission(
      runtime,
      wallet,
      source,
      homes,
      assignment.registrationAllocation.ceremonyId,
      'invalid_generation',
    ),
  ).rejects.toThrow();

  expect(await establishedRuntimeAdmission(runtime, wallet, source, homes)).toMatchObject({
    ok: false,
    code: 'wallet_unavailable',
  });
  expect(await client.executionAuthority(wallet)).toEqual({
    ok: false,
    code: 'wallet_unavailable',
  });
  const admitted = await client.registrationExecutionAuthority(assignment);
  expect(admitted).toMatchObject({
    ok: true,
    authority: { purpose: 'registration', generation: 1, home: source },
  });
  expect(await client.registrationExecutionAuthority(assignment)).toEqual(admitted);
  const conflicting = await executionClient(runtime, wallet, source, homes, 'wrong_registration');
  expect(await conflicting.registrationExecutionAuthority(assignment)).toEqual({
    ok: false,
    code: 'wallet_unavailable',
  });

  const other = await executionClient(runtime, wallet, destination, homes, 'honest');
  expect(await other.registrationExecutionAuthority(assignment)).toEqual({
    ok: false,
    code: 'writer_home_mismatch',
  });
  await client.complete({
    wallet,
    home: assignment.home,
    registrationId: assignment.registrationId,
    requestDigest: assignment.requestDigest,
    outcome: 'cancelled',
  });
  expect(await client.registrationExecutionAuthority(assignment)).toEqual({
    ok: false,
    code: 'wallet_unavailable',
  });
  expect(
    await registrationRuntimeAdmission(
      runtime,
      wallet,
      source,
      homes,
      assignment.registrationAllocation.ceremonyId,
      'honest',
    ),
  ).toMatchObject({ ok: false, code: 'wallet_home_unavailable' });
  return {
    runtimeRegistrationChecksExecutionAdmission: true,
    registrationExecutionRequiresLiveReservation: true,
    ordinaryExecutionRejectsReservedWallet: true,
    cancelledReservationCannotExecute: true,
  };
}

export async function verifyExecutionAdmissionResponses(
  runtime: Miniflare,
  wallet: WalletOwnershipKey,
  home: WalletHome,
  homes: readonly WalletHome[],
) {
  for (const mode of [
    'wrong_wallet',
    'wrong_writer',
    'invalid_generation',
    'wrong_status',
  ] as const) {
    await expect(executionAdmissionClient(runtime, wallet, home, homes, mode)).rejects.toThrow();
  }
  const admitted = await executionAdmissionClient(runtime, wallet, home, homes, 'honest');
  if (!admitted.ok) throw new Error('Execution was not admitted');
  expect(admitted.authority.matches(wallet, 1)).toBe(true);
  expect(admitted.authority.matches(wallet, 2)).toBe(false);
  const client = await executionClient(runtime, wallet, home, homes, 'honest');
  const assignment = await client.find(wallet);
  if (!assignment || assignment.state !== 'established')
    throw new Error('Missing established wallet');
  expect(
    await registrationRuntimeAdmission(
      runtime,
      wallet,
      home,
      homes,
      assignment.registrationAllocation.ceremonyId,
      'honest',
    ),
  ).toEqual({ ok: true, ownershipGeneration: 1, purpose: 'ordinary' });

  expect(await establishedRuntimeAdmission(runtime, wallet, home, homes)).toEqual({
    ok: true,
    ownershipGeneration: 1,
    purpose: 'ordinary',
  });
  return {
    executionClientRejectsConflictingConsoleResponses: true,
    establishedRuntimeRequiresOrdinaryAuthority: true,
  };
}
