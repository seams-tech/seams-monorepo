import { expect, test } from '@playwright/test';
import { spawnSync } from 'node:child_process';
import { generateKeyPairSync } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';
import {
  assertExpectedWorkerServices,
  assertEd25519IssuerKeySet,
  assertEd25519RoleKeySet,
  assertExpectedDurableObjectBindings,
  validateGatewayRouterAbPublicConfiguration,
  validateDeploymentKeyPairs,
} from '../../scripts/deploy-backend.mjs';
import {
  buildFrontendEnvironment,
  walletManifestMatchesPackageVersion,
} from '../../scripts/deploy-surface.mjs';
import { readBackendLane, readFrontendSite } from '../../scripts/deployment-targets.mjs';

type CommandResult = {
  readonly status: number | null;
  readonly stdout: string;
  readonly stderr: string;
};

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const backendScript = path.join(repoRoot, 'scripts/deploy-backend.mjs');
const frontendScript = path.join(repoRoot, 'scripts/deploy-surface.mjs');
const requireFromWalletSite = createRequire(
  path.join(repoRoot, 'apps/wallet-console/package.json'),
);
const frontendHeaders = path.join(
  path.dirname(requireFromWalletSite.resolve('@seams/wallet/package.json')),
  'dist/public/_headers',
);
const environmentGeneratorScript = path.join(
  repoRoot,
  'deployment/wallet-system/scripts/generate-github-env-values.mjs',
);
const deploymentKeyGeneratorScript = path.join(
  repoRoot,
  'deployment/wallet-system/scripts/generate-deployment-keys.mjs',
);
const deploymentSecretNames = [
  'STRIPE_API_SK',
  'RELAYER_PRIVATE_KEY',
  'SPONSORED_EVM_EXECUTORS_JSON',
  'SIGNING_SESSION_SEAL_ROOT_SECRET_B64U',
];
function runCommand(
  script: string,
  args: readonly string[],
  env?: NodeJS.ProcessEnv,
): CommandResult {
  const result = spawnSync(process.execPath, [script, ...args], {
    cwd: repoRoot,
    encoding: 'utf8',
    env,
  });
  return {
    status: result.status,
    stdout: String(result.stdout ?? ''),
    stderr: String(result.stderr ?? ''),
  };
}

function environmentWithoutDeploymentSecrets(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  for (const name of deploymentSecretNames) delete env[name];
  return env;
}

function expectFailure(result: CommandResult, message: RegExp): void {
  expect(result.status).not.toBe(0);
  expect(`${result.stdout}\n${result.stderr}`).toMatch(message);
}

function expectOrdered(output: string, labels: readonly string[]): void {
  const orderStart = output.indexOf('\nOrder:\n');
  expect(orderStart, 'plan is missing an Order section').toBeGreaterThanOrEqual(0);
  const order = output.slice(orderStart);
  let previousIndex = -1;
  for (const label of labels) {
    const index = order.indexOf(label);
    expect(index, `missing plan step ${label}`).toBeGreaterThanOrEqual(0);
    expect(index, `plan step ${label} is out of order`).toBeGreaterThan(previousIndex);
    previousIndex = index;
  }
}

function generateX25519Pair(): { readonly privateKeyHex: string; readonly publicKey: string } {
  const { publicKey, privateKey } = generateKeyPairSync('x25519');
  const privateJwk = privateKey.export({ format: 'jwk' });
  const publicJwk = publicKey.export({ format: 'jwk' });
  if (!privateJwk.d || !publicJwk.x) throw new Error('X25519 JWK export is incomplete');
  return {
    privateKeyHex: Buffer.from(privateJwk.d, 'base64url').toString('hex'),
    publicKey: `x25519:${Buffer.from(publicJwk.x, 'base64url').toString('hex')}`,
  };
}

function validateMismatchedDeriverAKeyPair(): void {
  const current = generateX25519Pair();
  const mismatched = generateX25519Pair();
  validateDeploymentKeyPairs(readBackendLane('staging-testnet'), 'deriver-a', {
    DERIVER_A_ENVELOPE_HPKE_PRIVATE_KEY: `hpke-x25519-private-v1:${current.privateKeyHex}`,
    DERIVER_A_ENVELOPE_HPKE_PUBLIC_KEY: mismatched.publicKey,
    DERIVER_A_ROLE_PRIVATE_D1_KEK: `hpke-x25519-role-private-d1-private-v1:${current.privateKeyHex}`,
    DERIVER_A_ROLE_PRIVATE_D1_KEK_PUBLIC_KEY: current.publicKey,
  });
}

function validateMismatchedDeriverATenantRootOnlineKeyPair(): void {
  const envelope = generateX25519Pair();
  const privateD1 = generateX25519Pair();
  const online = generateX25519Pair();
  const backup = generateX25519Pair();
  const mismatched = generateX25519Pair();
  validateDeploymentKeyPairs(readBackendLane('staging-testnet'), 'deriver-a', {
    DERIVER_A_ENVELOPE_HPKE_PRIVATE_KEY: `hpke-x25519-private-v1:${envelope.privateKeyHex}`,
    DERIVER_A_ENVELOPE_HPKE_PUBLIC_KEY: envelope.publicKey,
    DERIVER_A_ROLE_PRIVATE_D1_KEK: `hpke-x25519-role-private-d1-private-v1:${privateD1.privateKeyHex}`,
    DERIVER_A_ROLE_PRIVATE_D1_KEK_PUBLIC_KEY: privateD1.publicKey,
    DERIVER_A_TENANT_ROOT_ONLINE_HPKE_PRIVATE_KEY: `hpke-x25519-private-v1:${online.privateKeyHex}`,
    DERIVER_A_TENANT_ROOT_ONLINE_HPKE_PUBLIC_KEY: mismatched.publicKey,
    DERIVER_A_TENANT_ROOT_MANAGED_BACKUP_HPKE_PRIVATE_KEY: `hpke-x25519-private-v1:${backup.privateKeyHex}`,
    DERIVER_A_TENANT_ROOT_MANAGED_BACKUP_HPKE_PUBLIC_KEY: backup.publicKey,
  });
}

