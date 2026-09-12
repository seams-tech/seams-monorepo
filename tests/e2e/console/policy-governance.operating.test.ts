import { expect, readConsoleSuccess, test } from './harness';

type PolicySummary = {
  readonly id: string;
  readonly name: string;
  readonly version: number;
};

type TransactionPolicyRules = {
  readonly maxAmountMinor: number | null;
  readonly blockedActions: readonly string[];
};

type SnapshotPolicy = {
  readonly id: string;
  readonly version: number;
  readonly status: string;
  readonly rules: TransactionPolicyRules;
};

type SnapshotAssignment = {
  readonly policyId: string;
  readonly scopeType: string;
  readonly scopeId: string;
};

type RuntimeSnapshot = {
  readonly orgId: string;
  readonly environmentId: string;
  readonly policies: readonly SnapshotPolicy[];
  readonly assignments: readonly SnapshotAssignment[];
};

function readPolicyString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function readPolicyNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function requireString(value: unknown, label: string): string {
  if (typeof value !== 'string') throw new Error(`${label} must be a non-empty string`);
  const result = value.trim();
  if (!result) throw new Error(`${label} must be a non-empty string`);
  return result;
}

function parseTransactionRules(value: unknown): TransactionPolicyRules | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
  if (Reflect.get(value, 'schemaVersion') !== 1) return null;

  const blockedActions = Reflect.get(value, 'blockedActions');
  const allowedChains = Reflect.get(value, 'allowedChains');
  const allowedContractCalls = Reflect.get(value, 'allowedContractCalls');
  if (
    !Array.isArray(blockedActions) ||
    blockedActions.some((action) => typeof action !== 'string') ||
    !Array.isArray(allowedChains) ||
    allowedChains.some((chain) => typeof chain !== 'string') ||
    !Array.isArray(allowedContractCalls)
  ) {
    return null;
  }
  for (const call of allowedContractCalls) {
    if (call === null || typeof call !== 'object' || Array.isArray(call)) return null;
    if (typeof Reflect.get(call, 'contractAddress') !== 'string') return null;
    const functions = Reflect.get(call, 'functions');
    if (!Array.isArray(functions) || functions.some((entry) => typeof entry !== 'string')) {
      return null;
    }
  }

  const maxAmountMinor = Reflect.get(value, 'maxAmountMinor');
  if (
    maxAmountMinor !== undefined &&
    (typeof maxAmountMinor !== 'number' || !Number.isInteger(maxAmountMinor) || maxAmountMinor < 0)
  ) {
    return null;
  }
  return {
    maxAmountMinor: typeof maxAmountMinor === 'number' ? maxAmountMinor : null,
    blockedActions,
  };
}

function parsePolicySummary(value: unknown): PolicySummary | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
  if (Reflect.get(value, 'kind') !== 'TRANSACTION') return null;
  if (!parseTransactionRules(Reflect.get(value, 'rules'))) return null;
  const id = readPolicyString(Reflect.get(value, 'id'));
  const name = readPolicyString(Reflect.get(value, 'name'));
  const version = readPolicyNumber(Reflect.get(value, 'version'));
  if (id === null || name === null || version === null || !Number.isInteger(version)) return null;
  return { id, name, version };
}

function parsePolicyListResponse(value: unknown, _label: string): readonly PolicySummary[] | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
  if (Reflect.get(value, 'ok') !== true) return null;
  const rows = Reflect.get(value, 'policies');
  if (!Array.isArray(rows)) return null;
  const policies: PolicySummary[] = [];
  for (const row of rows) {
    const policy = parsePolicySummary(row);
    if (!policy) return null;
    policies.push(policy);
  }
  return policies;
}

function parseSnapshotPolicy(value: unknown): SnapshotPolicy | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
  const id = readPolicyString(Reflect.get(value, 'id'));
  const version = readPolicyNumber(Reflect.get(value, 'version'));
  const status = readPolicyString(Reflect.get(value, 'status'));
  const rules = parseTransactionRules(Reflect.get(value, 'rules'));
  if (id === null || version === null || !Number.isInteger(version) || status === null || !rules) {
    return null;
  }
  return { id, version, status, rules };
}

function parseSnapshotAssignment(value: unknown): SnapshotAssignment | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
  const policyId = readPolicyString(Reflect.get(value, 'policyId'));
  const scopeType = readPolicyString(Reflect.get(value, 'scopeType'));
  const scopeId = readPolicyString(Reflect.get(value, 'scopeId'));
  if (policyId === null || scopeType === null || scopeId === null) return null;
  return { policyId, scopeType, scopeId };
}

