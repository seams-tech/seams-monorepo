import {
  base64UrlDecode,
  base64UrlEncode,
  queryD1One,
  sha256Bytes,
  type D1DatabaseLike,
} from '@seams/wallet-server/cloud-host';
import { isPlainObject } from '@seams-internal/shared-ts/utils/validation';
import {
  encodeTenantRootIdentityV1,
  type TenantRootIdentityV1,
  type TenantRootDeriverRoleV1,
} from '@seams-internal/shared-ts/tenant-root';
import type {
  TenantRootCustodyControlPlaneV1,
  TenantRootCustodyStoreV1,
  TenantRootServedArtifactV1,
} from './custodyService';
import { TenantRootCustodyControlPlaneClientV1 } from './tenantRootCustodyControlPlaneClient';
import { parseTenantRootRegisteredManifestV1 } from './tenantRootRestoreManifestClient';

type Fetcher = { fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> };
type Role = 'a' | 'b';
type Pair<T> = { readonly a: T; readonly b: T };
type Step =
  | 'commands'
  | 'manifest'
  | 'closed'
  | `${'prepare' | 'contribute' | 'derive' | 'prove' | 'package'}_${Role}`;
type Commands = {
  readonly command_a_b64u: string;
  readonly command_b_b64u: string;
  readonly lifecycle_revision: number;
  readonly issued_at_ms: number;
  readonly expires_at_ms: number;
};
type PackageMetadata = {
  readonly kind: 'packaged';
  readonly package_digest: string;
  readonly descriptor: string;
  readonly package_length: number;
};
type Manifest = ReturnType<typeof parseManifest>;

type Options = {
  readonly database: D1DatabaseLike;
  readonly namespace: string;
  readonly identity: TenantRootIdentityV1;
  readonly identityDigestB64u: string;
  readonly custodyLineageB64u: string;
  readonly custody: TenantRootCustodyStoreV1;
  readonly controlPlaneFetch: Fetcher;
  readonly derivers: Pair<Fetcher>;
  readonly internalServiceAuthSecret: string;
  readonly certificates: {
    readonly a: readonly string[];
    readonly b: readonly string[];
    readonly controlPlane: readonly string[];
  };
};

