import { expect } from '@playwright/test';
import type { D1DatabaseLike } from '@seams/wallet-server/cloud-host';
import { readFile } from 'node:fs/promises';
import { unstable_splitSqlQuery } from 'wrangler';
import { handleRuntimeRelocationPreparation } from '../../packages/wallet-console-server-ts/src/walletPlacement/runtimePreparation';
import type { WalletRelocationRequest } from '../../packages/wallet-console-server-ts/src/walletPlacement/relocation';
import { parseTenantRuntimeWriterV1 } from '../../packages/wallet-console-server-ts/src/tenantDeployment/resourceVerification';
import { relocationWriterVersion } from '../fixtures/tenant-deployment/walletRelocationResources';

const PREPARE_URL = 'https://wallet-runtime.internal/internal/wallet-runtime/v1/relocation/prepare';

function prepareRequest(move: WalletRelocationRequest): Request {
  return new Request(PREPARE_URL, { method: 'POST', body: JSON.stringify(move) });
}

export async function verifyRuntimePreparation(database: D1DatabaseLike, move: WalletRelocationRequest) {
  const migration = await readFile(new URL(
    '../../../seams-wallet/packages/wallet-server/migrations/d1-signer/0056_wallet_authorization_history_import.sql',
    import.meta.url,
  ), 'utf8');
  const createTable = unstable_splitSqlQuery(migration).find(isReservationTable);
  if (!createTable) throw new Error('Missing production authorization reservation schema');
  await database.prepare(createTable).run();
  const addressMigration = await readFile(new URL(
    '../../../seams-wallet/packages/wallet-server/migrations/d1-signer/0077_wallet_object_addresses.sql',
    import.meta.url,
  ), 'utf8');
  for (const statement of unstable_splitSqlQuery(addressMigration)) await database.prepare(statement).run();
  const router = new AddressAllocator();
  const custody = { router, credential: 'fixture-private-credential' };
  const writer = parseTenantRuntimeWriterV1('walletRuntime',
    relocationWriterVersion(move.destination.databaseId, 'walletRuntime'),
    { accountId: move.destination.accountId, databaseId: move.destination.databaseId },
  );
  expect((await handleRuntimeRelocationPreparation(prepareRequest(move), database, move.wallet.namespace, writer, custody))?.status).toBe(409);
  const digest = await move.digest();
  await database.prepare(`INSERT INTO wallet_relocation_authorization_imports
    (namespace, org_id, project_id, env_id, wallet_id, move_id, request_digest_hex, source_generation, state)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'importing')`).bind(
    move.wallet.namespace, move.wallet.organizationId, move.wallet.projectId, move.wallet.environmentId,
    move.wallet.walletId, move.moveId, digest, move.expectedGeneration,
  ).run();
  const first = await handleRuntimeRelocationPreparation(prepareRequest(move), database, move.wallet.namespace, writer, custody);
  expect(first?.status).toBe(200);
  const receipt = await first!.json();
  expect(receipt).toEqual({ kind: 'runtime_prepared', requestDigest: digest, writer });
  expect(await (await handleRuntimeRelocationPreparation(prepareRequest(move), database, move.wallet.namespace, writer, custody))!.json()).toEqual(receipt);
  expect(await handleRuntimeRelocationPreparation(new Request('https://public.example/internal/wallet-runtime/v1/relocation/prepare'), database, move.wallet.namespace, writer, custody)).toBeNull();
  expect((await handleRuntimeRelocationPreparation(prepareRequest(move), database, 'another-namespace', writer, custody))?.status).toBe(409);
  await database.prepare("UPDATE wallet_relocation_authorization_imports SET request_digest_hex = ? WHERE wallet_id = ?")
    .bind('0'.repeat(64), move.wallet.walletId).run();
  expect((await handleRuntimeRelocationPreparation(prepareRequest(move), database, move.wallet.namespace, writer, custody))?.status).toBe(409);
  await database.prepare("UPDATE wallet_relocation_authorization_imports SET request_digest_hex = ?, state = 'activated' WHERE wallet_id = ?")
    .bind(digest, move.wallet.walletId).run();
  expect((await handleRuntimeRelocationPreparation(prepareRequest(move), database, move.wallet.namespace, writer, custody))?.status).toBe(409);
  expect(router.calls).toBe(1);
  const row = await database.prepare('SELECT ownership_generation FROM wallet_object_addresses WHERE wallet_id = ?')
    .bind(move.wallet.walletId).first<{ ownership_generation: number }>();
  expect(row?.ownership_generation).toBe(move.expectedGeneration + 1);
  return { runtimePreparation: {
    exactReservationRequired: true, destinationAddressesPersistedOnce: true, exactReplay: true, publicOriginExcluded: true,
    wrongScopeOrDigestRejected: true, activatedDestinationRejected: true,
  } };
}

function isReservationTable(sql: string): boolean {
  return /CREATE TABLE wallet_relocation_authorization_imports\s*\(/u.test(sql);
}

class AddressAllocator {
  calls = 0;
  async fetch(): Promise<Response> {
    this.calls += 1;
    return Response.json({ router: '11'.repeat(32), deriver_a: '22'.repeat(32),
      deriver_b: '33'.repeat(32), signing_worker: '44'.repeat(32) });
  }
}
