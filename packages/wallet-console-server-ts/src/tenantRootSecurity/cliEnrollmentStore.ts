import {
  base64UrlDecode,
  base64UrlEncode,
  type D1DatabaseLike,
} from '@seams/wallet-server/cloud-host';
import { isPlainObject } from '@seams-internal/shared-ts/utils/validation';
import {
  decodeTenantRootIdentityWireV1,
  type TenantRootIdentityV1,
  type TenantRootDeriverRoleV1,
} from '@seams-internal/shared-ts/tenant-root';

export type EnrollmentApproval = {
  readonly identity: TenantRootIdentityV1;
  readonly actorUserId: string;
  readonly custodyLineageB64u: string;
  readonly challengeIdB64u: string;
  readonly envelopeB64u: string;
};
type Binding = {
  readonly id: string;
  readonly environmentId: string;
  readonly role: TenantRootDeriverRoleV1;
  readonly publicKeyB64u: string;
  readonly expiresAtMs: number;
};
export type CliEnrollment = Binding &
  (
    | { readonly kind: 'pending'; readonly approval?: never; readonly result?: never }
    | { readonly kind: 'denied'; readonly approval?: never; readonly result?: never }
    | { readonly kind: 'expired'; readonly approval?: never; readonly result?: never }
    | { readonly kind: 'approved'; readonly approval: EnrollmentApproval; readonly result?: never }
    | { readonly kind: 'completed'; readonly approval: EnrollmentApproval; readonly result: string }
  );

export function enrollmentText(value: unknown): string {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length > 1024 ||
    value.trim() !== value
  )
    throw new Error('Invalid enrollment field');
  return value;
}
export function enrollmentRole(value: unknown): TenantRootDeriverRoleV1 {
  if (value !== 'deriver_a' && value !== 'deriver_b') throw new Error('Invalid recovery key role');
  return value;
}
export function enrollmentBytes(value: unknown, length: number): string {
  const text = enrollmentText(value);
  const bytes = base64UrlDecode(text);
  if (bytes.length !== length || base64UrlEncode(bytes) !== text)
    throw new Error('Invalid enrollment bytes');
  return text;
}
export async function enrollmentSecretHash(secret: string): Promise<string> {
  enrollmentBytes(secret, 32);
  return base64UrlEncode(
    new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(secret))),
  );
}
function parseApproval(raw: unknown): EnrollmentApproval {
  if (typeof raw !== 'string') throw new Error('Missing enrollment approval');
  const value: unknown = JSON.parse(raw);
  if (!isPlainObject(value)) throw new Error('Invalid enrollment approval');
  const identity = decodeTenantRootIdentityWireV1(value.identity);
  if (!identity.ok) throw new Error('Invalid enrollment identity');
  return {
    identity: identity.value,
    actorUserId: enrollmentText(value.actorUserId),
    custodyLineageB64u: enrollmentText(value.custodyLineageB64u),
    challengeIdB64u: enrollmentText(value.challengeIdB64u),
    envelopeB64u: enrollmentText(value.envelopeB64u),
  };
}
function parseEnrollment(raw: unknown, nowMs: number): CliEnrollment | null {
  if (raw === null) return null;
  if (
    !isPlainObject(raw) ||
    typeof raw.expires_at_ms !== 'number' ||
    !Number.isSafeInteger(raw.expires_at_ms)
  )
    throw new Error('Invalid enrollment record');
  const binding: Binding = {
    id: enrollmentBytes(raw.id, 16),
    environmentId: enrollmentText(raw.environment_id),
    role: enrollmentRole(raw.role),
    publicKeyB64u: enrollmentBytes(raw.public_key, 32),
    expiresAtMs: raw.expires_at_ms,
  };
  if (binding.expiresAtMs <= nowMs) return { ...binding, kind: 'expired' };
  switch (raw.state) {
    case 'pending':
      return { ...binding, kind: 'pending' };
    case 'denied':
      return { ...binding, kind: 'denied' };
    case 'approved':
      return { ...binding, kind: 'approved', approval: parseApproval(raw.approval_json) };
    case 'completed':
      return {
        ...binding,
        kind: 'completed',
        approval: parseApproval(raw.approval_json),
        result: enrollmentText(raw.result_json),
      };
    default:
      throw new Error('Invalid enrollment state');
  }
}

export class CliEnrollmentStore {
  constructor(
    private readonly database: D1DatabaseLike,
    private readonly namespace: string,
  ) {}
  async start(input: Binding, secret: string, sourceHash: string, nowMs: number): Promise<void> {
    await this.database
      .prepare('DELETE FROM tenant_root_cli_enrollment WHERE namespace=?1 AND expires_at_ms<=?2')
      .bind(this.namespace, nowMs)
      .run();
    await this.database
      .prepare(
        `INSERT INTO tenant_root_cli_enrollment
      (namespace,id,secret_hash,environment_id,role,public_key,expires_at_ms,state,source_hash)
      SELECT ?1,?2,?3,?4,?5,?6,?7,'pending',?8 WHERE
      (SELECT COUNT(*) FROM tenant_root_cli_enrollment WHERE namespace=?1 AND source_hash=?8 AND expires_at_ms>?9)<5`,
      )
      .bind(
        this.namespace,
        input.id,
        await enrollmentSecretHash(secret),
        input.environmentId,
        input.role,
        input.publicKeyB64u,
        input.expiresAtMs,
        sourceHash,
        nowMs,
      )
      .run();
  }
  async read(id: string, nowMs: number): Promise<CliEnrollment | null> {
    return parseEnrollment(
      await this.database
        .prepare('SELECT * FROM tenant_root_cli_enrollment WHERE namespace=?1 AND id=?2')
        .bind(this.namespace, id)
        .first(),
      nowMs,
    );
  }
  async poll(id: string, secret: string, nowMs: number): Promise<CliEnrollment | null> {
    return parseEnrollment(
      await this.database
        .prepare(
          'UPDATE tenant_root_cli_enrollment SET next_poll_ms=?4+2000 WHERE namespace=?1 AND id=?2 AND secret_hash=?3 AND next_poll_ms<=?4 RETURNING *',
        )
        .bind(this.namespace, id, await enrollmentSecretHash(secret), nowMs)
        .first(),
      nowMs,
    );
  }
  async approve(
    request: Extract<CliEnrollment, { kind: 'pending' }>,
    approval: EnrollmentApproval,
    nowMs: number,
  ): Promise<void> {
    await this.database
      .prepare(
        "UPDATE tenant_root_cli_enrollment SET state='approved',approval_json=?3 WHERE namespace=?1 AND id=?2 AND state='pending' AND expires_at_ms>?4",
      )
      .bind(this.namespace, request.id, JSON.stringify(approval), nowMs)
      .run();
  }
  async complete(
    request: Extract<CliEnrollment, { kind: 'approved' }>,
    result: string,
    nowMs: number,
  ): Promise<void> {
    await this.database
      .prepare(
        "UPDATE tenant_root_cli_enrollment SET state='completed',result_json=?3 WHERE namespace=?1 AND id=?2 AND state='approved' AND expires_at_ms>?4",
      )
      .bind(this.namespace, request.id, result, nowMs)
      .run();
  }
  async deny(request: Extract<CliEnrollment, { kind: 'pending' }>, nowMs: number): Promise<void> {
    await this.database
      .prepare(
        "UPDATE tenant_root_cli_enrollment SET state='denied' WHERE namespace=?1 AND id=?2 AND state='pending' AND expires_at_ms>?3",
      )
      .bind(this.namespace, request.id, nowMs)
      .run();
  }
}