function gatewayRouterAbEnvironment(): NodeJS.ProcessEnv {
  const lane = readBackendLane('production-testnet');
  if (lane.provisioning.kind !== 'provisioned') {
    throw new Error('production-testnet must be provisioned');
  }
  const keyset = lane.provisioning.gatewayDeploymentConfig.routerAb.publicKeyset;
  return {
    DERIVER_A_ENVELOPE_HPKE_PUBLIC_KEY: keyset.signer_envelope_hpke.current.deriver_a.public_key,
    DERIVER_B_ENVELOPE_HPKE_PUBLIC_KEY: keyset.signer_envelope_hpke.current.deriver_b.public_key,
    DERIVER_A_PEER_VERIFYING_KEY_HEX: keyset.signer_peer_verifying_keys.deriver_a.verifying_key_hex,
    DERIVER_B_PEER_VERIFYING_KEY_HEX: keyset.signer_peer_verifying_keys.deriver_b.verifying_key_hex,
    SIGNING_WORKER_SERVER_OUTPUT_HPKE_PUBLIC_KEY:
      keyset.signing_worker_server_output_hpke.public_key,
  };
}

test('backend plan runs without deployment secrets and prints the complete lane order', () => {
  const result = runCommand(
    backendScript,
    ['plan', '--lane', 'staging-testnet', '--component', 'wallet-system'],
    environmentWithoutDeploymentSecrets(),
  );

  expect(result.status).toBe(0);
  expect(result.stdout).toContain('Backend deployment plan: wallet-system / staging-testnet');
  expect(result.stdout).toContain('Release: staging');
  expect(result.stdout).toContain('Network: testnet');
  expect(result.stdout).toContain('Runtime profile: testnet_live_demo');
  expect(result.stdout).toContain('Gateway origin: https://staging.api.wallet.seams.sh');
  expect(result.stdout).toContain('Wallet origin: https://staging.sign.seams.sh');
  expect(result.stdout).not.toContain('plan-secret-value');
  expect(result.stdout).not.toContain('bootstrap Gateway tenant');
  expectOrdered(result.stdout, [
    'build',
    'migrate',
    'signing-worker',
    'deriver-a',
    'deriver-b',
    'tenant-root-control-plane',
    'router',
    'deploy wallet-runtime',
    'deploy gateway',
    'smoke',
  ]);
});

test('production-mainnet plan reports the provisioned mainnet service', () => {
  const plan = runCommand(
    backendScript,
    ['plan', '--lane', 'production-mainnet', '--component', 'wallet-system'],
    environmentWithoutDeploymentSecrets(),
  );

  expect(plan.status).toBe(0);
  expect(plan.stdout).toContain('Backend deployment plan: wallet-system / production-mainnet');
  expect(plan.stdout).toContain('Provisioning: provisioned');
  expect(plan.stdout).toContain('Runtime profile: mainnet_service');
  expect(plan.stdout).toContain('Network: mainnet');
  expect(plan.stdout).toContain('Gateway: seams-sdk-d1-gateway');
  expect(plan.stdout).not.toContain('Required values:');
});

test('production-shaped project policy uses the canonical Seams environment id', () => {
  const source = readFileSync(environmentGeneratorScript, 'utf8');
  const policyBuilder = source.match(
    /function buildProjectPolicy\(configuration\) \{[\s\S]*?\n\}/u,
  )?.[0];
  const registrationValidator = source.match(
    /function validateGatewayRegistrationDocuments\(outputDocument\) \{[\s\S]*?\n\}/u,
  )?.[0];

  expect(policyBuilder).toBeTruthy();
  expect(registrationValidator).toBeTruthy();
  expect(source).toContain("'SEAMS_ENV_ID'");
  expect(policyBuilder).toContain('environment: configuration.environmentId,');
  expect(policyBuilder).not.toContain('environment: targetName,');
  expect(registrationValidator).toMatch(
    /policy\.environment,\s*deploymentConfig\.tenant\.environmentId,/u,
  );

  const lanePrefix = 'production';
  const seamsEnvironmentId = 'seams-production-mainnet';
  expect(seamsEnvironmentId).not.toBe(lanePrefix);
});

test('frontend plan runs without deployment secrets', () => {
  const result = runCommand(
    frontendScript,
    ['plan', '--site', 'staging', '--component', 'wallet-site'],
    environmentWithoutDeploymentSecrets(),
  );

  expect(result.status).toBe(0);
  expect(result.stdout).toContain('Origin: https://staging.wallet.seams.sh');
  expect(result.stdout).toContain('Docs: https://staging.wallet.seams.sh/docs/');
  expect(result.stdout).toContain('Pages project environment: CF_PAGES_PROJECT_WALLET_SITE');
});

test('wallet host smoke requires the exact installed wallet package version', async () => {
  const matchingManifest = new Response(
    JSON.stringify({
      packageName: '@seams/wallet',
      packageVersion: '1.2.3',
      versionSkewContract: { packageVersion: '1.2.3' },
    }),
    { headers: { 'content-type': 'application/json' } },
  );
  const staleManifest = new Response(
    JSON.stringify({
      packageName: '@seams/wallet',
      packageVersion: '1.2.2',
      versionSkewContract: { packageVersion: '1.2.2' },
    }),
    { headers: { 'content-type': 'application/json' } },
  );

  await expect(
    walletManifestMatchesPackageVersion(matchingManifest, '1.2.3'),
  ).resolves.toBe(true);
  await expect(walletManifestMatchesPackageVersion(staleManifest, '1.2.3')).resolves.toBe(false);
});

