import { expect, test } from '@playwright/test';
import { generateKeyPairSync, sign } from 'node:crypto';
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Miniflare } from 'miniflare';
import { unstable_splitSqlQuery } from 'wrangler';
import { isD1DatabaseLike } from '@seams/wallet-server/cloud-host';
import { AccountDatabaseProbe } from '../../helpers/accountDatabaseProbe';
import { createCloudflareD1AccountServiceBundle } from '../../../packages/console-server-ts/src/router/cloudflare/d1AccountServices';
import { AuthenticatedAccountServiceProducerV1 } from '../../../packages/console-server-ts/src/accountPlatform/serviceIngressAuth';
import { createAesGcmConsoleInvitationSecretCipher } from '../../../packages/console-server-ts/src/email/secrets';
import {
  ServiceProvisionCommandV1,
  ServiceTenantBindingV1,
  parseServiceProvisionReceiptV1,
  ServiceEligibilityRequestV1,
  DelegatedPlatformAssertionV1,
  type PlatformResult,
  type PlatformScopeV1,
  type PlatformPrincipalV1,
} from '../../../packages/console-shared-ts/src/accountPlatform';
import type { D1DatabaseLike } from '../../../packages/console-server-ts/src/boundary/d1';

const repository = fileURLToPath(new URL('../../../', import.meta.url));
const output = path.join(repository, '.artifacts/shared-account-platform/authority');
const namespace = 'authority-acceptance';
const authority = { serviceId: 'satyr', deploymentId: 'satyr-acceptance' } as const;
const owner = { orgId: 'account', actorUserId: 'google:owner' };
const keys = generateKeyPairSync('ed25519');
function now(): Date {
  return new Date('2026-10-14T00:00:00Z');
}
function accepted<T, E>(result: PlatformResult<T, E>): T {
  if (result.kind === 'rejected') throw new Error(JSON.stringify(result.error));
  return result.value;
}
function encode(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}
async function assertion(scope: PlatformScopeV1, revision: number, principal: PlatformPrincipalV1) {
  const envelope = accepted(
    DelegatedPlatformAssertionV1.parse({
      version: 1,
      issuer: 'satyr',
      audience: 'account',
      principal,
      nativePrincipalId: 'native-owner',
      scope,
      instanceId: 'satyr:project',
      action: 'execute',
      expiresAt: new Date(now().getTime() + 30_000).toISOString(),
      authorityRevision: revision,
    }),
  );
  const content = `${encode({ alg: 'EdDSA', typ: 'JWT', kid: 'test' })}.${encode(envelope.toJSON())}`;
  const jwt = `${content}.${sign(null, Buffer.from(content), keys.privateKey).toString('base64url')}`;
  const auth = await AuthenticatedAccountServiceProducerV1.fromServiceBinding({
    authority,
    googleClientId: 'test-google',
    userAssertion: {
      issuer: 'satyr',
      audience: 'account',
      keyId: 'test',
      publicJwk: keys.publicKey.export({ format: 'jwk' }),
    },
  });
  const request = new Request('https://account.test/eligibility', {
    headers: { 'X-Account-User-Assertion': jwt },
  });
  return accepted(await auth.verifyUserAssertion(request, now()));
}
function principal(): PlatformPrincipalV1 {
  return accepted(
    ServiceEligibilityRequestV1.parse({
      version: 1,
      instanceId: 'satyr:project',
      action: 'execute',
      principal: {
        kind: 'user',
        identity: {
          kind: 'verified_provider_subject',
          userId: owner.actorUserId,
          issuer: 'https://accounts.google.com',
          subject: 'owner',
          verificationReceiptId: 'verified-owner',
        },
        authority: { kind: 'authenticated_session', nativeSessionId: 'session' },
      },
    }),
  ).principal;
}
async function revision(database: D1DatabaseLike): Promise<number> {
  const value = await database
    .prepare('SELECT authorization_version FROM organizations WHERE namespace = ? AND id = ?')
    .bind(namespace, owner.orgId)
    .first<number>('authorization_version');
  if (value === null) throw new Error('Missing authority revision');
  return value;
}
async function changeAuthority(database: D1DatabaseLike): Promise<void> {
  await database
    .prepare(
      'UPDATE organizations SET authorization_version = authorization_version + 1 WHERE namespace = ? AND id = ?',
    )
    .bind(namespace, owner.orgId)
    .run();
}
async function invitationState(database: D1DatabaseLike) {
  const invitations = await database
    .prepare('SELECT id, token_hash FROM organization_invitations ORDER BY id')
    .all();
  const grants = await database
    .prepare('SELECT * FROM platform_service_invitation_grants ORDER BY invitation_id')
    .all();
  const emails = await database
    .prepare('SELECT id, status FROM console_email_outbox ORDER BY id')
    .all();
  return { invitations: invitations.results, grants: grants.results, emails: emails.results };
}