/** Each native result is journaled before the next protocol step can use it. */
export class TenantRootRecoveryGenerationV1
  extends TenantRootCustodyControlPlaneClientV1
  implements TenantRootCustodyControlPlaneV1
{
  constructor(private readonly generation: Options) {
    super(generation);
  }

  async createRecoverySet(
    input: Parameters<TenantRootCustodyControlPlaneV1['createRecoverySet']>[0],
  ): ReturnType<TenantRootCustodyControlPlaneV1['createRecoverySet']> {
    const state = await this.generation.custody.readState();
    const identityBytes = encodeTenantRootIdentityV1(this.generation.identity);
    if (
      base64UrlEncode(await sha256Bytes(identityBytes)) !== this.generation.identityDigestB64u ||
      state.orgId !== this.generation.identity.orgId
    )
      throw new Error('Recovery identity scope mismatch');
    if (
      state.identityDigestB64u !== this.generation.identityDigestB64u ||
      state.custodyLineageB64u !== this.generation.custodyLineageB64u
    )
      throw new Error('Recovery custody scope mismatch');
    const a = state.stagedRecipients.find(isRoleA);
    const b = state.stagedRecipients.find(isRoleB);
    if (
      a === undefined ||
      b === undefined ||
      a.recipientFingerprintB64u !== input.recipientPair.deriverAFingerprintB64u ||
      b.recipientFingerprintB64u !== input.recipientPair.deriverBFingerprintB64u ||
      a.recipientFingerprintB64u === b.recipientFingerprintB64u
    )
      throw new Error('Recovery recipients are not the enrolled pair');
    const set = input.recoverySetId;
    const commands = await this.step(
      set,
      'commands',
      this.generation.controlPlaneFetch,
      'command',
      {
        kind: 'generate',
        identity_b64u: base64UrlEncode(identityBytes),
        custody_lineage_b64u: state.custodyLineageB64u,
        expected_lifecycle_revision: state.lifecycleRevision,
        recovery_set_id_b64u: set,
        recipient_a_b64u: a.recipientPublicKeyB64u,
        recipient_b_b64u: b.recipientPublicKeyB64u,
      },
      parseCommands,
    );
    const command = { a: commands.command_a_b64u, b: commands.command_b_b64u };
    const preparedA = await this.step(
      set,
      'prepare_a',
      this.generation.derivers.a,
      'reshare',
      { kind: 'prepare', command: command.a },
      parsePrepared,
    );
    const preparedB = await this.step(
      set,
      'prepare_b',
      this.generation.derivers.b,
      'reshare',
      { kind: 'prepare', command: command.b },
      parsePrepared,
    );
    const commitments = { a: preparedA.commitment, b: preparedB.commitment };
    const contributionA = await this.step(
      set,
      'contribute_a',
      this.generation.derivers.a,
      'reshare',
      { kind: 'contribute', command: command.a, commitments },
      parseContributed,
    );
    const contributionB = await this.step(
      set,
      'contribute_b',
      this.generation.derivers.b,
      'reshare',
      { kind: 'contribute', command: command.b, commitments },
      parseContributed,
    );
    const roundA = { commitments, peer_contribution: contributionB.contribution };
    const roundB = { commitments, peer_contribution: contributionA.contribution };
    const derivedA = await this.step(
      set,
      'derive_a',
      this.generation.derivers.a,
      'reshare',
      { kind: 'derive', command: command.a, round: roundA },
      parseDerived,
    );
    const derivedB = await this.step(
      set,
      'derive_b',
      this.generation.derivers.b,
      'reshare',
      { kind: 'derive', command: command.b, round: roundB },
      parseDerived,
    );
    const proofA = await this.step(
      set,
      'prove_a',
      this.generation.derivers.a,
      'reshare',
      { kind: 'prove', command: command.a, round: roundA, peer_commitment: derivedB.commitment },
      parseProved,
    );
    const proofB = await this.step(
      set,
      'prove_b',
      this.generation.derivers.b,
      'reshare',
      { kind: 'prove', command: command.b, round: roundB, peer_commitment: derivedA.commitment },
      parseProved,
    );
    const packageA = await this.step(
      set,
      'package_a',
      this.generation.derivers.a,
      'reshare',
      {
        kind: 'package',
        command: command.a,
        round: roundA,
        evidence_a: proofA.evidence,
        evidence_b: proofB.evidence,
      },
      parsePackage,
    );
    const packageB = await this.step(
      set,
      'package_b',
      this.generation.derivers.b,
      'reshare',
      {
        kind: 'package',
        command: command.b,
        round: roundB,
        evidence_a: proofA.evidence,
        evidence_b: proofB.evidence,
      },
      parsePackage,
    );
    if (packageA.descriptor !== packageB.descriptor) throw new Error('Recovery descriptors differ');
    let manifest = await this.read(set, 'manifest', parseManifest);
    if (manifest === null) {
      const bytesA = await this.download(set, command.a, 'a');
      const bytesB = await this.download(set, command.b, 'b');
      requirePackage(bytesA, packageA.package_digest, packageA.package_length);
      requirePackage(bytesB, packageB.package_digest, packageB.package_length);
      manifest = await this.step(
        set,
        'manifest',
        this.generation.controlPlaneFetch,
        'manifest',
        {
          generation_command_b64u: command.a,
          evidence_a_b64u: proofA.evidence,
          evidence_b_b64u: proofB.evidence,
          package_a_b64u: bytesA.artifactB64u,
          package_b_b64u: bytesB.artifactB64u,
          deriver_a_certificate_chain: this.generation.certificates.a,
          deriver_b_certificate_chain: this.generation.certificates.b,
          control_plane_certificate_chain: this.generation.certificates.controlPlane,
        },
        parseManifest,
      );
    }
    await this.requireManifest(set, manifest);
    const verified = manifest.verified;
    if (
      verified.stableRootCommitmentB64u !== state.rootCommitmentB64u ||
      verified.deriverA.recipientFingerprintB64u !== a.recipientFingerprintB64u ||
      verified.deriverB.recipientFingerprintB64u !== b.recipientFingerprintB64u ||
      verified.deriverAPackageDigestB64u !== packageA.package_digest ||
      verified.deriverBPackageDigestB64u !== packageB.package_digest
    )
      throw new Error('Verified recovery manifest differs from the pending set');
    await this.requireOpen(set);
    const oldSet = state.backup.status === 'replacing' ? state.backup.active.recoverySetId : null;
    const oldPackagesDestroyed = await this.cleanupPreviousRecoverySets(oldSet);
    return {
      set: {
        recoverySetId: set,
        recipientPair: input.recipientPair,
        createdAt: verified.artifactCreatedAtIso,
        rootCommitmentFingerprintB64u: verified.stableRootCommitmentB64u,
        deriverAPackage: { kind: 'never_downloaded' },
        deriverBPackage: { kind: 'never_downloaded' },
        manifest: { kind: 'never_downloaded' },
      },
      verification: {
        deriverAPackageSignatureVerified: true,
        deriverBPackageSignatureVerified: true,
        descriptorContinuityVerified: true,
        manifestSignatureVerified: true,
        packageDigestsVerified: true,
        persistenceReceipts: {
          deriverA: await digestJson(packageA),
          deriverB: await digestJson(packageB),
        },
      },
      oldPackagesDestroyed,
    };
  }

  async openRolePackage(
    input: Parameters<TenantRootCustodyControlPlaneV1['openRolePackage']>[0],
  ): Promise<TenantRootServedArtifactV1> {
    const manifest = await this.read(input.recoverySetId, 'manifest', parseManifest);
    const commands = await this.read(input.recoverySetId, 'commands', parseCommands);
    if (manifest === null || commands === null) throw new Error('Recovery set is incomplete');
    await this.requireManifest(input.recoverySetId, manifest);
    const role = input.role === 'deriver_a' ? 'a' : 'b';
    const result = await this.download(
      input.recoverySetId,
      role === 'a' ? commands.command_a_b64u : commands.command_b_b64u,
      role,
    );
    requirePackage(
      result,
      role === 'a'
        ? manifest.verified.deriverAPackageDigestB64u
        : manifest.verified.deriverBPackageDigestB64u,
      role === 'a'
        ? manifest.verified.deriverAPackageLength
        : manifest.verified.deriverBPackageLength,
    );
    return result;
  }

  async readManifest(input: {
    readonly recoverySetId: string;
  }): Promise<TenantRootServedArtifactV1> {
    await this.requireOpen(input.recoverySetId);
    const manifest = await this.read(input.recoverySetId, 'manifest', parseManifest);
    if (manifest === null) throw new Error('Recovery manifest is unavailable');
    await this.requireManifest(input.recoverySetId, manifest);
    return {
      artifactB64u: manifest.manifest_b64u,
      contentDigestB64u: manifest.verified.manifestDigestB64u,
    };
  }

  private async cleanupPreviousRecoverySets(previousSet: string | null): Promise<boolean> {
    const rows = await this.generation.database
      .prepare(
        `SELECT recovery_set_id FROM tenant_root_security_recovery_generation
       WHERE namespace=?1 AND org_id=?2 AND identity_digest_b64u=?3 AND custody_lineage_b64u=?4 AND step='closed'`,
      )
      .bind(
        this.generation.namespace,
        this.generation.identity.orgId,
        this.generation.identityDigestB64u,
        this.generation.custodyLineageB64u,
      )
      .all();
    const sets = new Set<string>();
    if (previousSet !== null) sets.add(previousSet);
    if (!Array.isArray(rows.results)) throw new Error('Could not read recovery cleanup journal');
    for (const row of rows.results) {
      const value = record(row);
      if (typeof value.recovery_set_id !== 'string') throw new Error('Invalid closed recovery set');
      sets.add(value.recovery_set_id);
    }
    let complete = true;
    for (const recoverySetId of sets) {
      try {
        const result = await this.cleanupPendingRecoverySet({ recoverySetId });
        if (result.cleanupReceipts === null) complete = false;
      } catch {
        complete = false;
      }
    }
    return complete;
  }

  async cleanupPendingRecoverySet(input: {
    readonly recoverySetId: string;
  }): ReturnType<TenantRootCustodyControlPlaneV1['cleanupPendingRecoverySet']> {
    const set = input.recoverySetId;
    await this.generation.database
      .prepare(
        `INSERT OR IGNORE INTO tenant_root_security_recovery_generation VALUES (?1,?2,?3,?4,?5,'closed',?6,'{}')`,
      )
      .bind(...this.scope(set), await digestJson({}))
      .run();
    const commands = await this.read(set, 'commands', parseCommands);
    if (commands === null)
      return {
        cleanupReceipts: {
          deriverA: await digestJson({
            recoverySetId: set,
            role: 'deriver_a',
            state: 'never_dispatched',
          }),
          deriverB: await digestJson({
            recoverySetId: set,
            role: 'deriver_b',
            state: 'never_dispatched',
          }),
        },
      };
    const [a, b] = await Promise.allSettled([
      this.destroy(set, commands.command_a_b64u, 'a'),
      this.destroy(set, commands.command_b_b64u, 'b'),
    ]);
    return {
      cleanupReceipts:
        a.status !== 'fulfilled' || b.status !== 'fulfilled' || a.value === null || b.value === null
          ? null
          : { deriverA: a.value, deriverB: b.value },
    };
  }

  async retireSourceLineage(
    input: Parameters<TenantRootCustodyControlPlaneV1['retireSourceLineage']>[0],
  ): ReturnType<TenantRootCustodyControlPlaneV1['retireSourceLineage']> {
    const state = await this.generation.custody.readState();
    if (
      state.identityDigestB64u !== this.generation.identityDigestB64u ||
      state.custodyLineageB64u !== this.generation.custodyLineageB64u ||
      state.orgId !== this.generation.identity.orgId
    )
      throw new Error('Source retirement scope mismatch');
    const destination = encoded(input.destinationActivationReceiptDigestB64u, 32);
    const response = await this.post(this.generation.controlPlaneFetch, 'command', {
      kind: 'retire_source',
      identity_digest_b64u: state.identityDigestB64u,
      custody_lineage_b64u: state.custodyLineageB64u,
      expected_lifecycle_revision: state.lifecycleRevision,
      destination_activation_receipt_digest_b64u: destination,
    });
    const commands = record(await response.json());
    const a = encoded(commands.command_a_b64u, null);
    const b = encoded(commands.command_b_b64u, null);
    if (commands.lifecycle_revision !== state.lifecycleRevision)
      throw new Error('Source retirement revision mismatch');
    const results = await Promise.allSettled([
      this.retireRole('a', a, destination),
      this.retireRole('b', b, destination),
    ]);
    for (const result of results) {
      if (result.status === 'rejected') throw result.reason;
    }
    // Local deletion cannot prove destruction of retained provider backups.
    return {
      destructionReceipts: { deriverA: null, deriverB: null },
      decryptProbeReceipts: { deriverA: null, deriverB: null },
      credentialRevocationReceipt: null,
      endpointCanaryReceipt: null,
    };
  }

  private async retireRole(role: Role, command: string, destination: string): Promise<void> {
    const response = await this.post(this.generation.derivers[role], 'retire-source', {
      retirement_command_b64u: command,
    });
    const value = record(await response.json());
    if (
      value.status !== 'local_material_removed' ||
      value.provider_retirement !== 'unverified' ||
      value.role !== nativeRole(role) ||
      value.identity_digest_b64u !== this.generation.identityDigestB64u ||
      value.custody_lineage_b64u !== this.generation.custodyLineageB64u ||
      value.destination_activation_receipt_digest_b64u !== destination ||
      typeof value.retired_at_ms !== 'number' ||
      !Number.isSafeInteger(value.retired_at_ms) ||
      value.retired_at_ms <= 0
    )
      throw new Error('Source retirement response scope mismatch');
  }

  private scope(set: string): readonly string[] {
    return [
      this.generation.namespace,
      this.generation.identity.orgId,
      this.generation.identityDigestB64u,
      this.generation.custodyLineageB64u,
      set,
    ];
  }

  private async read<T>(set: string, step: Step, parse: (value: unknown) => T): Promise<T | null> {
    const row = await queryD1One(
      this.generation.database,
      `SELECT response_json FROM tenant_root_security_recovery_generation WHERE namespace=?1 AND org_id=?2 AND identity_digest_b64u=?3 AND custody_lineage_b64u=?4 AND recovery_set_id=?5 AND step=?6`,
      [...this.scope(set), step],
    );
    if (row === null) return null;
    if (typeof row.response_json !== 'string') throw new Error('Invalid recovery journal record');
    return parse(JSON.parse(row.response_json));
  }

  private async requireOpen(set: string): Promise<void> {
    const row = await this.read(set, 'closed', record);
    if (row !== null) throw new Error('Recovery cleanup has closed this set');
  }

  private async step<T>(
    set: string,
    step: Step,
    target: Fetcher,
    path: string,
    body: unknown,
    parse: (value: unknown) => T,
  ): Promise<T> {
    await this.requireOpen(set);
    const requestDigest = await digestJson(body);
    const cached = await this.read(set, step, parse);
    if (cached !== null) {
      await this.requireRequest(set, step, requestDigest);
      return cached;
    }
    const response = await this.post(target, path, body);
    const text = await response.text();
    if (text.length > 256 * 1024) throw new Error('Recovery response exceeds its limit');
    parse(JSON.parse(text));
    await this.generation.database
      .prepare(
        `INSERT OR IGNORE INTO tenant_root_security_recovery_generation SELECT ?1,?2,?3,?4,?5,?6,?7,?8 WHERE NOT EXISTS (SELECT 1 FROM tenant_root_security_recovery_generation WHERE namespace=?1 AND org_id=?2 AND identity_digest_b64u=?3 AND custody_lineage_b64u=?4 AND recovery_set_id=?5 AND step='closed')`,
      )
      .bind(...this.scope(set), step, requestDigest, text)
      .run();
    await this.requireOpen(set);
    const stored = await this.read(set, step, parse);
    if (stored === null) throw new Error('Recovery progress was not persisted');
    await this.requireRequest(set, step, requestDigest);
    return stored;
  }

  private async requireRequest(set: string, step: Step, digest: string): Promise<void> {
    const row = await queryD1One(
      this.generation.database,
      `SELECT request_digest FROM tenant_root_security_recovery_generation WHERE namespace=?1 AND org_id=?2 AND identity_digest_b64u=?3 AND custody_lineage_b64u=?4 AND recovery_set_id=?5 AND step=?6`,
      [...this.scope(set), step],
    );
    if (row?.request_digest !== digest)
      throw new Error('Recovery retry changed the admitted request');
  }

  private async post(target: Fetcher, path: string, body: unknown): Promise<Response> {
    const prefix =
      path === 'reshare' || path === 'access' || path === 'retire-source'
        ? '/router-ab/deriver/tenant-root-recovery/'
        : '/router-ab/tenant-root-control-plane/recovery/';
    const response = await target.fetch(`https://tenant-root.internal${prefix}${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-router-ab-internal-service-auth': this.generation.internalServiceAuthSecret,
      },
      body: JSON.stringify(body),
    });
    if (!response.ok) throw new Error(`Native recovery ${path} refused (${response.status})`);
    return response;
  }

  private async access(
    command: string,
    role: Role,
    kind: 'download' | 'destroy',
  ): Promise<Response> {
    const grantResponse = await this.post(this.generation.controlPlaneFetch, 'command', {
      kind,
      generation_command_b64u: command,
      role: nativeRole(role),
    });
    const grant = record(await grantResponse.json());
    return this.post(this.generation.derivers[role], 'access', {
      generation_command: command,
      access_grant: encoded(grant.access_grant_b64u, null),
    });
  }

  private async download(
    set: string,
    command: string,
    role: Role,
  ): Promise<TenantRootServedArtifactV1> {
    await this.requireOpen(set);
    const response = await this.access(command, role, 'download');
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.length === 0 || bytes.length > 16384)
      throw new Error('Recovery package exceeds its limit');
    await this.requireOpen(set);
    return {
      artifactB64u: base64UrlEncode(bytes),
      contentDigestB64u: base64UrlEncode(await sha256Bytes(bytes)),
    };
  }

  private async destroy(set: string, command: string, role: Role): Promise<string | null> {
    const response = await this.access(command, role, 'destroy');
    const value = record(await response.json());
    if (
      value.role !== nativeRole(role) ||
      value.recovery_set_id !== set ||
      typeof value.provider_receipt !== 'string'
    )
      throw new Error('Recovery destruction receipt scope mismatch');
    const receipt = record(JSON.parse(value.provider_receipt));
    if (value.status === 'destruction_scheduled' && receipt.state === 'DESTROY_SCHEDULED')
      return null;
    if (value.status !== 'destroyed' || receipt.state !== 'DESTROYED')
      throw new Error('Recovery destruction is unproven');
    return digestJson(value);
  }

  private async requireManifest(set: string, manifest: Manifest): Promise<void> {
    if (
      manifest.verified.recoverySetId !== set ||
      manifest.verified.identityDigestB64u !== this.generation.identityDigestB64u ||
      manifest.verified.sourceCustodyLineageB64u !== this.generation.custodyLineageB64u ||
      base64UrlEncode(await sha256Bytes(base64UrlDecode(manifest.manifest_b64u))) !==
        manifest.verified.manifestDigestB64u
    )
      throw new Error('Recovery manifest scope or digest mismatch');
  }
}

function nativeRole(role: Role): TenantRootDeriverRoleV1 {
  return role === 'a' ? 'deriver_a' : 'deriver_b';
}
function isRoleA(value: { readonly role: TenantRootDeriverRoleV1 }): boolean {
  return value.role === 'deriver_a';
}
function isRoleB(value: { readonly role: TenantRootDeriverRoleV1 }): boolean {
  return value.role === 'deriver_b';
}
function record(value: unknown): Record<string, unknown> {
  if (!isPlainObject(value)) throw new Error('Invalid native recovery response');
  return value;
}
function encoded(value: unknown, length: number | null): string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]+$/u.test(value))
    throw new Error('Invalid recovery encoding');
  const bytes = base64UrlDecode(value);
  if (
    bytes.length === 0 ||
    bytes.length > 128 * 1024 ||
    (length !== null && bytes.length !== length) ||
    base64UrlEncode(bytes) !== value
  )
    throw new Error('Invalid recovery byte length');
  return value;
}
function positive(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0)
    throw new Error('Invalid recovery integer');
  return value;
}
function parseCommands(value: unknown): Commands {
  const r = record(value);
  return {
    command_a_b64u: encoded(r.command_a_b64u, null),
    command_b_b64u: encoded(r.command_b_b64u, null),
    lifecycle_revision: positive(r.lifecycle_revision),
    issued_at_ms: positive(r.issued_at_ms),
    expires_at_ms: positive(r.expires_at_ms),
  };
}
function parsePrepared(value: unknown): { readonly kind: 'prepared'; readonly commitment: string } {
  const r = record(value);
  if (r.kind !== 'prepared') throw new Error('Expected prepared recovery result');
  return { kind: 'prepared', commitment: encoded(r.commitment, null) };
}
function parseContributed(value: unknown): {
  readonly kind: 'contributed';
  readonly contribution: string;
} {
  const r = record(value);
  if (r.kind !== 'contributed') throw new Error('Expected recovery contribution');
  return { kind: 'contributed', contribution: encoded(r.contribution, null) };
}
function parseDerived(value: unknown): { readonly kind: 'derived'; readonly commitment: string } {
  const r = record(value);
  if (r.kind !== 'derived') throw new Error('Expected derived recovery result');
  return { kind: 'derived', commitment: encoded(r.commitment, 34) };
}
function parseProved(value: unknown): { readonly kind: 'proved'; readonly evidence: string } {
  const r = record(value);
  if (r.kind !== 'proved') throw new Error('Expected recovery proof');
  return { kind: 'proved', evidence: encoded(r.evidence, null) };
}
function parsePackage(value: unknown): PackageMetadata {
  const r = record(value);
  if (r.kind !== 'packaged') throw new Error('Expected persisted recovery package');
  return {
    kind: 'packaged',
    package_digest: encoded(r.package_digest, 32),
    descriptor: encoded(r.descriptor, null),
    package_length: positive(r.package_length),
  };
}
function parseManifest(value: unknown) {
  const r = record(value);
  return {
    manifest_b64u: encoded(r.manifest_b64u, null),
    verified: parseTenantRootRegisteredManifestV1(r.verified),
  };
}
function requirePackage(value: TenantRootServedArtifactV1, digest: string, length: number): void {
  if (value.contentDigestB64u !== digest || base64UrlDecode(value.artifactB64u).length !== length)
    throw new Error('Persisted package binding mismatch');
}

async function digestJson(value: unknown): Promise<string> {
  return base64UrlEncode(await sha256Bytes(new TextEncoder().encode(JSON.stringify(value))));
}
