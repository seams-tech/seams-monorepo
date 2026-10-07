import {
  parseWebAuthnSyncChallengeRecord,
  WalletLifecycleLocator,
  type D1DatabaseLike,
} from '@seams/wallet-server/cloud-host';
import type { TenantRuntimeWriterV1 } from '../tenantDeployment/resourceVerification';
import { walletHomeAssignmentFromRow } from './d1';
import { WalletPlacementError, type WalletOwnershipKey } from './home';

type Scope = Pick<
  WalletOwnershipKey,
  'namespace' | 'organizationId' | 'projectId' | 'environmentId'
>;

const MATCH_HOME = `FROM wallet_sync_challenges challenge
  JOIN wallet_passkey_claims claim ON claim.namespace = challenge.namespace
    AND claim.organization_id = challenge.organization_id AND claim.project_id = challenge.project_id
    AND claim.environment_id = challenge.environment_id AND claim.rp_id = challenge.rp_id
    AND claim.credential_id = ?6
  JOIN wallet_homes home ON home.namespace = claim.namespace
    AND home.organization_id = claim.organization_id AND home.project_id = claim.project_id
    AND home.environment_id = claim.environment_id AND home.wallet_id = claim.wallet_id
  WHERE challenge.namespace = ?1 AND challenge.organization_id = ?2 AND challenge.project_id = ?3
    AND challenge.environment_id = ?4 AND challenge.challenge_id = ?5
    AND challenge.consumed = 0 AND challenge.expires_at_ms > ?7
    AND (challenge.expected_wallet_id IS NULL OR challenge.expected_wallet_id = home.wallet_id)
    AND home.state IN ('reserved', 'established')`;

export async function handleSyncChallengeCommand(
  body: Record<string, unknown>,
  database: D1DatabaseLike,
  scope: Scope,
  writer: TenantRuntimeWriterV1,
): Promise<Response> {
  const scoped = [scope.namespace, scope.organizationId, scope.projectId, scope.environmentId];
  if (body.operation === 'create') {
    const record = parseWebAuthnSyncChallengeRecord(body.record);
    if (!record || record.expiresAtMs <= record.createdAtMs || record.expiresAtMs <= Date.now())
      throw new WalletPlacementError('invalid_input', 'Invalid sync challenge');
    WalletLifecycleLocator.parse({ kind: 'passkey_challenge', value: record.challengeId });
    const encoded = JSON.stringify(record);
    await database
      .prepare(
        `INSERT INTO wallet_sync_challenges
      (namespace, organization_id, project_id, environment_id, challenge_id, rp_id,
       expected_wallet_id, record_json, expires_at_ms)
      VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9) ON CONFLICT DO NOTHING`,
      )
      .bind(
        ...scoped,
        record.challengeId,
        record.rpId,
        record.expectedUserId ?? null,
        encoded,
        record.expiresAtMs,
      )
      .run();
    const existing = await database
      .prepare(
        `SELECT record_json FROM wallet_sync_challenges
      WHERE namespace = ?1 AND organization_id = ?2 AND project_id = ?3
        AND environment_id = ?4 AND challenge_id = ?5 AND consumed = 0`,
      )
      .bind(...scoped, record.challengeId)
      .first<string>('record_json');
    return Response.json(
      { ok: existing === encoded },
      { status: existing === encoded ? 200 : 409 },
    );
  }
  if (body.operation !== 'find' && body.operation !== 'consume')
    throw new WalletPlacementError('invalid_input', 'Invalid sync challenge operation');
  const challenge = WalletLifecycleLocator.parse({
    kind: 'passkey_challenge',
    value: body.challengeId,
  });
  if (
    typeof body.credentialIdB64u !== 'string' ||
    !body.credentialIdB64u ||
    body.credentialIdB64u.trim() !== body.credentialIdB64u
  )
    throw new WalletPlacementError('invalid_input', 'Invalid credential identity');
  const values = [...scoped, challenge.value, body.credentialIdB64u, Date.now()];
  if (body.operation === 'find') {
    const row = await database
      .prepare(`SELECT home.* ${MATCH_HOME}`)
      .bind(...values)
      .first<Record<string, unknown>>();
    return Response.json({ ok: true, assignment: row ? walletHomeAssignmentFromRow(row) : null });
  }
  const row = await database
    .prepare(
      `UPDATE wallet_sync_challenges SET consumed = 1
    WHERE namespace = ?1 AND organization_id = ?2 AND project_id = ?3
      AND environment_id = ?4 AND challenge_id = ?5 AND consumed = 0
      AND EXISTS (SELECT 1 ${MATCH_HOME} AND home.account_id = ?8 AND home.database_id = ?9)
    RETURNING record_json`,
    )
    .bind(...values, writer.resource.accountId, writer.resource.databaseId)
    .first<string>('record_json');
  return Response.json({ ok: true, record: row ? parseWebAuthnSyncChallengeRecord(row) : null });
}