test('frontend build uses canonical Console origins for every production lane', () => {
  const site = readFrontendSite('production');
  const environment: NodeJS.ProcessEnv = {};

  for (const lane of site.lanes) {
    if (lane.provisioning.kind !== 'provisioned') throw new Error(`${lane.id} must be provisioned`);
    const prefix = `VITE_${lane.network.toUpperCase()}_`;
    environment[`${prefix}SEAMS_PROJECT_ENVIRONMENT_ID`] =
      lane.provisioning.gatewayDeploymentConfig.tenant.environmentId;
    environment[`${prefix}SEAMS_PUBLISHABLE_KEY`] = 'pk_test_deployment';
    environment[`${prefix}NEAR_NETWORK`] = lane.network;
    environment[`${prefix}NEAR_RPC_URL`] = `https://rpc.${lane.network}.example`;
    environment[`${prefix}NEAR_EXPLORER`] = `https://explorer.${lane.network}.example`;
    environment[`${prefix}SIGNING_SESSION_PERSISTENCE_MODE`] = 'sealed_refresh_v1';
    environment[`${prefix}CONSOLE_BASE_URL`] = 'https://stale-console.example';
  }

  const resolved = buildFrontendEnvironment(site, site.walletSiteOrigin, environment);

  expect(resolved.VITE_TESTNET_CONSOLE_BASE_URL).toBe('https://test.console.seams.sh');
  expect(resolved.VITE_MAINNET_CONSOLE_BASE_URL).toBe('https://wallet.seams.sh');
});

test('frontend Pages headers align with hosted wallet asset policies', () => {
  const source = readFileSync(frontendHeaders, 'utf8');

  expect(source).toContain(
    '/sdk/*\n  Cache-Control: public, max-age=300, must-revalidate\n  Access-Control-Allow-Origin: *',
  );
  expect(source).toContain('/wallet-service\n  Cache-Control: no-store');
  expect(source).toContain('/wallet-service/*\n  Cache-Control: no-store');
  for (const manifest of ['wallet-assets.manifest.json', 'headers.manifest.json']) {
    expect(source).toContain(
      `/${manifest}\n  Content-Type: application/json; charset=utf-8\n  Cache-Control: no-store`,
    );
  }
});

test('backend commands reject missing, unknown, and misplaced arguments', () => {
  expectFailure(runCommand(backendScript, []), /usage:.*deploy-backend/u);
  expectFailure(runCommand(backendScript, ['unknown', '--lane', 'staging-testnet']), /usage:/u);
  expectFailure(runCommand(backendScript, ['plan']), /--lane.*required/u);
  expectFailure(runCommand(backendScript, ['plan', '--target', 'staging']), /usage:/u);
  expectFailure(
    runCommand(backendScript, ['plan', '--lane', 'production', '--component', 'wallet-system']),
    /lane/u,
  );
  expectFailure(
    runCommand(backendScript, ['plan', '--lane', 'staging-testnet', '--component', 'gateway']),
    /--component must be console or wallet-system/u,
  );
  expectFailure(
    runCommand(backendScript, ['preflight', '--lane', 'staging-testnet']),
    /--component.*required/u,
  );
  expectFailure(
    runCommand(backendScript, ['preflight', '--lane', 'staging-testnet', '--component', 'unknown']),
    /unknown component/u,
  );
  expectFailure(
    runCommand(backendScript, ['deploy', '--lane', 'staging-testnet', '--component', 'frontend']),
    /unknown component|backend component/u,
  );
});

test('backend commands reject a lane branch mismatch before deployment work', () => {
  const result = runCommand(
    backendScript,
    ['smoke', '--lane', 'staging-testnet', '--component', 'wallet-system'],
    {
      ...environmentWithoutDeploymentSecrets(),
      GITHUB_REF: 'refs/heads/main',
    },
  );

  expectFailure(result, /lane staging-testnet requires branch dev/u);
});

test('backend preflight validates one custody environment from explicit inputs', () => {
  const secretValue = 'inventory-secret-value';
  const result = runCommand(
    backendScript,
    ['preflight', '--lane', 'staging-testnet', '--component', 'signing-worker'],
    {
      ...environmentWithoutDeploymentSecrets(),
      CLOUDFLARE_API_TOKEN: secretValue,
      CLOUDFLARE_ACCOUNT_ID: secretValue,
      ROUTER_AB_INTERNAL_SERVICE_AUTH_SECRET: secretValue,
      SIGNING_WORKER_SERVER_OUTPUT_HPKE_PRIVATE_KEY: secretValue,
      SIGNING_WORKER_PRIVATE_D1_KEK: secretValue,
      SIGNING_WORKER_SERVER_OUTPUT_HPKE_PUBLIC_KEY: 'inventory-public-value',
      SIGNING_WORKER_PRIVATE_D1_ID: 'inventory-database-id',
      SIGNING_WORKER_PRIVATE_D1_KEK_PUBLIC_KEY: 'inventory-kek-public-key',
      SIGNING_WORKER_PRIVATE_D1_KEK_VERSION: 'inventory-kek-version',
    },
  );

  expect(result.status).toBe(0);
  expect(result.stdout).toContain('Preflight passed: staging-testnet/signing-worker');
  expect(`${result.stdout}${result.stderr}`).not.toContain(secretValue);
});

test('backend preflight rejects a missing required secret without printing values', () => {
  const secretValue = 'inventory-secret-value';
  const result = runCommand(
    backendScript,
    ['preflight', '--lane', 'staging-testnet', '--component', 'signing-worker'],
    {
      ...environmentWithoutDeploymentSecrets(),
      CLOUDFLARE_API_TOKEN: secretValue,
      CLOUDFLARE_ACCOUNT_ID: secretValue,
      ROUTER_AB_INTERNAL_SERVICE_AUTH_SECRET: secretValue,
      SIGNING_WORKER_SERVER_OUTPUT_HPKE_PUBLIC_KEY: 'inventory-public-value',
    },
  );

  expectFailure(result, /SIGNING_WORKER_SERVER_OUTPUT_HPKE_PRIVATE_KEY is required/u);
  expect(`${result.stdout}${result.stderr}`).not.toContain(secretValue);
});

test('backend deployment rejects an HPKE private key that does not match its public key', () => {
  expect(validateMismatchedDeriverAKeyPair).toThrow(
    /DERIVER_A_ENVELOPE_HPKE_PRIVATE_KEY does not match DERIVER_A_ENVELOPE_HPKE_PUBLIC_KEY/u,
  );
  expect(validateMismatchedDeriverATenantRootOnlineKeyPair).toThrow(
    /DERIVER_A_TENANT_ROOT_ONLINE_HPKE_PRIVATE_KEY does not match DERIVER_A_TENANT_ROOT_ONLINE_HPKE_PUBLIC_KEY/u,
  );
});