test('service eligibility uses one snapshot and invitation races leave no partial commit', async () => {
  await rm(output, { recursive: true, force: true });
  await mkdir(output, { recursive: true });
  const worker = new Miniflare({
    modules: true,
    script: 'export default {fetch(){return new Response("authority")}}',
    compatibilityDate: '2026-04-17',
    d1Databases: { DB: 'authority' },
  });
  try {
    const database = await worker.getD1Database('DB');
    if (!isD1DatabaseLike(database)) throw new Error('D1 unavailable');
    const directory = path.join(
      repository,
      'packages/console-server-ts/migrations/d1-console-core',
    );
    for (const name of (await readdir(directory)).sort()) {
      if (!name.endsWith('.sql')) continue;
      for (const sql of unstable_splitSqlQuery(await readFile(path.join(directory, name), 'utf8')))
        await database.prepare(sql).run();
    }
    const probe = new AccountDatabaseProbe(database);
    const core = await createCloudflareD1AccountServiceBundle({
      database: probe,
      namespace,
      ensureSchema: false,
      externalDeletionGuard: null,
      now,
      organizationEmail: {
        consoleBaseUrl: 'https://console.test',
        invitationSecretCipher: createAesGcmConsoleInvitationSecretCipher({
          keyId: 'test',
          keyBytes: new Uint8Array(32).fill(7),
        }),
      },
    });
    await core.orgProjects.upsertOrganization(owner, { name: 'Account' });
    await core.organizationAccess.bootstrapInitialOwner({
      orgId: owner.orgId,
      userId: owner.actorUserId,
      email: 'owner@example.test',
      displayName: 'Owner',
    });
    await core.orgProjects.createProject(owner, { id: 'project', name: 'Project' });
    const scope = accepted(await core.accountPlatform.bindProjectBilling(owner, 'project'));
    const nativeScope = {
      serviceId: 'satyr',
      deploymentId: authority.deploymentId,
      nativeOrganizationId: 'native-account',
    } as const;
    const command = accepted(
      ServiceProvisionCommandV1.parse({
        version: 1,
        operationId: 'activate',
        instanceId: 'satyr:project',
        desiredRevision: 1,
        command: 'enable',
        binding: {
          kind: 'attach_existing_scope',
          nativeScope,
          authorityEvidence: { sourceRecordId: 'native-account', sourceDigest: 'a'.repeat(64) },
        },
      }),
    );
    accepted(await core.accountPlatform.requestProvision(owner, { scope, command }));
    const binding = accepted(
      ServiceTenantBindingV1.parse({ instanceId: command.instanceId, scope, nativeScope }),
    );
    accepted(
      await core.accountPlatform.acknowledgeProvision(
        authority,
        accepted(
          parseServiceProvisionReceiptV1({
            version: 1,
            operationId: command.operationId,
            instanceId: command.instanceId,
            desiredRevision: 1,
            result: 'active',
            binding,
          }),
        ),
      ),
    );
    await database
      .prepare(
        `INSERT INTO platform_provider_identities (namespace, user_id, provider_issuer, provider_subject, verification_receipt_id, verified_email, display_name, created_at_ms)
      VALUES (?, ?, 'https://accounts.google.com', 'owner', 'verified-owner', 'owner@example.test', 'Owner', ?)`,
      )
      .bind(namespace, owner.actorUserId, now().getTime())
      .run();
    await database
      .prepare(
        `INSERT INTO platform_service_principals (namespace, instance_id, native_principal_id, user_id, provider_issuer, provider_subject, created_at_ms)
      VALUES (?, ?, 'native-owner', ?, 'https://accounts.google.com', 'owner', ?)`,
      )
      .bind(namespace, command.instanceId, owner.actorUserId, now().getTime())
      .run();
    let proof = await assertion(scope, await revision(database), principal());
    const request = accepted(
      ServiceEligibilityRequestV1.parse({
        version: 1,
        instanceId: command.instanceId,
        principal: proof.principal,
        action: proof.action,
      }),
    );
    probe.reset();
    expect((await core.serviceAccess.checkEligibility(authority, proof, request)).kind).toBe(
      'accepted',
    );
    expect(probe.calls).toBe(1);
    const eligibilityCalls = probe.calls;
    expect(
      (
        await core.serviceAccess.checkEligibility(
          { serviceId: 'satyr', deploymentId: 'foreign' },
          proof,
          request,
        )
      ).kind,
    ).toBe('rejected');
    await changeAuthority(database);
    expect((await core.serviceAccess.checkEligibility(authority, proof, request)).kind).toBe(
      'rejected',
    );
    proof = await assertion(scope, await revision(database), principal());
    const before = await invitationState(database);
    probe.beforeBatch = changeAuthority.bind(null, database);
    await expect(
      core.serviceMemberships.invite(authority, proof, command.instanceId, {
        email: 'member@example.test',
        role: 'MEMBER',
        projectAccess: [{ projectId: 'project', accessLevel: 'viewer' }],
      }),
    ).rejects.toThrow('platform_scope_forbidden');
    expect(await invitationState(database)).toEqual(before);
    proof = await assertion(scope, await revision(database), principal());
    const issued = accepted(
      await core.serviceMemberships.invite(authority, proof, command.instanceId, {
        email: 'member@example.test',
        role: 'MEMBER',
        projectAccess: [{ projectId: 'project', accessLevel: 'viewer' }],
      }),
    );
    const after = await invitationState(database);
    expect(after.invitations).toHaveLength(1);
    expect(after.grants).toHaveLength(1);
    expect(after.emails?.length).toBe((before.emails?.length ?? 0) + 1);
    probe.beforeBatch = changeAuthority.bind(null, database);
    await expect(
      core.serviceMemberships.invite(authority, proof, command.instanceId, {
        email: 'member@example.test',
        role: 'MEMBER',
        projectAccess: [{ projectId: 'project', accessLevel: 'viewer' }],
      }),
    ).rejects.toThrow('platform_scope_forbidden');
    expect(await invitationState(database)).toEqual(after);
    proof = await assertion(scope, await revision(database), principal());
    accepted(
      await core.serviceAccess.setAutomationGrant(authority, proof, {
        instanceId: command.instanceId,
        automationId: 'automation',
        grantId: 'grant',
        nativePrincipalId: 'native-owner',
        access: 'allowed',
        expectedAccessRevision: 0,
      }),
    );
    const automationRequest = accepted(
      ServiceEligibilityRequestV1.parse({
        version: 1,
        instanceId: command.instanceId,
        action: 'execute',
        principal: { kind: 'automation', automationId: 'automation', grantId: 'grant' },
      }),
    );
    const automationProof = await assertion(
      scope,
      await revision(database),
      automationRequest.principal,
    );
    probe.reset();
    expect(
      (await core.serviceAccess.checkEligibility(authority, automationProof, automationRequest))
        .kind,
    ).toBe('accepted');
    expect(probe.calls).toBe(1);
    const automationCalls = probe.calls;
    proof = await assertion(scope, await revision(database), principal());
    accepted(
      await core.serviceAccess.setAutomationGrant(authority, proof, {
        instanceId: command.instanceId,
        automationId: 'automation',
        grantId: 'grant',
        nativePrincipalId: 'native-owner',
        access: 'revoked',
        expectedAccessRevision: 1,
      }),
    );
    expect(
      (await core.serviceAccess.checkEligibility(authority, automationProof, automationRequest))
        .kind,
    ).toBe('rejected');
    await writeFile(
      path.join(output, 'evidence.json'),
      JSON.stringify(
        {
          eligibilityCalls,
          automationCalls,
          invitationId: issued.invitation.id,
          issueRaceRolledBack: true,
          resendRaceRolledBack: true,
          before,
          after,
          repeat:
            'pnpm -C tests exec playwright test -c playwright.config.ts e2e/console/shared-account-authority.e2e.test.ts --reporter=line',
        },
        null,
        2,
      ),
    );
  } finally {
    await worker.dispose();
  }
});
