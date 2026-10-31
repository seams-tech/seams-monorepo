import assert from 'node:assert/strict';
import { createHmac, randomUUID } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { parseEnv } from 'node:util';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { readConsoleTarget } from '../../../scripts/deployment-targets.mjs';

// Run only against the configured staging Console. Fixture rows remain as audit evidence.
assert.equal(process.env.SEAMS_STAGING_BILLING_ACCEPTANCE, '1');
const target = readConsoleTarget('staging-testnet');
const env = parseEnv(await readFile(process.env.SEAMS_STAGING_DEPLOYMENT_ENV, 'utf8'));
const manifest = JSON.parse(await readFile(process.env.SEAMS_STAGING_CONSOLE_MANIFEST, 'utf8'));
assert.equal(manifest.lane, 'staging-testnet');
assert.match(env.STRIPE_API_SK, /^(sk|rk)_test_/);
const output = resolve('.artifacts/release-0370/staging-billing');
await mkdir(output, { recursive: true });
const cfBase = `https://api.cloudflare.com/client/v4/accounts/${env.CLOUDFLARE_ACCOUNT_ID}`;
const cfHeaders = {
  Authorization: `Bearer ${env.CLOUDFLARE_API_TOKEN}`,
  'Content-Type': 'application/json',
};
const settingsResponse = await fetch(`${cfBase}/workers/scripts/${target.workerName}/settings`, {
  headers: cfHeaders,
});
assert.equal(settingsResponse.status, 200);
const settings = await settingsResponse.json();
const variables = new Map(settings.result.bindings.map(bindingEntry));
const namespace = variables.get('SEAMS_TENANT_STORAGE_NAMESPACE');
assert.equal(namespace, 'seams-staging');
const origin = new URL(variables.get('CONSOLE_BASE_URL')).origin;
assert.equal(origin, 'https://staging.console.seams.sh');

function bindingEntry(binding) {
  return [binding.name, binding.text];
}
class RemoteStatement {
  constructor(database, sql, params = []) {
    this.database = database;
    this.sql = sql;
    this.params = params;
  }
  bind(...params) {
    return new RemoteStatement(this.database, this.sql, params);
  }
  async run() {
    return (await this.database.batch([this]))[0];
  }
  async all() {
    return this.run();
  }
  async first(column) {
    const row = (await this.run()).results[0] ?? null;
    return column && row ? row[column] : row;
  }
}
class RemoteDatabase {
  prepare(sql) {
    return new RemoteStatement(this, sql);
  }
  async batch(statements) {
    const response = await fetch(`${cfBase}/d1/database/${target.database.id}/query`, {
      method: 'POST',
      headers: cfHeaders,
      body: JSON.stringify({ batch: statements.map(statementBody) }),
    });
    const body = await response.json();
    if (!response.ok || !body.success) throw new Error(JSON.stringify(body.errors));
    for (const result of body.result) if (!result.success) throw new Error(result.error);
    return body.result;
  }
}
function statementBody(statement) {
  return { sql: statement.sql, params: statement.params };
}
const database = new RemoteDatabase();
const migration = await database
  .prepare(
    "SELECT name FROM sqlite_master WHERE type='trigger' AND name='wallet_monthly_activity_admission'",
  )
  .first();