test('gateway deployment rejects Router A/B public key drift', () => {
  const lane = readBackendLane('production-testnet');
  const environment = gatewayRouterAbEnvironment();
  expect(() => validateGatewayRouterAbPublicConfiguration(lane, environment)).not.toThrow();
  expect(() =>
    validateGatewayRouterAbPublicConfiguration(lane, {
      ...environment,
      DERIVER_A_ENVELOPE_HPKE_PUBLIC_KEY: `x25519:${'00'.repeat(32)}`,
    }),
  ).toThrow(/DERIVER_A_ENVELOPE_HPKE_PUBLIC_KEY does not match/u);
});

test('deployment key generation provisions distinct role-local tenant-root provider keys', () => {
  const result = runCommand(deploymentKeyGeneratorScript, ['--lane', 'staging-testnet', '--json']);
  expect(result.status).toBe(0);
  const output = JSON.parse(result.stdout) as {
    readonly variables: Readonly<Record<string, string>>;
    readonly secrets: Readonly<Record<string, string>>;
  };
  const publicKeys = [
    output.variables.ROUTER_AB_DERIVER_A_TENANT_ROOT_ONLINE_HPKE_PUBLIC_KEY,
    output.variables.ROUTER_AB_DERIVER_A_TENANT_ROOT_MANAGED_BACKUP_HPKE_PUBLIC_KEY,
    output.variables.ROUTER_AB_DERIVER_B_TENANT_ROOT_ONLINE_HPKE_PUBLIC_KEY,
    output.variables.ROUTER_AB_DERIVER_B_TENANT_ROOT_MANAGED_BACKUP_HPKE_PUBLIC_KEY,
  ];
  expect(new Set(publicKeys).size).toBe(publicKeys.length);
  expect(output.variables.ROUTER_AB_DERIVER_A_TENANT_ROOT_MANAGED_BACKUP_PROVIDER_ID).not.toBe(
    output.variables.ROUTER_AB_DERIVER_B_TENANT_ROOT_MANAGED_BACKUP_PROVIDER_ID,
  );
  for (const name of [
    'DERIVER_A_TENANT_ROOT_ONLINE_HPKE_PRIVATE_KEY',
    'DERIVER_A_TENANT_ROOT_MANAGED_BACKUP_HPKE_PRIVATE_KEY',
    'DERIVER_B_TENANT_ROOT_ONLINE_HPKE_PRIVATE_KEY',
    'DERIVER_B_TENANT_ROOT_MANAGED_BACKUP_HPKE_PRIVATE_KEY',
  ]) {
    expect(output.secrets[name]).toBe('hpke-x25519-private-v1:<redacted>');
  }
});

test('production manifests use external KMS backups and distribute both envelope public keys', () => {
  const generationEnvironment = environmentWithoutDeploymentSecrets();
  delete generationEnvironment.GATEWAY_RUNTIME_PROFILE;
  delete generationEnvironment.EMAIL_OTP_DELIVERY_MODE;
  delete generationEnvironment.RELAYER_ACCOUNT_ID;
  delete generationEnvironment.RELAYER_PRIVATE_KEY;
  delete generationEnvironment.RELAYER_PUBLIC_KEY;
  delete generationEnvironment.VITE_RELAYER_ACCOUNT_ID;
  const result = runCommand(
    environmentGeneratorScript,
    ['--lane', 'production-mainnet', '--json'],
    generationEnvironment,
  );
  expect(result.status, result.stderr).toBe(0);
  const output = JSON.parse(result.stdout);
  const router = output.environments['production-mpc-router'];
  for (const role of ['A', 'B']) {
    const environment = output.environments[`production-deriver-${role.toLowerCase()}`];
    const prefix = `DERIVER_${role}_TENANT_ROOT_MANAGED_BACKUP`;
    expect(environment.variables[`ROUTER_AB_${prefix}_PROVIDER_ID`]).toBe(
      `google-cloud-kms-deriver-${role.toLowerCase()}-v1`,
    );
    expect(environment.variables[`ROUTER_AB_${prefix}_KEY_VERSION`]).toBeTruthy();
    expect(environment.secrets[`${prefix}_GOOGLE_CREDENTIALS_JSON`]).toBeTruthy();
    expect(environment.secrets[`${prefix}_HPKE_PRIVATE_KEY`]).toBeUndefined();
    expect(environment.variables[`ROUTER_AB_${prefix}_HPKE_PUBLIC_KEY`]).toBeUndefined();
    for (const peer of ['A', 'B']) {
      const name = `ROUTER_AB_DERIVER_${peer}_ENVELOPE_HPKE_PUBLIC_KEY`;
      expect(environment.variables[name]).toBe(router.variables[name]);
      expect(environment.variables[name]).toMatch(/^x25519:[0-9a-f]{64}$/u);
    }
  }
  const apply = runCommand(deploymentKeyGeneratorScript, [
    '--lane',
    'production-mainnet',
    '--apply',
  ]);
  expectFailure(apply, /per-Worker manifests/u);
});