function parseRuntimeSnapshotResponse(value: unknown, _label: string): RuntimeSnapshot | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
  if (Reflect.get(value, 'ok') !== true) return null;
  const snapshot = Reflect.get(value, 'snapshot');
  if (snapshot === null || typeof snapshot !== 'object' || Array.isArray(snapshot)) return null;
  const orgId = readPolicyString(Reflect.get(snapshot, 'orgId'));
  const environmentId = readPolicyString(Reflect.get(snapshot, 'environmentId'));
  const payload = Reflect.get(snapshot, 'payload');
  if (
    orgId === null ||
    environmentId === null ||
    payload === null ||
    typeof payload !== 'object' ||
    Array.isArray(payload)
  ) {
    return null;
  }
  const policyPayload = Reflect.get(payload, 'policy');
  const gasPayload = Reflect.get(payload, 'gasSponsorship');
  if (
    policyPayload === null ||
    typeof policyPayload !== 'object' ||
    Array.isArray(policyPayload) ||
    gasPayload === null ||
    typeof gasPayload !== 'object' ||
    Array.isArray(gasPayload)
  ) {
    return null;
  }
  const policyRows = Reflect.get(policyPayload, 'policies');
  const assignmentRows = Reflect.get(policyPayload, 'assignments');
  if (!Array.isArray(policyRows) || !Array.isArray(assignmentRows)) return null;
  const policies: SnapshotPolicy[] = [];
  for (const row of policyRows) {
    const policy = parseSnapshotPolicy(row);
    if (!policy) return null;
    policies.push(policy);
  }
  const assignments: SnapshotAssignment[] = [];
  for (const row of assignmentRows) {
    const assignment = parseSnapshotAssignment(row);
    if (!assignment) return null;
    assignments.push(assignment);
  }
  return { orgId, environmentId, policies, assignments };
}

function readSnapshotPolicyId(policy: SnapshotPolicy): string {
  return policy.id;
}

function findPolicy(rows: readonly PolicySummary[], policyName: string): PolicySummary {
  const policy = rows.find((row) => row.name === policyName);
  if (!policy) throw new Error(`Policy ${policyName} was not found`);
  return policy;
}

function findSnapshotPolicy(rows: readonly SnapshotPolicy[], policyId: string): SnapshotPolicy {
  const policy = rows.find((row) => row.id === policyId);
  if (!policy) throw new Error(`Runtime snapshot policy ${policyId} was not found`);
  return policy;
}

function findSnapshotAssignment(
  rows: readonly SnapshotAssignment[],
  policyId: string,
): SnapshotAssignment {
  const assignment = rows.find((row) => row.policyId === policyId);
  if (!assignment) throw new Error(`Runtime snapshot assignment for ${policyId} was not found`);
  return assignment;
}

