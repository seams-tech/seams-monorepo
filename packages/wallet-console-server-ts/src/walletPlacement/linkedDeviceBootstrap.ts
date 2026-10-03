import {
  parseLinkedDeviceSessionRecordV1,
  computeLinkedDeviceSessionClaimDigestV1,
  WalletLifecycleLocator,
  type D1DatabaseLike,
  type LinkedDeviceSessionRecordV1,
} from '@seams/wallet-server/cloud-host';
import type { TenantRuntimeWriterV1 } from '../tenantDeployment/resourceVerification';
import type { WalletOwnershipKey } from './home';

type Scope = Pick<
  WalletOwnershipKey,
  'namespace' | 'organizationId' | 'projectId' | 'environmentId'
>;
const SCOPED_ID =
  'namespace = ?1 AND organization_id = ?2 AND project_id = ?3 AND environment_id = ?4 AND link_session_id = ?5';

export async function handleLinkedDeviceBootstrap(
  raw: Record<string, unknown>,
  database: D1DatabaseLike,
  scope: Scope,
  writer: TenantRuntimeWriterV1,
): Promise<Response> {
  const locator = WalletLifecycleLocator.parse({ kind: 'linked_device', value: raw.linkSessionId });
  const keys = [
    scope.namespace,
    scope.organizationId,
    scope.projectId,
    scope.environmentId,
    locator.value,
  ];
  if (raw.operation === 'read') {
    const record = await readRecord(database, keys);
    if (record?.state.state === 'claimed') {
      const allowed = await database
        .prepare(
          `SELECT 1 FROM wallet_routes route JOIN wallet_homes home
        USING(namespace, organization_id, project_id, environment_id, wallet_id)
        WHERE route.namespace = ?1 AND route.organization_id = ?2 AND route.project_id = ?3
          AND route.environment_id = ?4 AND route.value = ?5 AND route.kind = 'linked_device'
          AND home.account_id = ?6 AND home.database_id = ?7 AND home.state IN ('reserved', 'established')
          AND home.placement_state = 'active'`,
        )
        .bind(...keys, writer.resource.accountId, writer.resource.databaseId)
        .first();
      if (!allowed) return conflict();
    }
    return success(record);
  }
  const candidate = parseLinkedDeviceSessionRecordV1(raw.record);
  if (candidate.linkSessionId !== locator.value) return conflict();
  const qr = JSON.stringify(candidate.qrPayload);
  const json = JSON.stringify(candidate);
  const now = Date.now();
  if (raw.operation === 'create') {
    if (
      candidate.state.state !== 'displaying_qr' ||
      candidate.revision !== 1 ||
      candidate.qrPayload.expiresAtMs <= now
    )
      return conflict();
    await database
      .prepare(
        `INSERT INTO linked_device_bootstrap
      (namespace, organization_id, project_id, environment_id, link_session_id, state, qr_json, record_json, expires_at_ms)
      VALUES (?1, ?2, ?3, ?4, ?5, 'displaying_qr', ?6, ?7, ?8) ON CONFLICT DO NOTHING`,
      )
      .bind(...keys, qr, json, candidate.qrPayload.expiresAtMs)
      .run();
  } else if (raw.operation === 'claim') {
    if (
      candidate.state.state !== 'claimed' ||
      !candidate.claimTranscript ||
      candidate.revision !== 2 ||
      candidate.qrPayload.expiresAtMs <= now
    )
      return conflict();
    if (
      (await computeLinkedDeviceSessionClaimDigestV1(candidate.claimTranscript.value)) !==
      candidate.claimTranscript.digestB64u
    )
      return conflict();
    const walletId = candidate.claimTranscript.value.walletId;
    const admitted = await database
      .prepare(
        `SELECT 1 FROM wallet_homes
      WHERE namespace = ?1 AND organization_id = ?2 AND project_id = ?3 AND environment_id = ?4
        AND wallet_id = ?5 AND account_id = ?6 AND database_id = ?7 AND state IN ('reserved', 'established')
        AND placement_state = 'active'`,
      )
      .bind(...keys.slice(0, 4), walletId, writer.resource.accountId, writer.resource.databaseId)
      .first();
    if (!admitted) return conflict();
    await database.batch([
      database
        .prepare(
          `INSERT INTO wallet_routes
        (namespace, organization_id, project_id, environment_id, kind, value, wallet_id)
        SELECT boot.namespace, boot.organization_id, boot.project_id, boot.environment_id, 'linked_device', boot.link_session_id, home.wallet_id
        FROM linked_device_bootstrap boot JOIN wallet_homes home
          USING(namespace, organization_id, project_id, environment_id)
        WHERE boot.namespace = ?1 AND boot.organization_id = ?2 AND boot.project_id = ?3 AND boot.environment_id = ?4 AND boot.link_session_id = ?5
          AND boot.state = 'displaying_qr' AND boot.qr_json = ?6 AND boot.expires_at_ms > ?7
          AND home.wallet_id = ?8 AND home.account_id = ?9 AND home.database_id = ?10 AND home.state IN ('reserved', 'established')
          AND home.placement_state = 'active'
          AND NOT EXISTS (SELECT 1 FROM wallet_routes route WHERE route.namespace = ?1 AND route.organization_id = ?2 AND route.project_id = ?3 AND route.environment_id = ?4 AND route.kind = 'linked_device' AND route.value = ?5 AND route.wallet_id != ?8)
        ON CONFLICT DO NOTHING`,
        )
        .bind(...keys, qr, now, walletId, writer.resource.accountId, writer.resource.databaseId),
      database
        .prepare(
          `UPDATE linked_device_bootstrap SET state = 'claimed', record_json = ?6
        WHERE ${SCOPED_ID} AND state = 'displaying_qr' AND qr_json = ?7 AND expires_at_ms > ?8
        AND EXISTS (SELECT 1 FROM wallet_routes route JOIN wallet_homes home USING(namespace, organization_id, project_id, environment_id, wallet_id)
          WHERE route.namespace = ?1 AND route.organization_id = ?2 AND route.project_id = ?3 AND route.environment_id = ?4
            AND route.kind = 'linked_device' AND route.value = ?5 AND route.wallet_id = ?9
            AND home.account_id = ?10 AND home.database_id = ?11 AND home.state IN ('reserved', 'established')
            AND home.placement_state = 'active')`,
        )
        .bind(
          ...keys,
          json,
          qr,
          now,
          walletId,
          writer.resource.accountId,
          writer.resource.databaseId,
        ),
    ]);
    const selected = await readRecord(database, keys);
    return selected?.state.state === 'claimed' &&
      selected.claimTranscript?.value.walletId === walletId &&
      JSON.stringify(selected.qrPayload) === qr
      ? success(selected)
      : conflict();
  } else if (raw.operation === 'finish') {
    if (
      (candidate.state.state !== 'cancelled' && candidate.state.state !== 'expired') ||
      candidate.revision !== 2 ||
      candidate.claimTranscript
    )
      return conflict();
    if (candidate.state.state === 'expired' && candidate.qrPayload.expiresAtMs > now)
      return conflict();
    await database
      .prepare(
        `UPDATE linked_device_bootstrap SET state = ?6, record_json = ?7
      WHERE ${SCOPED_ID} AND state = 'displaying_qr' AND qr_json = ?8`,
      )
      .bind(...keys, candidate.state.state, json, qr)
      .run();
  } else return conflict();
  const selected = await readRecord(database, keys);
  if (!selected || JSON.stringify(selected.qrPayload) !== qr) return conflict();
  if (raw.operation === 'finish' && selected.state.state !== candidate.state.state)
    return conflict();
  return success(selected);
}
async function readRecord(
  database: D1DatabaseLike,
  keys: string[],
): Promise<LinkedDeviceSessionRecordV1 | null> {
  const row = await database
    .prepare(`SELECT record_json FROM linked_device_bootstrap WHERE ${SCOPED_ID}`)
    .bind(...keys)
    .first<{ record_json: string }>();
  return row ? parseLinkedDeviceSessionRecordV1(JSON.parse(row.record_json)) : null;
}
function conflict(): Response {
  return Response.json({ ok: false, code: 'home_conflict' }, { status: 409 });
}
function success(record: LinkedDeviceSessionRecordV1 | null): Response {
  return Response.json({ ok: true, record });
}