test('deployment key generation provisions one tenant-root control-plane issuer key', () => {
  const result = runCommand(deploymentKeyGeneratorScript, [
    '--lane',
    'staging-testnet',
    '--show-secrets',
    '--json',
  ]);
  expect(result.status).toBe(0);
  const output = JSON.parse(result.stdout) as {
    readonly variables: Readonly<Record<string, string>>;
    readonly secrets: Readonly<Record<string, string>>;
  };
  const keyId = output.variables.ROUTER_AB_TENANT_ROOT_CONTROL_PLANE_ISSUER_SIGNING_KEY_ID;
  const keySetText =
    output.variables.ROUTER_AB_TENANT_ROOT_CONTROL_PLANE_ISSUER_VERIFYING_KEYS_JSON;
  const seed = output.secrets.TENANT_ROOT_CONTROL_PLANE_ISSUER_SIGNING_KEY;
  // The id carries the complete public-key hex, so it names exactly one key.
  expect(keyId).toMatch(/^control-plane-issuer-[0-9a-f]{64}$/u);
  expect(keyId.length).toBeLessThanOrEqual(256);
  // Exact wire shape of TenantRootCreationIssuerKeySetWireV1: one key, two fields.
  const keySet = JSON.parse(keySetText) as {
    readonly keys: readonly {
      readonly issuer_key_id: string;
      readonly verifying_key_hex: string;
    }[];
  };
  expect(Object.keys(keySet)).toEqual(['keys']);
  expect(keySet.keys).toHaveLength(1);
  expect(Object.keys(keySet.keys[0])).toEqual(['issuer_key_id', 'verifying_key_hex']);
  expect(keySet.keys[0].issuer_key_id).toBe(keyId);
  expect(keySet.keys[0].verifying_key_hex).toMatch(/^[0-9a-f]{64}$/u);
  expect(keyId).toBe(`control-plane-issuer-${keySet.keys[0].verifying_key_hex}`);
  // The seed reproduces the published verifying key.
  expect(() =>
    assertEd25519IssuerKeySet(
      'TENANT_ROOT_CONTROL_PLANE_ISSUER_SIGNING_KEY',
      'TENANT_ROOT_CONTROL_PLANE_ISSUER_SIGNING_KEY_ID',
      'TENANT_ROOT_CONTROL_PLANE_ISSUER_VERIFYING_KEYS_JSON',
      {
        TENANT_ROOT_CONTROL_PLANE_ISSUER_SIGNING_KEY: seed,
        TENANT_ROOT_CONTROL_PLANE_ISSUER_SIGNING_KEY_ID: keyId,
        TENANT_ROOT_CONTROL_PLANE_ISSUER_VERIFYING_KEYS_JSON: keySetText,
      },
    ),
  ).not.toThrow();

  // The grant authority is external: this command must not be able to mint one.
  const notGenerated = (JSON.parse(result.stdout) as { readonly notGenerated: readonly string[] })
    .notGenerated;
  expect(notGenerated).toContain(
    'ROUTER_AB_TENANT_ROOT_CONTROL_PLANE_GRANT_AUTHORITY_VERIFYING_KEYS_JSON',
  );
  expect(output.variables).not.toHaveProperty(
    'ROUTER_AB_TENANT_ROOT_CONTROL_PLANE_GRANT_AUTHORITY_VERIFYING_KEYS_JSON',
  );

  // The seed is never printed without --show-secrets.
  const redacted = runCommand(deploymentKeyGeneratorScript, [
    '--lane',
    'staging-testnet',
    '--json',
  ]);
  const redactedOutput = JSON.parse(redacted.stdout) as {
    readonly secrets: Readonly<Record<string, string>>;
  };
  expect(redactedOutput.secrets.TENANT_ROOT_CONTROL_PLANE_ISSUER_SIGNING_KEY).toBe('<redacted>');
});

test('deployment key generation provisions role-local Deriver creation signing keys', () => {
  const result = runCommand(deploymentKeyGeneratorScript, [
    '--lane',
    'staging-testnet',
    '--show-secrets',
    '--json',
  ]);
  expect(result.status).toBe(0);
  const output = JSON.parse(result.stdout) as {
    readonly variables: Readonly<Record<string, string>>;
    readonly secrets: Readonly<Record<string, string>>;
  };
  const keySet = JSON.parse(
    output.variables.ROUTER_AB_TENANT_ROOT_CREATION_ROLE_VERIFYING_KEYS_JSON,
  ) as {
    readonly active_deriver_a_signing_key_id: string;
    readonly active_deriver_b_signing_key_id: string;
    readonly keys: readonly {
      readonly role: string;
      readonly signing_key_id: string;
      readonly verifying_key_hex: string;
    }[];
  };
  // Exact wire shape of TenantRootCreationRoleVerifyingKeySetWireV1: active
  // selectors plus one retained entry per role.
  expect(Object.keys(keySet)).toEqual([
    'active_deriver_a_signing_key_id',
    'active_deriver_b_signing_key_id',
    'keys',
  ]);
  expect(keySet.keys.map((entry) => entry.role)).toEqual(['deriver_a', 'deriver_b']);
  expect(keySet.active_deriver_a_signing_key_id).toBe(keySet.keys[0].signing_key_id);
  expect(keySet.active_deriver_b_signing_key_id).toBe(keySet.keys[1].signing_key_id);
  for (const [entry, role, R] of [
    [keySet.keys[0], 'deriver_a', 'A'],
    [keySet.keys[1], 'deriver_b', 'B'],
  ] as const) {
    expect(Object.keys(entry)).toEqual(['role', 'signing_key_id', 'verifying_key_hex']);
    expect(entry.verifying_key_hex).toMatch(/^[0-9a-f]{64}$/u);
    expect(entry.signing_key_id).toBe(
      `${role.replace('_', '-')}-tenant-root-creation-${entry.verifying_key_hex}`,
    );
    expect(output.variables[`ROUTER_AB_DERIVER_${R}_TENANT_ROOT_CREATION_SIGNING_KEY_ID`]).toBe(
      entry.signing_key_id,
    );
    expect(() =>
      assertEd25519RoleKeySet(
        `DERIVER_${R}_TENANT_ROOT_CREATION_SIGNING_KEY`,
        `DERIVER_${R}_TENANT_ROOT_CREATION_SIGNING_KEY_ID`,
        'ROUTER_TENANT_ROOT_CREATION_ROLE_VERIFYING_KEYS_JSON',
        role,
        {
          [`DERIVER_${R}_TENANT_ROOT_CREATION_SIGNING_KEY`]:
            output.secrets[`DERIVER_${R}_TENANT_ROOT_CREATION_SIGNING_KEY`],
          [`DERIVER_${R}_TENANT_ROOT_CREATION_SIGNING_KEY_ID`]: entry.signing_key_id,
          ROUTER_TENANT_ROOT_CREATION_ROLE_VERIFYING_KEYS_JSON:
            output.variables.ROUTER_AB_TENANT_ROOT_CREATION_ROLE_VERIFYING_KEYS_JSON,
        },
      ),
    ).not.toThrow();
  }
  // Role keys are distinct from each other, from the A/B peer keys (the Rust
  // loader rejects reuse), and from the issuer key.
  const allPublic = new Set([
    keySet.keys[0].verifying_key_hex,
    keySet.keys[1].verifying_key_hex,
    output.variables.ROUTER_AB_DERIVER_A_PEER_VERIFYING_KEY_HEX,
    output.variables.ROUTER_AB_DERIVER_B_PEER_VERIFYING_KEY_HEX,
    (
      JSON.parse(
        output.variables.ROUTER_AB_TENANT_ROOT_CONTROL_PLANE_ISSUER_VERIFYING_KEYS_JSON,
      ) as {
        keys: { verifying_key_hex: string }[];
      }
    ).keys[0].verifying_key_hex,
  ]);
  expect(allPublic.size).toBe(5);
  // A's key cannot be selected as B's active role key.
  expect(() =>
    assertEd25519RoleKeySet(
      'DERIVER_A_TENANT_ROOT_CREATION_SIGNING_KEY',
      'DERIVER_A_TENANT_ROOT_CREATION_SIGNING_KEY_ID',
      'ROUTER_TENANT_ROOT_CREATION_ROLE_VERIFYING_KEYS_JSON',
      'deriver_b',
      {
        DERIVER_A_TENANT_ROOT_CREATION_SIGNING_KEY:
          output.secrets.DERIVER_A_TENANT_ROOT_CREATION_SIGNING_KEY,
        DERIVER_A_TENANT_ROOT_CREATION_SIGNING_KEY_ID: keySet.keys[0].signing_key_id,
        ROUTER_TENANT_ROOT_CREATION_ROLE_VERIFYING_KEYS_JSON:
          output.variables.ROUTER_AB_TENANT_ROOT_CREATION_ROLE_VERIFYING_KEYS_JSON,
      },
    ),
  ).toThrow(/is not the active key for deriver_b/u);
});