test('policy governance publishes an effective runtime snapshot and audit deep link', async ({
  console,
}) => {
  const { page, api, tenant } = console;
  await console.provisionCompletedTenant();

  const policyName = `Operating policy ${tenant.orgId}`;
  await page.goto('/dashboard/policy-engine');
  await expect(page.getByLabel('Policy engine page')).toBeVisible();

  await page.getByRole('button', { name: 'Create policy', exact: true }).click();
  const createModal = page.getByRole('dialog', { name: 'Create policy modal' });
  await expect(createModal).toBeVisible();
  await createModal.getByLabel('Policy name').fill(policyName);
  await createModal.getByLabel('Max amount per transaction (minor units)').fill('5000');
  await createModal.getByRole('button', { name: 'Create draft', exact: true }).click();
  await expect(createModal).toBeHidden();

  const policiesResponse = await api.get('/console/policies?kind=TRANSACTION');
  const policyRows = await readConsoleSuccess(
    policiesResponse,
    'Policy list',
    parsePolicyListResponse,
  );
  const policy = findPolicy(policyRows, policyName);
  const policyId = policy.id;
  const policyVersion = policy.version;
  await expect(
    page.getByRole('row').filter({ hasText: policyName }).getByText(`v${policyVersion}`),
  ).toBeVisible();

  const policyRow = page.getByRole('row').filter({ hasText: policyName });
  await policyRow.getByRole('button', { name: `More actions for ${policyName}` }).click();
  await page.getByRole('menuitem', { name: 'Simulate', exact: true }).click();
  const simulateModal = page.getByRole('dialog', { name: 'Simulate policy modal' });
  await simulateModal.getByLabel('Action').selectOption('transfer');
  await simulateModal.getByLabel('Chain').selectOption('Ethereum');
  await simulateModal.getByLabel('Amount (minor units)').fill('1000');
  await simulateModal.getByRole('button', { name: 'Run simulation', exact: true }).click();
  await expect(simulateModal).toContainText('Decision ALLOW');
  await simulateModal.getByRole('button', { name: 'Close', exact: true }).click();

  await page
    .getByRole('row')
    .filter({ hasText: policyName })
    .getByRole('button', { name: `More actions for ${policyName}` })
    .click();
  await page.getByRole('menuitem', { name: 'Simulate', exact: true }).click();
  const rejectedSimulation = page.getByRole('dialog', { name: 'Simulate policy modal' });
  await rejectedSimulation.getByLabel('Action').selectOption('delete_key');
  await rejectedSimulation.getByLabel('Chain').selectOption('Ethereum');
  await rejectedSimulation.getByLabel('Amount (minor units)').fill('1000');
  await rejectedSimulation.getByRole('button', { name: 'Run simulation', exact: true }).click();
  await expect(rejectedSimulation).toContainText('Decision DENY');
  await rejectedSimulation.getByRole('button', { name: 'Close', exact: true }).click();

  await page
    .getByRole('row')
    .filter({ hasText: policyName })
    .getByRole('button', { name: `More actions for ${policyName}` })
    .click();
  await page.getByRole('menuitem', { name: 'Go live', exact: true }).click();
  const publishModal = page.getByRole('dialog', { name: 'Schedule live policy change modal' });
  await publishModal.getByRole('button', { name: 'Create approval request', exact: true }).click();
  await expect(publishModal.getByRole('button', { name: 'Approve', exact: true })).toBeVisible();
  await publishModal.getByRole('button', { name: 'Approve', exact: true }).click();
  const approvedRequest = publishModal.getByLabel('Approved request for live publish');
  await expect(approvedRequest.locator('option').filter({ hasText: 'APPROVED' })).toHaveCount(1);
  await approvedRequest.selectOption({ index: 1 });
  await publishModal.getByRole('button', { name: 'Publish live', exact: true }).click();
  await expect(publishModal).toBeHidden();
  await expect(page.getByRole('row').filter({ hasText: policyName })).toContainText('Published');

  const snapshotResponse = await api.get(
    `/console/runtime-snapshots/latest?environmentId=${encodeURIComponent(tenant.environmentId)}&projectId=${encodeURIComponent(tenant.projectId)}`,
  );
  const snapshot = await readConsoleSuccess(
    snapshotResponse,
    'Latest runtime snapshot',
    parseRuntimeSnapshotResponse,
  );
  expect(snapshot.orgId).toBe(tenant.orgId);
  expect(snapshot.environmentId).toBe(tenant.environmentId);
  const snapshotPolicy = findSnapshotPolicy(snapshot.policies, policyId);
  expect(snapshotPolicy.id).toBe(policyId);
  expect(snapshotPolicy.version).toBeGreaterThanOrEqual(policyVersion);
  expect(snapshotPolicy.status.toUpperCase()).toBe('PUBLISHED');
  const snapshotRules = snapshotPolicy.rules;
  expect(snapshotRules.maxAmountMinor).toBe(5000);
  expect(snapshotRules.blockedActions).toEqual(expect.arrayContaining(['delete_key']));
  const snapshotAssignment = findSnapshotAssignment(snapshot.assignments, policyId);
  expect(snapshotAssignment.scopeType.toUpperCase()).toBe('ENVIRONMENT');
  expect(snapshotAssignment.scopeId).toBe(tenant.environmentId);

  await page.goto('/dashboard/audit');
  await expect(page.getByLabel('Audit logs page')).toBeVisible();
  await page.getByLabel('Search events').fill(policyName);
  const publicationRow = page
    .getByRole('row')
    .filter({ hasText: 'Published policy' })
    .filter({ hasText: policyName });
  await expect(publicationRow).toBeVisible();
  await publicationRow.getByRole('button', { name: /^View/ }).click();
  await expect(publicationRow.getByRole('button', { name: /^Hide/ })).toBeVisible();
  const policyLink = page.getByRole('link', { name: policyName, exact: true }).first();
  const policyHref = requireString(await policyLink.getAttribute('href'), 'Audit policy deep link');
  expect(policyHref).toContain(`policyId=${encodeURIComponent(policyId)}`);
  await page.goto(policyHref);
  await expect(page).toHaveURL(/\/dashboard\/policy-engine\?policyId=[^&]+/);
  await expect(page.getByRole('dialog', { name: 'Policy details modal' })).toContainText(
    policyName,
  );
  await page.waitForLoadState('networkidle');
  await page.goto('/dashboard/policy-engine');
  const publishedRow = page.getByRole('row').filter({ hasText: policyName });
  await publishedRow.getByRole('button', { name: `More actions for ${policyName}` }).click();
  await page.getByRole('menuitem', { name: 'Delete', exact: true }).click();
  const deleteModal = page.getByRole('dialog', { name: 'Delete policy modal' });
  await deleteModal.getByRole('button', { name: 'Delete policy', exact: true }).click();
  await expect(deleteModal).toBeHidden();
  await expect(publishedRow).toHaveCount(0);
  const afterDeletion = await readConsoleSuccess(
    await api.get(`/console/runtime-snapshots/latest?environmentId=${encodeURIComponent(tenant.environmentId)}&projectId=${encodeURIComponent(tenant.projectId)}`),
    'Runtime snapshot after deletion', parseRuntimeSnapshotResponse,
  );
  expect(afterDeletion.policies.map(readSnapshotPolicyId)).not.toContain(policyId);

});