assert.ok(migration, 'Deploy billing migrations before this acceptance run');
const bundle = await build({
  bundle: true,
  format: 'esm',
  platform: 'node',
  write: false,
  tsconfig: 'tests/tsconfig.playwright.json',
  stdin: {
    resolveDir: process.cwd(),
    loader: 'ts',
    contents: `
    export {createCloudflareD1AccountServiceBundle} from './packages/console-server-ts/src/router/cloudflare/d1AccountServices';
    export {createStripeBillingProviderAdapter} from './packages/console-server-ts/src/billing/stripeProvider';
    export {getConsoleBillingD1Runtime} from './packages/console-server-ts/src/billing/d1';
    export {approveCreditLimit,CreditLimitApproval} from './packages/console-server-ts/src/billing/postpaid';
    export {ensureBillingCustomer} from './packages/console-server-ts/src/billing/customer';
    export {enableBillingService} from './tests/helpers/billingService.fixtures';
    export {PlatformPlanUsageEventV1} from './packages/console-shared-ts/src/accountPlatform';
  `,
  },
});
const bundlePath = `${output}/api.mjs`;
await writeFile(bundlePath, bundle.outputFiles[0].text);
const api = await import(pathToFileURL(bundlePath));
const now = new Date();
const priorTime = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 0, 12);
const month = new Date(priorTime).toISOString().slice(0, 7);
function fixtureClock() {
  return new Date(priorTime);
}
const run = `release037-${randomUUID()}`;
const owner = { orgId: run, actorUserId: `${run}-owner` };
const stripe = api.createStripeBillingProviderAdapter({ secretKey: env.STRIPE_API_SK });
const core = await api.createCloudflareD1AccountServiceBundle({
  database,
  namespace,
  now: fixtureClock,
  ensureSchema: false,
  externalDeletionGuard: null,
  billingProviders: { stripe },
  billingEmailConsoleBaseUrl: origin,
});
await core.orgProjects.upsertOrganization(owner, { name: 'v0.37 staging billing acceptance' });
await core.organizationAccess.bootstrapInitialOwner({
  orgId: owner.orgId,
  userId: owner.actorUserId,
  email: `${run}@billing.invalid`,
  displayName: 'Release acceptance',
});
await core.orgProjects.createProject(owner, { id: run, name: 'Isolated billing acceptance' });
const authority = { serviceId: 'wallet', deploymentId: 'staging-testnet' };
const instanceId = await api.enableBillingService(core, owner, run, authority, namespace);
const runtime = api.getConsoleBillingD1Runtime(core.billing);
const customerRef = await api.ensureBillingCustomer({
  database,
  namespace,
  orgId: run,
  stripe,
  nowMs: priorTime,
});
async function stripePost(path, values) {
  const response = await fetch(`https://api.stripe.com/v1/${path}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.STRIPE_API_SK}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams(values),
  });
  return { status: response.status, body: await response.json() };
}
async function attachCard(token) {
  const result = await stripePost('payment_methods', { type: 'card', 'card[token]': token });
  assert.equal(result.status, 200);
  const method = result.body;
  assert.equal(
    (await stripePost(`payment_methods/${method.id}/attach`, { customer: customerRef })).status,
    200,
  );
  await stripe.setDefaultPaymentMethod({ customerRef, paymentMethodRef: method.id });
  await database
    .prepare(
      `INSERT INTO billing_payment_methods(namespace,org_id,billing_account_id,provider_method_ref,brand,last4,exp_month,exp_year,status,verified_at_ms,updated_at_ms)
    SELECT namespace,org_id,billing_account_id,?,?,?,?,?,'usable',?,? FROM billing_payment_customers WHERE namespace=? AND org_id=?
    ON CONFLICT(namespace,org_id) DO UPDATE SET provider_method_ref=excluded.provider_method_ref,updated_at_ms=excluded.updated_at_ms`,
    )
    .bind(
      method.id,
      method.card.brand,
      method.card.last4,
      method.card.exp_month,
      method.card.exp_year,
      priorTime,
      Date.now(),
      namespace,
      run,
    )
    .run();
}
await attachCard('tok_chargeCustomerFail');
async function approve(amount, operation) {
  await api.approveCreditLimit(
    runtime,
    { userId: 'release-acceptance-operator', platformSupport: true },
    api.CreditLimitApproval.parse({
      orgId: run,
      creditLimitMinor: amount,
      reason: 'Isolated staging release acceptance',
      operationId: `${run}:${operation}`,
    }),
  );
}
await approve(20000, 'initial');
await core.freePlan.startPlan(owner, 'growth');
const billingAccount = await database
  .prepare('SELECT id FROM organization_billing_accounts WHERE namespace=? AND org_id=?')
  .bind(namespace, run)
  .first();
await database
  .prepare(
    `WITH RECURSIVE users(n) AS (SELECT 0 UNION ALL SELECT n+1 FROM users WHERE n<4999)
 INSERT INTO billing_plan_usage_facts(namespace,org_id,billing_account_id,month_utc,kind,fact_key,environment_id,recorded_at_ms)
 SELECT ?,?,?,?,'active_user',?||':existing-'||n,?,? FROM users`,
  )
  .bind(namespace, run, billingAccount.id, month, `${run}:prod`, `${run}:prod`, priorTime)
  .run();
const exposure = await database
  .prepare('SELECT unpaid_minor FROM billing_postpaid_exposure WHERE namespace=? AND org_id=?')
  .bind(namespace, run)
  .first();
await approve(exposure.unpaid_minor + 1, 'one-cent');
function login(userKey) {
  const event = api.PlatformPlanUsageEventV1.parse({
    version: 1,
    kind: 'plan_usage',
    eventId: `${run}:${userKey}`,
    instanceId,
    occurredAt: new Date(priorTime).toISOString(),
    measure: { kind: 'production_active_user', environmentId: `${run}:prod`, userKey },
  });
  assert.equal(event.kind, 'accepted');
  return core.freePlan.recordProductionUsage(authority, event.value);
}
const race = await Promise.all([login('new-a'), login('new-b'), login('new-c')]);
assert.equal(race.filter(accepted).length, 2);
assert.equal((await login('existing-0')).value.kind, 'already_counted');
function accepted(result) {
  return result.kind === 'accepted';
}
await approve(20000, 'restore');
const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
const claims = {
  sub: owner.actorUserId,
  orgId: run,
  kind: 'console_session_v1',
  iat: Math.floor(Date.now() / 1000),
  exp: Math.floor(Date.now() / 1000) + 1800,
  jti: randomUUID(),
  iss: variables.get('CONSOLE_SESSION_ISSUER'),
  aud: variables.get('CONSOLE_SESSION_AUDIENCE'),
};
const payload = Buffer.from(JSON.stringify(claims)).toString('base64url');
const token = `${header}.${payload}.${createHmac('sha256', manifest.secrets.CONSOLE_SESSION_HMAC_SECRET).update(`${header}.${payload}`).digest('base64url')}`;
async function consoleRequest(path, method = 'GET') {
  const response = await fetch(`${origin}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      Origin: origin,
      'Content-Type': 'application/json',
    },
    ...(method === 'POST' ? { body: '{}' } : {}),
  });
  const body = await response.json();
  assert.equal(response.status, 200, JSON.stringify(body));
  assert.equal(body.ok, true);
  return body;
}
const initial = await consoleRequest('/console/billing/payment-account');
assert.equal(initial.account.policy.kind, 'postpaid');
await consoleRequest('/console/billing/payment-account/reconcile', 'POST');
const collection = await database
  .prepare(
    'SELECT provider_invoice_ref FROM billing_monthly_collections WHERE namespace=? AND org_id=? AND month_utc=?',
  )
  .bind(namespace, run, month)
  .first();