test('issuer key-set validation fails closed on every mismatch', () => {
  const good = JSON.parse(
    runCommand(deploymentKeyGeneratorScript, [
      '--lane',
      'staging-testnet',
      '--show-secrets',
      '--json',
    ]).stdout,
  ) as {
    readonly variables: Readonly<Record<string, string>>;
    readonly secrets: Readonly<Record<string, string>>;
  };
  const env = {
    TENANT_ROOT_CONTROL_PLANE_ISSUER_SIGNING_KEY:
      good.secrets.TENANT_ROOT_CONTROL_PLANE_ISSUER_SIGNING_KEY,
    TENANT_ROOT_CONTROL_PLANE_ISSUER_SIGNING_KEY_ID:
      good.variables.ROUTER_AB_TENANT_ROOT_CONTROL_PLANE_ISSUER_SIGNING_KEY_ID,
    TENANT_ROOT_CONTROL_PLANE_ISSUER_VERIFYING_KEYS_JSON:
      good.variables.ROUTER_AB_TENANT_ROOT_CONTROL_PLANE_ISSUER_VERIFYING_KEYS_JSON,
  };
  const check = (overrides: Readonly<Record<string, string>>) => () =>
    assertEd25519IssuerKeySet(
      'TENANT_ROOT_CONTROL_PLANE_ISSUER_SIGNING_KEY',
      'TENANT_ROOT_CONTROL_PLANE_ISSUER_SIGNING_KEY_ID',
      'TENANT_ROOT_CONTROL_PLANE_ISSUER_VERIFYING_KEYS_JSON',
      { ...env, ...overrides },
    );
  expect(check({})).not.toThrow();
  // A different seed does not match the published key.
  const other = JSON.parse(
    runCommand(deploymentKeyGeneratorScript, [
      '--lane',
      'staging-testnet',
      '--show-secrets',
      '--json',
    ]).stdout,
  ) as { readonly secrets: Readonly<Record<string, string>> };
  expect(
    check({
      TENANT_ROOT_CONTROL_PLANE_ISSUER_SIGNING_KEY:
        other.secrets.TENANT_ROOT_CONTROL_PLANE_ISSUER_SIGNING_KEY,
    }),
  ).toThrow(/TENANT_ROOT_CONTROL_PLANE_ISSUER_SIGNING_KEY does not match/u);
  // A key id absent from the set, a malformed seed, malformed JSON, an extra
  // top-level field, and a duplicated id all fail closed.
  expect(
    check({ TENANT_ROOT_CONTROL_PLANE_ISSUER_SIGNING_KEY_ID: 'control-plane-issuer-unknown' }),
  ).toThrow(/does not contain/u);
  expect(check({ TENANT_ROOT_CONTROL_PLANE_ISSUER_SIGNING_KEY: 'AAAA' })).toThrow(/32-byte/u);
  expect(check({ TENANT_ROOT_CONTROL_PLANE_ISSUER_VERIFYING_KEYS_JSON: '{' })).toThrow(
    /valid JSON/u,
  );
  const parsed = JSON.parse(env.TENANT_ROOT_CONTROL_PLANE_ISSUER_VERIFYING_KEYS_JSON) as {
    keys: { issuer_key_id: string; verifying_key_hex: string }[];
  };
  expect(
    check({
      TENANT_ROOT_CONTROL_PLANE_ISSUER_VERIFYING_KEYS_JSON: JSON.stringify({ ...parsed, extra: 1 }),
    }),
  ).toThrow(/between one and 32 keys/u);
  expect(
    check({
      TENANT_ROOT_CONTROL_PLANE_ISSUER_VERIFYING_KEYS_JSON: JSON.stringify({
        keys: [parsed.keys[0], parsed.keys[0]],
      }),
    }),
  ).toThrow(/repeats issuer key id/u);
});

test('backend deployment accepts components that do not own deployment key pairs', () => {
  const lane = readBackendLane('staging-testnet');
  expect(() => validateDeploymentKeyPairs(lane, 'wallet-runtime', {})).not.toThrow();
  expect(() => validateDeploymentKeyPairs(lane, 'console', {})).not.toThrow();
  // The control plane DOES own a key pair: its issuer seed must reproduce the
  // verifying key published under its active key id.
  expect(() => validateDeploymentKeyPairs(lane, 'tenant-root-control-plane', {})).toThrow(
    /TENANT_ROOT_CONTROL_PLANE_ISSUER_SIGNING_KEY is required/u,
  );
});

test('durable object binding validation pins ownership and the target Router', () => {
  const lane = {
    id: 'staging-testnet',
    resources: { router: { workerName: 'router-ab-mpc-router-staging' } },
  };
  const external = `
[[env.staging.durable_objects.bindings]]
name = "ROUTER_TENANT_ROOT_CREATION_DO"
class_name = "RouterAbTenantRootCreationDurableObject"
script_name = "router-ab-mpc-router-staging"
`;
  expect(() => assertExpectedDurableObjectBindings(lane, 'deriver-a', external)).not.toThrow();
  // The Signing Worker has no tenant-root role, so it is not checked.
  expect(() => assertExpectedDurableObjectBindings(lane, 'signing-worker', '')).not.toThrow();

  // A missing binding orphans tenant-root state.
  expect(() => assertExpectedDurableObjectBindings(lane, 'deriver-a', '')).toThrow(
    /must bind ROUTER_TENANT_ROOT_CREATION_DO/u,
  );
  // A wrong Router points the Deriver at another deployment's object.
  expect(() =>
    assertExpectedDurableObjectBindings(
      lane,
      'deriver-a',
      external.replace('router-ab-mpc-router-staging', 'router-ab-mpc-router-testnet'),
    ),
  ).toThrow(/must bind ROUTER_TENANT_ROOT_CREATION_DO to script router-ab-mpc-router-staging/u);
  // A renamed class silently orphans storage.
  expect(() =>
    assertExpectedDurableObjectBindings(
      lane,
      'deriver-a',
      external.replace('RouterAbTenantRootCreationDurableObject', 'RouterAbRenamedDurableObject'),
    ),
  ).toThrow(/RouterAbTenantRootCreationDurableObject/u);
  // A non-owner must never declare the class migration.
  expect(() =>
    assertExpectedDurableObjectBindings(
      lane,
      'deriver-a',
      `${external}\n[[migrations]]\nnew_sqlite_classes = ["RouterAbTenantRootCreationDurableObject"]\n`,
    ),
  ).toThrow(/must not declare a Durable Object migration it does not own/u);

  // The Router owns the class: inline binding form, and no script_name.
  const owner = `
[durable_objects]
bindings = [
  { name = "ROUTER_TENANT_ROOT_CREATION_DO", class_name = "RouterAbTenantRootCreationDurableObject" },
]
`;
  expect(() => assertExpectedDurableObjectBindings(lane, 'router', owner)).not.toThrow();
  expect(() =>
    assertExpectedDurableObjectBindings(
      lane,
      'router',
      owner.replace('" }', '", script_name = "router-ab-mpc-router-staging" }'),
    ),
  ).toThrow(/must not set script_name/u);
});

test('backend service binding validation rejects a wrong service hidden by a later block', () => {
  const lane = {
    id: 'production-testnet',
    resources: {
      deriverA: { workerName: 'router-ab-deriver-a-testnet' },
      deriverB: { workerName: 'router-ab-deriver-b-testnet' },
      signingWorker: { workerName: 'router-ab-signing-worker-testnet' },
      tenantRootControlPlane: { workerName: 'router-ab-tenant-root-control-plane-testnet' },
    },
  };
  const section = `
[[env.production-testnet.services]]
binding = "DERIVER_B"
service = "router-ab-deriver-a-testnet"

[[env.production-testnet.services]]
binding = "UNRELATED"
service = "router-ab-deriver-b-testnet"
`;

  expect(() => assertExpectedWorkerServices(lane, 'deriver-a', section)).toThrow(
    /production-testnet\/deriver-a must bind DERIVER_B to router-ab-deriver-b-testnet/u,
  );
});

test('frontend commands reject backend-only operations and unknown surface arguments', () => {
  expectFailure(
    runCommand(frontendScript, ['migrate', '--site', 'staging', '--component', 'company']),
    /usage:/u,
  );
  expectFailure(runCommand(frontendScript, ['plan']), /usage:/u);
  expectFailure(
    runCommand(frontendScript, ['plan', '--site', 'staging', '--component', 'gateway']),
    /--component must be/u,
  );
  expectFailure(runCommand(frontendScript, ['plan', '--site', 'development']), /site/u);
});

test('frontend commands reject a site branch mismatch before deployment work', () => {
  const result = runCommand(
    frontendScript,
    ['smoke', '--site', 'staging', '--component', 'company'],
    {
      ...environmentWithoutDeploymentSecrets(),
      GITHUB_REF: 'refs/heads/main',
    },
  );

  expectFailure(result, /site staging requires branch dev/u);
});

test('production frontend build rejects a project environment from the wrong lane', () => {
  const productionTestnet = readBackendLane('production-testnet');
  if (productionTestnet.provisioning.kind !== 'provisioned') {
    throw new Error('production-testnet must be provisioned');
  }
  const result = runCommand(
    frontendScript,
    ['build', '--site', 'production', '--component', 'wallet-site'],
    {
      ...environmentWithoutDeploymentSecrets(),
      GITHUB_REF: 'refs/heads/main',
      VITE_TESTNET_SEAMS_PROJECT_ENVIRONMENT_ID: 'production',
      VITE_TESTNET_SEAMS_PUBLISHABLE_KEY: 'pk_testnet',
      VITE_TESTNET_NEAR_NETWORK: 'testnet',
      VITE_TESTNET_NEAR_RPC_URL: 'https://rpc.testnet.near.org',
      VITE_TESTNET_NEAR_EXPLORER: 'https://testnet.nearblocks.io',
      VITE_TESTNET_SIGNING_SESSION_PERSISTENCE_MODE: 'sealed_refresh_v1',
    },
  );

  expect(result.status).not.toBe(0);
  expect(`${result.stdout}\n${result.stderr}`).toContain(
    `VITE_TESTNET_SEAMS_PROJECT_ENVIRONMENT_ID must match production-testnet tenant environment ${productionTestnet.provisioning.gatewayDeploymentConfig.tenant.environmentId}`,
  );
});