assert.ok(collection?.provider_invoice_ref);
const invoiceId = collection.provider_invoice_ref;
assert.equal((await stripePost(`invoices/${invoiceId}/pay`, {})).status, 402);
const failed = await consoleRequest('/console/billing/payment-account/reconcile', 'POST');
assert.ok(failed.account.exposure.graceDeadlineAt);
await attachCard('tok_visa');
const repaired = await consoleRequest('/console/billing/payment-account');
assert.equal(repaired.account.exposure.graceDeadlineAt, failed.account.exposure.graceDeadlineAt);
assert.equal((await stripePost(`invoices/${invoiceId}/pay`, {})).status, 200);
await consoleRequest('/console/billing/payment-account/reconcile', 'POST');
const paid = await consoleRequest('/console/billing/payment-account/reconcile', 'POST');
assert.equal(paid.account.exposure.graceDeadlineAt, null);
const payments = await database
  .prepare(
    "SELECT COUNT(*) AS count FROM billing_ledger_entries WHERE namespace=? AND org_id=? AND entry_type='INVOICE_PAYMENT'",
  )
  .bind(namespace, run)
  .first();
assert.equal(payments.count, 1);
await consoleRequest('/console/billing/plan/free', 'POST');
const evidence = {
  version: '0.37.0',
  verifiedAt: new Date().toISOString(),
  origin,
  orgId: run,
  month,
  stripeMode: 'test',
  concurrentNewMauAccepted: 2,
  concurrentNewMauRefused: 1,
  repeatedLoginAccepted: true,
  failedPaymentGrace: true,
  cardRepairPreservesDeadline: true,
  verifiedPaymentPostedOnce: true,
  freeRequestAccepted: true,
  account: paid.account,
};
await writeFile(`${output}/acceptance.json`, JSON.stringify(evidence, null, 2));
console.log(`Staging billing acceptance passed: ${output}/acceptance.json`);