test('Wallet-system and Console workflows use separate deployment authority', () => {
  const workflowOrder = [
    'build',
    'migrate',
    'deploy_signing_worker',
    'deploy_deriver_a',
    'deploy_deriver_b',
    'deploy_tenant_root_control_plane',
    'deploy_router',
    'deploy_wallet_runtime',
    'deploy_gateway',
  ];
  const planLabels = [
    'build',
    'migrate',
    'signing-worker',
    'deriver-a',
    'deriver-b',
    'tenant-root-control-plane',
    'router',
    'deploy wallet-runtime',
    'deploy gateway',
    'smoke',
  ];

  const lanes = [
    { id: 'staging-testnet', workflow: 'deploy-staging-backend.yml' },
    { id: 'production-testnet', workflow: 'deploy-production-testnet-backend.yml' },
    { id: 'production-mainnet', workflow: 'deploy-production-mainnet-backend.yml' },
  ] as const;

  for (const lane of lanes) {
    const result = runCommand(
      backendScript,
      ['plan', '--lane', lane.id, '--component', 'wallet-system'],
      environmentWithoutDeploymentSecrets(),
    );
    expect(result.status).toBe(0);
    expectOrdered(result.stdout, planLabels);

    const workflowSource = readFileSync(
      path.join(repoRoot, `.github/workflows/${lane.workflow}`),
      'utf8',
    );
    const workflow = parseYaml(workflowSource) as {
      env?: Readonly<Record<string, string>>;
      jobs: Record<
        string,
        { needs?: string | readonly string[]; env?: Readonly<Record<string, string>> }
      >;
    };
    const needsOf = (jobName: string): readonly string[] => {
      const job = workflow.jobs[jobName];
      expect(job, `missing workflow job ${jobName}`).toBeTruthy();
      return Array.isArray(job.needs) ? job.needs : job.needs ? [job.needs] : [];
    };

    expect(Object.keys(workflow.jobs)).toEqual(workflowOrder);
    expect(workflow.env?.DEPLOY_LANE).toBe(lane.id);
    expect(workflowSource).toContain(`--lane "$DEPLOY_LANE"`);
    expect(workflowSource).not.toContain('--target');
    expect(workflowSource).toContain(
      'deploy:backend build --lane "$DEPLOY_LANE" --component wallet-system',
    );
    expect(workflowSource).toContain(
      'deploy:backend smoke --lane "$DEPLOY_LANE" --component wallet-system',
    );
    expect(workflowSource).toContain(
      `test "$GITHUB_REF" = refs/heads/${lane.id === 'staging-testnet' ? 'dev' : 'main'}`,
    );
    const custodyPrefix =
      lane.id === 'staging-testnet'
        ? 'staging-'
        : lane.id === 'production-testnet'
          ? 'production-testnet-'
          : 'production-';
    for (const component of [
      'signing-worker',
      'deriver-a',
      'deriver-b',
      'tenant-root-control-plane',
      'mpc-router',
      'gateway',
    ]) {
      expect(workflowSource).toContain(`${custodyPrefix}${component}`);
    }
    expect(needsOf('build')).toEqual([]);
    expect(needsOf('migrate')).toEqual(['build']);
    expect(needsOf('deploy_signing_worker')).toEqual(['migrate']);
    expect(needsOf('deploy_deriver_a')).toEqual(['migrate']);
    expect(needsOf('deploy_deriver_b')).toEqual(['migrate']);
    expect(needsOf('deploy_tenant_root_control_plane')).toEqual([
      'deploy_signing_worker',
      'deploy_deriver_a',
      'deploy_deriver_b',
    ]);
    expect(needsOf('deploy_router')).toEqual(['deploy_tenant_root_control_plane']);
    expect(needsOf('deploy_wallet_runtime')).toEqual(['deploy_router', 'migrate']);
    expect(needsOf('deploy_gateway')).toEqual(['deploy_router', 'deploy_wallet_runtime']);
    expect(workflow.jobs.deploy_wallet_runtime.env?.STRIPE_API_SK).toBeUndefined();
    expect(workflow.jobs.deploy_gateway.env?.STRIPE_API_SK).toBeUndefined();
    expect(workflowSource).not.toContain('DEPLOYMENT_SECRETS_JSON');
  }

  const consoleWorkflowSource = readFileSync(
    path.join(repoRoot, '.github/workflows/deploy-console-backend.yml'),
    'utf8',
  );
  expect(consoleWorkflowSource).toContain('staging-console');
  expect(consoleWorkflowSource).toContain('production-testnet-console');
  expect(consoleWorkflowSource).toContain('production-console');
  expect(consoleWorkflowSource).toContain('--component console');
  expect(consoleWorkflowSource).toContain(
    'deploy:backend build --lane "$DEPLOY_LANE" --component console',
  );
  expect(consoleWorkflowSource).toContain(
    'deploy:backend smoke --lane "$DEPLOY_LANE" --component console',
  );
  expect(consoleWorkflowSource).not.toContain('DEPLOYMENT_SECRETS_JSON');
  expect(consoleWorkflowSource).not.toContain('ROUTER_AB_INTERNAL_SERVICE_AUTH_SECRET');

  expect(existsSync(path.join(repoRoot, '.github/workflows/deploy-production-backend.yml'))).toBe(
    false,
  );
});

test('frontend workflows contain one environment-bound deployment job', () => {
  for (const site of ['staging', 'production']) {
    const workflowSource = readFileSync(
      path.join(repoRoot, `.github/workflows/deploy-${site}-frontend.yml`),
      'utf8',
    );
    const workflow = parseYaml(workflowSource) as {
      env?: Readonly<Record<string, string>>;
      jobs: Record<string, { environment?: string }>;
    };

    expect(Object.keys(workflow.jobs)).toEqual(['deploy']);
    expect(workflow.jobs.deploy.environment).toBe(site);
    expect(workflow.env?.DEPLOY_SITE).toBe(site);
    expect(workflowSource).toContain('--site "$DEPLOY_SITE"');
    expect(workflowSource).toContain('CF_PAGES_PROJECT_WALLET_SITE:');
    expect(workflowSource).toContain('--component "$DEPLOY_COMPONENT"');
    expect(workflowSource).not.toContain('--target');
    if (site === 'staging') {
      expect(workflowSource).toContain('CF_PAGES_PROJECT_WALLET:');
      expect(workflowSource).not.toContain('CF_PAGES_PROJECT_WALLET_TESTNET:');
    } else {
      expect(workflowSource).toContain('CF_PAGES_PROJECT_WALLET_TESTNET:');
      expect(workflowSource).toContain('CF_PAGES_PROJECT_WALLET_MAINNET:');
    }
  }
});
