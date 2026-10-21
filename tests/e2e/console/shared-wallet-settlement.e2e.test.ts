import { AccountDatabaseProbe } from '../../helpers/accountDatabaseProbe';
import { WalletMonthlyUsageAdapter } from '../../../packages/wallet-console-server-ts/src/billing/usage';
import { expect, test } from '@playwright/test';
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Miniflare } from 'miniflare';
import { unstable_splitSqlQuery } from 'wrangler';
import { keccak256 } from 'viem';
import { isD1DatabaseLike } from '@seams/wallet-server/cloud-host';
import {
  PlatformUsageEventV1,
  ServiceProvisionCommandV1,
  type PlatformResult,
} from '../../../packages/console-shared-ts/src/accountPlatform';
import type {
  D1DatabaseLike,
  D1PreparedStatementLike,
} from '../../../packages/console-server-ts/src/boundary/d1';
import { createCloudflareD1AccountServiceBundle } from '../../../packages/console-server-ts/src/router/cloudflare/d1AccountServices';
import { buildConsoleBillingInvoicePdf } from '../../../packages/console-server-ts/src/billing/pdf';
import { createD1ConsoleWalletEnvironmentService } from '../../../packages/wallet-console-server-ts/src/environments/d1';
import { createD1ConsoleSponsoredCallService } from '../../../packages/wallet-console-server-ts/src/sponsoredCalls/d1';
import { WalletExecutionFunds } from '../../../packages/wallet-console-server-ts/src/sponsorship/funds';
import { executeSponsoredEvmCall } from '../../../packages/wallet-console-server-ts/src/sponsorship/evmRelay';
import { createSponsoredNearDelegateExecutionAdapter } from '../../../packages/wallet-console-server-ts/src/sponsorship/nearExecutionAdapter';
import { executeSponsorshipAdapter } from '../../../packages/wallet-console-server-ts/src/sponsorship/executionAdapter';
import { assessFailedSponsoredEvmExecution } from '../../../packages/wallet-console-server-ts/src/router/routerApiSponsoredEvmCall';
import { assessThrownSignedDelegateExecution } from '../../../packages/wallet-console-server-ts/src/router/routerApiSignedDelegate';
import { resolveSponsorshipReplayOrMatch } from '../../../packages/wallet-console-server-ts/src/router/sponsorshipRuntime';
import { routeJson } from '@seams/wallet-server/cloud-host';
import type { ConsoleSponsoredCallRecord } from '../../../packages/wallet-console-server-ts/src/sponsoredCalls/types';
import type { WalletRuntimeExecuteSignedDelegateRequest } from '@seams/wallet-server/cloud-host';
import { createStaticSponsoredExecutionPricingService } from '../../../packages/wallet-console-server-ts/src/sponsorship/pricing';
import {
  reserveSponsoredPrepaidBalance,
  loadSponsoredPrepaidReservation,
  type SponsoredPrepaidReservationHandle,
} from '../../../packages/wallet-console-server-ts/src/sponsorship/prepaidBalance';
import {
  recordSponsoredExecution,
  reconcileSponsoredExecution,
  type FinalizedSponsoredPrepaidSettlement,
  type RecordSponsoredExecutionInput,
  type SponsorshipExecutionAssessment,
} from '../../../packages/wallet-console-server-ts/src/router/sponsorshipExecution';
import { activateWalletProject } from '../../helpers/accountWalletProject.fixtures';

const repository = fileURLToPath(new URL('../../../', import.meta.url));
const output = path.join(repository, '.artifacts/shared-account-platform/wallet-settlement');
const namespace = 'wallet-settlement-acceptance';
const deploymentId = 'wallet-settlement-acceptance-v1';
const owner = { orgId: 'wallet-settlement-account', actorUserId: 'verified-settlement-owner' };
const context = { orgId: owner.orgId, actorUserId: 'wallet-service-executor' };
const projectId = 'wallet-settlement-project';
const environmentId = `${projectId}:dev`;
const secondProjectId = 'wallet-settlement-second-project';
const secondEnvironmentId = `${secondProjectId}:dev`;
const nearChainId = 2_147_000_001;

function now(): Date {
  return new Date('2026-10-13T03:00:00.000Z');
}

function accepted<T, E>(result: PlatformResult<T, E>): T {
  if (result.kind === 'rejected') throw new Error(JSON.stringify(result.error));
  return result.value;
}

function runtime(): Miniflare {
  return new Miniflare({
    modules: true,
    script: 'export default { fetch() { return new Response("Wallet settlement acceptance"); } };',
    compatibilityDate: '2026-04-17',
    d1Databases: { CONSOLE_DB: 'wallet-settlement-acceptance' },
    d1Persist: path.join(output, 'state'),
  });
}

class InterruptedD1Authority extends AccountDatabaseProbe {
  private connection: 'connected' | 'lose_next_reply' = 'connected';
  lostReplies = 0;

  loseNextCommitReply(): void {
    this.connection = 'lose_next_reply';
  }

  async batch<T = unknown>(statements: readonly D1PreparedStatementLike[]): Promise<readonly T[]> {
    const result = await super.batch<T>(statements);
    if (this.connection === 'lose_next_reply') {
      this.connection = 'connected';
      this.lostReplies += 1;
      throw new Error('Acceptance transport lost the reply after D1 committed');
    }
    return result;
  }
}

class TimedOutEvmRpc {
  readonly methods: string[] = [];
  signedTransaction: string | null = null;

  constructor(
    private readonly fallback: typeof fetch,
    readonly interruption: 'before_broadcast' | 'after_broadcast',
  ) {}

  async fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    if (String(input) !== 'https://rpc.settlement.invalid') return await this.fallback(input, init);
    const request: unknown = JSON.parse(String(init?.body));
    if (request === null || typeof request !== 'object')
      throw new Error('Acceptance RPC body is invalid');
    const method = Reflect.get(request, 'method');
    if (typeof method !== 'string') throw new Error('Acceptance RPC method is invalid');
    this.methods.push(method);
    switch (method) {
      case 'eth_getTransactionCount':
        if (this.interruption === 'before_broadcast') {
          throw new DOMException('Acceptance RPC nonce lookup timed out', 'AbortError');
        }
        return this.response('0x0');
      case 'eth_getBlockByNumber':
        return this.response({ number: '0x1', baseFeePerGas: '0x1' });
      case 'eth_maxPriorityFeePerGas':
      case 'eth_gasPrice':
        return this.response('0x1');
      case 'eth_sendRawTransaction': {
        const params = Reflect.get(request, 'params');
        if (!Array.isArray(params) || typeof params[0] !== 'string') {
          throw new Error('Acceptance RPC signed transaction is invalid');
        }
        this.signedTransaction = params[0];
        throw new DOMException(
          'Acceptance RPC accepted the transaction and lost its reply',
          'AbortError',
        );
      }
      default:
        throw new Error(`Unexpected acceptance RPC method ${method}`);
    }
  }

  private response(result: unknown): Response {
    return new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result }), {
      headers: { 'content-type': 'application/json' },
    });
  }
}

async function evmTransportFault(interruption: 'before_broadcast' | 'after_broadcast') {
  const original = globalThis.fetch;
  const transport = new TimedOutEvmRpc(original, interruption);
  globalThis.fetch = transport.fetch.bind(transport);
  try {
    await executeSponsoredEvmCall({
      executor: {
        chainId: 1,
        rpcUrl: 'https://rpc.settlement.invalid',
        sponsorAddress: '0x7e5f4552091a69125d5dfcb7b8c2659029395bdf',
        sponsorPrivateKeyHex: '0x0000000000000000000000000000000000000000000000000000000000000001',
        maxPriorityFeePerGasFloor: 1n,
        maxFeePerGasFloor: 3n,
      },
      call: {
        to: '0x1111111111111111111111111111111111111111',
        data: '0x',
        value: 0n,
        gasLimit: 10n,
      },
    });
    throw new Error('Acceptance RPC interruption did not interrupt execution');
  } catch (error: unknown) {
    const outcome = assessFailedSponsoredEvmExecution(error);
    if (interruption === 'after_broadcast') {
      if (transport.signedTransaction === null)
        throw new Error('Acceptance transaction was never broadcast');
      expect(outcome.receiptStatus).toBe('broadcast_failed');
      expect(outcome.txOrExecutionRef).toBe(
        keccak256(Buffer.from(transport.signedTransaction.slice(2), 'hex')),
      );
    } else {
      expect(outcome.receiptStatus).toBe('rpc_rejected');
      expect(transport.signedTransaction).toBeNull();
    }
    return { outcome, methods: transport.methods, signedTransaction: transport.signedTransaction };
  } finally {
    globalThis.fetch = original;
  }
}

class TimedOutNearTransport {
  acceptedHash: string | null = null;

  async executeSignedDelegate(request: WalletRuntimeExecuteSignedDelegateRequest): Promise<never> {
    this.acceptedHash = request.hash;
    throw new DOMException('Acceptance NEAR service lost the execution reply', 'AbortError');
  }
}

async function nearTransportFault() {
  const transport = new TimedOutNearTransport();
  const adapter = createSponsoredNearDelegateExecutionAdapter({
    authService: transport,
    hash: 'near-uncertain',
    signedDelegate: {
      delegateAction: {
        senderId: 'sender.testnet',
        receiverId: 'receiver.testnet',
        actions: [
          { functionCall: { methodName: 'ping', args: [], gas: 30_000_000_000_000, deposit: '0' } },
        ],
        nonce: 1,
        maxBlockHeight: 100,
        publicKey: { keyType: 0, keyData: [1, 2, 3] },
      },
      signature: { keyType: 0, signatureData: [4, 5, 6] },
    },
    allowedDelegateAction: {
      receiverId: 'receiver.testnet',
      methods: ['ping'],
      maxDepositYocto: '0',
      allowTransfers: false,
    },
  });
  try {
    await executeSponsorshipAdapter(adapter);
    throw new Error('Acceptance NEAR interruption did not interrupt execution');
  } catch (error: unknown) {
    expect(transport.acceptedHash).toBe('near-uncertain');
    const outcome = assessThrownSignedDelegateExecution(error);
    expect(outcome.receiptStatus).toBe('broadcast_failed');
    expect(outcome.txOrExecutionRef).toBeNull();
    return { outcome, acceptedHash: transport.acceptedHash };
  }
}

async function databaseOf(worker: Miniflare): Promise<D1DatabaseLike> {
  const database = await worker.getD1Database('CONSOLE_DB');
  if (!isD1DatabaseLike(database)) throw new Error('Wallet settlement D1 binding is unavailable');
  return database;
}

async function migrate(database: D1DatabaseLike): Promise<readonly string[]> {
  const directory = path.join(
    repository,
    'packages/wallet-console-server-ts/migrations/d1-console',
  );
  const applied: string[] = [];
  for (const name of (await readdir(directory)).sort()) {
    if (!name.endsWith('.sql')) continue;
    for (const statement of unstable_splitSqlQuery(
      await readFile(path.join(directory, name), 'utf8'),
    )) {
      await database.prepare(statement).run();
    }
    applied.push(name);
  }
  return applied;
}

function pricing() {
  return createStaticSponsoredExecutionPricingService({
    evmByChain: new Map([
      [
        1,
        {
          chainId: 1,
          estimateFeePerGas: 1n,
          minorPerFeeUnitNumerator: 1n,
          minorPerFeeUnitDenominator: 3n,
          pricingVersion: 'wallet-evm-ceiling-v1',
        },
      ],
      [
        2,
        {
          chainId: 2,
          estimateFeePerGas: 0n,
          minorPerFeeUnitNumerator: 1n,
          minorPerFeeUnitDenominator: 3n,
          pricingVersion: 'wallet-zero-quote-v1',
        },
      ],
    ]),
    nearByChain: new Map([
      [
        nearChainId,
        {
          networkClass: 'TESTNET',
          estimateFeeAmountYocto: 10n,
          minorPerFeeUnitNumerator: 2n,
          minorPerFeeUnitDenominator: 3n,
          pricingVersion: 'wallet-near-ceiling-v1',
        },
      ],
    ]),
  });
}

async function compose(database: D1DatabaseLike) {
  const core = await createCloudflareD1AccountServiceBundle({
    database,
    namespace,
    ensureSchema: true,
    now,
    externalDeletionGuard: null,
    billingEmailConsoleBaseUrl: 'https://console.settlement.invalid',
  });
  const environments = await createD1ConsoleWalletEnvironmentService({
    database,
    namespace,
    ensureSchema: true,
    now,
  });
  const calls = await createD1ConsoleSponsoredCallService({ database, namespace, now });
  return {
    core,
    environments,
    calls,
    funds: new WalletExecutionFunds({
      database,
      namespace,
      deploymentId,
      platform: core.accountPlatform,
      reservations: core.funds,
      usage: core.billingUsage,
    }),
    pricing: pricing(),
  };
}

type Product = Awaited<ReturnType<typeof compose>>;

async function seed(product: Product): Promise<void> {
  await product.core.orgProjects.upsertOrganization(owner, {
    name: 'Wallet settlement acceptance',
  });
  await product.core.organizationAccess.bootstrapInitialOwner({
    orgId: owner.orgId,
    userId: owner.actorUserId,
    email: 'owner@settlement.invalid',
    displayName: 'Settlement owner',
  });
  await product.core.orgProjects.createProject(owner, { id: projectId, name: 'Wallet settlement' });
  await product.core.orgProjects.createProject(owner, {
    id: secondProjectId,
    name: 'Second Wallet settlement project',
  });
  await product.core.billing.grantManualSupportCredit(owner, {
    amountMinor: 20,
    reasonCode: 'isolated_acceptance',
    note: 'Wallet settlement acceptance funds',
    idempotencyKey: 'settlement-credit',
  });
  await activateWalletProject({
    core: product.core,
    walletEnvironments: product.environments,
    namespace,
    deploymentId,
    context: owner,
    projectId,
  });
  await activateWalletProject({
    core: product.core,
    walletEnvironments: product.environments,
    namespace,
    deploymentId,
    context: owner,
    projectId: secondProjectId,
  });
}

interface ExecutionCase {
  readonly id: string;
  readonly chainFamily: 'evm' | 'near';
  readonly chainId: number;
  readonly feeAmount: string;
  readonly status: 'success' | 'broadcast_failed' | 'rpc_rejected';
  readonly transactionRef: string | null;
}

function executionFacts(execution: ExecutionCase) {
  if (execution.chainFamily === 'near') {
    return {
      chainFamily: 'near',
      intentKind: 'near_delegate',
      executorKind: 'near_delegate',
      accountRef: 'near:sender.testnet',
      targetRef: 'near:receiver.testnet',
      sponsorRef: 'near:relayer.testnet',
      resourceId: 'sender.testnet',
      feeUnit: 'yocto_near',
      billingPrefix: 'signed_delegate_debit',
    } as const;
  }
  return {
    chainFamily: 'evm',
    intentKind: 'evm_call',
    executorKind: 'evm_eoa',
    accountRef: 'near:wallet-acceptance',
    targetRef: 'evm:1:target',
    sponsorRef: 'evm:1:sponsor',
    resourceId: 'wallet-acceptance',
    feeUnit: 'wei',
    billingPrefix: 'sponsored_evm_call_debit',
  } as const;
}

async function reserve(
  product: Product,
  execution: ExecutionCase,
  selectedEnvironmentId: string,
): Promise<SponsoredPrepaidReservationHandle> {
  const facts = executionFacts(execution);
  return await reserveSponsoredPrepaidBalance({
    executionFunds: product.funds,
    pricing: product.pricing,
    ctx: context,
    chainFamily: facts.chainFamily,
    intentKind: facts.intentKind,
    executorKind: facts.executorKind,
    environmentId: selectedEnvironmentId,
    policyId: 'policy-acceptance',
    accountRef: facts.accountRef,
    targetRef: facts.targetRef,
    chainId: execution.chainId,
    sourceEventId: `${facts.chainFamily}:${facts.intentKind}:${execution.id}`,
    requestDetails: { call: { gasLimit: '10' } },
  });
}

function admittedWalletReservation(
  attempts: readonly PromiseSettledResult<SponsoredPrepaidReservationHandle>[],
): SponsoredPrepaidReservationHandle {
  let reservation: SponsoredPrepaidReservationHandle | null = null;
  let rejected = 0;
  for (const attempt of attempts) {
    switch (attempt.status) {
      case 'fulfilled':
        if (reservation)
          throw new Error('Two Wallet projects admitted the same organization execution');
        reservation = attempt.value;
        break;
      case 'rejected':
        expect(attempt.reason).toMatchObject({ code: 'operation_conflict', status: 409 });
        rejected += 1;
        break;
    }
  }
  expect(rejected).toBe(1);
  if (!reservation) throw new Error('No Wallet project admitted the execution');
  return reservation;
}

function environmentForReservation(handle: SponsoredPrepaidReservationHandle): string {
  if (handle.instanceId === `wallet:${projectId}`) return environmentId;
  if (handle.instanceId === `wallet:${secondProjectId}`) return secondEnvironmentId;
  throw new Error('Acceptance reservation has an unknown Wallet instance');
}

function forbiddenReplayMatch(): never {
  throw new Error('A foreign environment replay must not resolve a new execution policy');
}

function replayReceipt(record: ConsoleSponsoredCallRecord) {
  return routeJson(200, { recordId: record.id });
}

function assessment(execution: ExecutionCase): SponsorshipExecutionAssessment {
  const facts = executionFacts(execution);
  const succeeded = execution.status === 'success';
  return {
    succeeded,
    txOrExecutionRef: execution.transactionRef,
    receiptStatus: execution.status,
    feeUnit: facts.feeUnit,
    feeAmount: execution.feeAmount,
    executorKind: facts.executorKind,
    responseCode: succeeded ? 'ok' : 'outcome_unavailable',
    responseMessage: succeeded ? 'Execution accepted' : 'Execution outcome is unavailable',
    recordErrorCode: succeeded ? null : 'outcome_unavailable',
    recordErrorMessage: succeeded ? null : 'Execution outcome is unavailable',
  };
}

function buildRecord(
  execution: ExecutionCase,
  selectedEnvironmentId: string,
  settlement: {
    prepaidSettlement: FinalizedSponsoredPrepaidSettlement | null;
    billingLedgerEntryId: string | null;
  },
) {
  const facts = executionFacts(execution);
  const prepaid = settlement.prepaidSettlement;
  return {
    environmentId: selectedEnvironmentId,
    apiKeyId: 'accepted-publishable-key',
    apiKeyKind: 'publishable_key',
    route: facts.intentKind,
    policyId: 'policy-acceptance',
    policyNameAtEvent: 'Acceptance',
    templateId: null,
    chainFamily: facts.chainFamily,
    intentKind: facts.intentKind,
    accountRef: facts.accountRef,
    targetRef: facts.targetRef,
    sponsorRef: facts.sponsorRef,
    detailsJson: JSON.stringify({ executionId: execution.id, resourceId: facts.resourceId }),
    estimatedSpendMinor: prepaid?.estimatedSpendMinor ?? null,
    settledSpendMinor: prepaid?.settledSpendMinor ?? null,
    pricingVersion: prepaid?.pricingVersion ?? null,
    pricingSource: prepaid ? 'sponsorship_pricing_service' : null,
    billingLedgerEntryId: settlement.billingLedgerEntryId,
    prepaidReservationId: prepaid?.reservationId ?? null,
    charged: prepaid !== null && !prepaid.released && prepaid.settledSpendMinor > 0,
    chargedReason: null,
    settledAt: prepaid?.settledAt ?? null,
    idempotencyKey: execution.id,
  } as const;
}

function recordingInput(
  product: Product,
  execution: ExecutionCase,
  handle: SponsoredPrepaidReservationHandle,
): RecordSponsoredExecutionInput {
  const facts = executionFacts(execution);
  const outcome = assessment(execution);
  return {
    billing: product.core.billing,
    billingSourceEventIdPrefix: facts.billingPrefix,
    context,
    ledger: product.calls,
    walletId: facts.resourceId,
    buildRecord: buildRecord.bind(null, execution, environmentForReservation(handle)),
    assessment: outcome,
    occurredAt: now().toISOString(),
    prepaidSettlementInput: {
      reservation: handle,
      executionFunds: product.funds,
      pricing: product.pricing,
      chainId: execution.chainId,
      requestDetails: { call: { gasLimit: '10' } },
    },
  };
}

async function disableWallet(product: Product, selectedProjectId: string): Promise<void> {
  const instances = accepted(
    await product.core.accountPlatform.listInstances(owner, selectedProjectId),
  );
  const instance = instances[0];
  if (!instance || instance.state.kind !== 'active')
    throw new Error('Wallet instance is not active');
  const command = accepted(
    ServiceProvisionCommandV1.parse({
      version: 1,
      instanceId: instance.instanceId,
      operationId: `disable-after-admission:${selectedProjectId}`,
      desiredRevision: 2,
      command: 'disable',
      binding: instance.state.receipt.binding,
    }),
  );
  accepted(
    await product.core.accountPlatform.requestProvision(owner, { scope: instance.scope, command }),
  );
}

async function snapshot(database: D1DatabaseLike) {
  const result: Record<string, unknown> = {};
  for (const table of [
    'billing_funds_reservations',
    'billing_funds_terminal_receipts',
    'billing_execution_charges',
    'billing_wallet_execution_quotes',
    'billing_price_definitions',
    'billing_usage_events',
    'billing_usage_receipts',
    'billing_ledger_entries',
    'billing_ledger_postings',
    'sponsored_call_records',
    'console_email_outbox',
  ]) {
    result[table] = (await database.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()).results;
  }
  return result;
}

async function rowCount(database: D1DatabaseLike, table: string): Promise<number> {
  const result = await database
    .prepare(`SELECT COUNT(*) AS count FROM ${table}`)
    .first<number>('count');
  if (result === null) throw new Error(`Acceptance count is unavailable for ${table}`);
  return result;
}

test('Wallet execution settles overshoot, zero quotes, and uncertain NEAR outcomes once across restart', async () => {
  await rm(output, { recursive: true, force: true });
  await mkdir(output, { recursive: true });
  let worker = runtime();
  try {
    let database = new InterruptedD1Authority(await databaseOf(worker));
    const migrations = await migrate(database);
    let product = await compose(database);
    await seed(product);
    await database
      .prepare(
        `UPDATE billing_accounts SET low_balance_threshold_minor = 10,
      low_balance_warning_active = 0 WHERE namespace = ? AND org_id = ?`,
      )
      .bind(namespace, owner.orgId)
      .run();
    const evmFault = await evmTransportFault('after_broadcast');
    const rejectedFault = await evmTransportFault('before_broadcast');
    const nearFault = await nearTransportFault();
    const evm: ExecutionCase = {
      id: 'evm-overshoot',
      chainFamily: 'evm',
      chainId: 1,
      feeAmount: '95',
      status: 'success',
      transactionRef: evmFault.outcome.txOrExecutionRef,
    };
    const near: ExecutionCase = {
      id: 'near-uncertain',
      chainFamily: 'near',
      chainId: nearChainId,
      feeAmount: '0',
      status: 'broadcast_failed',
      transactionRef: nearFault.outcome.txOrExecutionRef,
    };
    const zero: ExecutionCase = {
      id: 'zero-quote',
      chainFamily: 'evm',
      chainId: 2,
      feeAmount: '0',
      status: 'success',
      transactionRef: 'accepted:zero-quote',
    };
    const rejected: ExecutionCase = {
      id: 'evm-before-broadcast-rejected',
      chainFamily: 'evm',
      chainId: 1,
      feeAmount: '0',
      status: 'rpc_rejected',
      transactionRef: rejectedFault.outcome.txOrExecutionRef,
    };
    const evmHandle = admittedWalletReservation(
      await Promise.allSettled([
        reserve(product, evm, environmentId),
        reserve(product, evm, secondEnvironmentId),
      ]),
    );
    const nearHandle = await reserve(product, near, environmentId);
    const zeroHandle = await reserve(product, zero, environmentId);
    const rejectedHandle = await reserve(product, rejected, environmentId);
    expect(evmHandle.estimatedSpendMinor).toBe(4);
    expect(nearHandle.estimatedSpendMinor).toBe(7);
    expect(zeroHandle.estimatedSpendMinor).toBe(0);
    await expect(reserve(product, evm, environmentForReservation(evmHandle))).rejects.toThrow(
      'already has a funds reservation',
    );
    const unknownEvm: ExecutionCase = { ...evm, status: 'broadcast_failed', feeAmount: '0' };
    const uncertainEvm = await recordSponsoredExecution(
      recordingInput(product, unknownEvm, evmHandle),
    );
    expect(uncertainEvm.txOrExecutionRef).toBe(evmFault.outcome.txOrExecutionRef);
    expect(
      accepted(
        await product.core.funds.getReservation(product.funds.authority, evmHandle.reservationId),
      ).kind,
    ).toBe('indeterminate');
    expect(await rowCount(database, 'wallet_monthly_usage_outbox')).toBe(0);
    const rejectedRecord = await recordSponsoredExecution(
      recordingInput(product, rejected, rejectedHandle),
    );
    expect(rejectedRecord.chargedReason).toBe('released_zero_spend');
    expect(
      accepted(
        await product.core.funds.getReservation(
          product.funds.authority,
          rejectedHandle.reservationId,
        ),
      ).kind,
    ).toBe('released');
    const uncertain = await recordSponsoredExecution(recordingInput(product, near, nearHandle));
    expect(uncertain.chargedReason).toBe('execution_indeterminate');
    expect(
      accepted(
        await product.core.funds.getReservation(product.funds.authority, nearHandle.reservationId),
      ).kind,
    ).toBe('indeterminate');
    await product.core.funds.markStaleIndeterminate({
      at: new Date('2026-10-14T03:00:00.000Z'),
      limit: 10,
    });
    expect(
      accepted(await product.core.funds.getSummary(product.funds.authority, evmHandle.instanceId))
        .reservedMinor,
    ).toBe(11);
    await disableWallet(product, projectId);
    await disableWallet(product, secondProjectId);
    database.loseNextCommitReply();
    const settled = await Promise.all([
      reconcileSponsoredExecution(recordingInput(product, evm, evmHandle)),
      reconcileSponsoredExecution(recordingInput(product, evm, evmHandle)),
    ]);
    expect(settled[0].id).toBe(settled[1].id);
    expect(settled[0].settledSpendMinor).toBe(32);
    expect(settled[0].pricingVersion).toBe('wallet-evm-ceiling-v1');
    expect(database.lostReplies).toBe(1);
    const heldBeforeCaptureFailure = accepted(
      await product.core.funds.getReservation(product.funds.authority, zeroHandle.reservationId),
    );
    await database
      .prepare(
        `CREATE TRIGGER interrupt_monthly_capture BEFORE INSERT ON wallet_monthly_usage_outbox
      BEGIN SELECT RAISE(ABORT, 'injected_monthly_capture_failure'); END`,
      )
      .run();
    await expect(
      recordSponsoredExecution(recordingInput(product, zero, zeroHandle)),
    ).rejects.toThrow('injected_monthly_capture_failure');
    expect(
      accepted(
        await product.core.funds.getReservation(product.funds.authority, zeroHandle.reservationId),
      ),
    ).toEqual(heldBeforeCaptureFailure);
    expect(await rowCount(database, 'sponsored_call_records')).toBe(3);
    expect(await rowCount(database, 'wallet_monthly_usage_outbox')).toBe(1);
    await database.prepare('DROP TRIGGER interrupt_monthly_capture').run();
    database.reset();
    const free = await recordSponsoredExecution(recordingInput(product, zero, zeroHandle));
    const settlementDatabaseWork = { calls: database.calls, statements: database.statements };
    expect(settlementDatabaseWork.calls).toBe(19);
    expect(free.charged).toBe(false);
    expect(free.chargedReason).toBe('settled_zero_spend');
    expect(
      accepted(
        await product.core.funds.getReservation(product.funds.authority, zeroHandle.reservationId),
      ).kind,
    ).toBe('settled');
    expect((await product.core.billing.getOverview(context)).creditBalanceMinor).toBe(-12);
    expect(await rowCount(database, 'sponsored_call_records')).toBe(4);
    expect(await rowCount(database, 'billing_execution_charges')).toBe(3);
    expect(await rowCount(database, 'billing_usage_events')).toBe(2);
    expect(await rowCount(database, 'billing_usage_receipts')).toBe(2);
    const warningCount = await database
      .prepare(
        'SELECT COUNT(*) AS count FROM billing_accounts WHERE low_balance_warning_active = 1',
      )
      .first<number>('count');
    expect(warningCount).toBe(1);
    expect(await rowCount(database, 'wallet_monthly_usage_outbox')).toBe(2);
    const beforeRestart = await snapshot(database);
    await writeFile(
      path.join(output, 'before-restart.json'),
      JSON.stringify(beforeRestart, null, 2),
    );
    await writeFile(
      path.join(output, 'accepted-reservations.json'),
      JSON.stringify([evmHandle, nearHandle, zeroHandle, rejectedHandle], null, 2),
    );
    await writeFile(
      path.join(output, 'execution-transport-faults.json'),
      JSON.stringify(
        {
          evm: evmFault,
          near: nearFault,
          rejectedBeforeBroadcast: rejectedFault,
        },
        null,
        2,
      ),
    );
    await worker.dispose();
    worker = runtime();
    database = new InterruptedD1Authority(await databaseOf(worker));
    product = await compose(database);
    const restoredEvm = await loadSponsoredPrepaidReservation({
      executionFunds: product.funds,
      instanceId: evmHandle.instanceId,
      executionId: evmHandle.sourceEventId,
    });
    const restoredNear = await loadSponsoredPrepaidReservation({
      executionFunds: product.funds,
      instanceId: nearHandle.instanceId,
      executionId: nearHandle.sourceEventId,
    });
    expect(restoredEvm).toEqual(evmHandle);
    const replay = await recordSponsoredExecution(recordingInput(product, evm, restoredEvm));
    expect(replay.id).toBe(settled[0].id);
    const foreignEnvironmentId =
      environmentForReservation(restoredEvm) === environmentId
        ? secondEnvironmentId
        : environmentId;
    const foreignReplay = await resolveSponsorshipReplayOrMatch({
      sponsoredCalls: product.calls,
      sponsorshipCtx: context,
      environmentId: foreignEnvironmentId,
      idempotencyKey: evm.id,
      buildReplayResponse: replayReceipt,
      resolveMatch: forbiddenReplayMatch,
    });
    expect(foreignReplay).toEqual({ kind: 'conflict', reason: 'environment_mismatch' });
    await expect(
      recordSponsoredExecution(recordingInput(product, { ...evm, feeAmount: '96' }, evmHandle)),
    ).rejects.toThrow('outcome has changed');
    const confirmedNear: ExecutionCase = {
      ...near,
      status: 'success',
      feeAmount: '12',
      transactionRef: 'accepted:near-uncertain',
    };
    const reconciled = await reconcileSponsoredExecution(
      recordingInput(product, confirmedNear, restoredNear),
    );
    expect(reconciled.id).toBe(uncertain.id);
    expect(reconciled.settledSpendMinor).toBe(8);
    expect(reconciled.pricingVersion).toBe('wallet-near-ceiling-v1');
    expect((await product.core.billing.getOverview(context)).creditBalanceMinor).toBe(-20);
    expect(
      accepted(await product.core.funds.getSummary(product.funds.authority, evmHandle.instanceId))
        .reservedMinor,
    ).toBe(0);
    expect(await rowCount(database, 'sponsored_call_records')).toBe(4);
    expect(await rowCount(database, 'billing_execution_charges')).toBe(4);
    expect(await rowCount(database, 'billing_usage_events')).toBe(3);
    expect(await rowCount(database, 'billing_usage_receipts')).toBe(3);
    const storedEvents = await database
      .prepare('SELECT payload_json FROM billing_usage_events ORDER BY event_id')
      .all<{ payload_json: string }>();
    for (const row of storedEvents.results || []) {
      const event = accepted(PlatformUsageEventV1.parse(JSON.parse(row.payload_json)));
      expect((await product.core.billingUsage.record(product.funds.authority, event)).kind).toBe(
        'accepted',
      );
    }
    expect((await product.core.billing.getOverview(context)).creditBalanceMinor).toBe(-20);
    const debits = await database
      .prepare(
        `SELECT source_event_id, amount_minor, description
      FROM billing_ledger_entries WHERE entry_type = 'PRODUCT_EXECUTION_DEBIT'
      ORDER BY source_event_id`,
      )
      .all();
    expect(debits.results).toEqual([
      {
        source_event_id: `signed_delegate_debit:${nearHandle.sourceEventId}`,
        amount_minor: -8,
        description: 'Product execution debit for sender.testnet',
      },
      {
        source_event_id: `sponsored_evm_call_debit:${evmHandle.sourceEventId}`,
        amount_minor: -32,
        description: 'Product execution debit for wallet-acceptance',
      },
    ]);
    expect(
      await database
        .prepare('SELECT COUNT(*) AS count FROM billing_ledger_postings WHERE amount_minor = 0')
        .first<number>('count'),
    ).toBe(0);
    expect(
      await database
        .prepare(
          'SELECT COUNT(*) AS count FROM billing_accounts WHERE low_balance_warning_active = 1',
        )
        .first<number>('count'),
    ).toBe(1);
    const generated = await product.core.billing.generateMonthlyInvoice(context, {
      periodMonthUtc: '2026-10',
    });
    if (!generated.invoice) throw new Error('Wallet settlement statement is unavailable');
    const lineItems = await product.core.billing.listInvoiceLineItems(
      context,
      generated.invoice.id,
    );
    await writeFile(
      path.join(output, 'statement.pdf'),
      buildConsoleBillingInvoicePdf({
        orgId: context.orgId,
        invoice: generated.invoice,
        lineItems,
        exportedAt: now(),
      }),
    );
    const monthly = new WalletMonthlyUsageAdapter({
      database,
      namespace,
      deploymentId,
      usage: product.core.billingUsage,
      planUsage: product.core.freePlan,
    });
    expect(await monthly.resumePending(20)).toEqual({ delivered: 2, pending: 0 });
    expect(await monthly.resumePending(20)).toEqual({ delivered: 0, pending: 0 });
    expect(await rowCount(database, 'wallet_monthly_usage_outbox')).toBe(2);
    expect((await product.core.billing.getOverview(context)).creditBalanceMinor).toBe(-320);
    const monthlyFacts = await database.prepare('SELECT * FROM wallet_monthly_usage_outbox').all();
    await writeFile(
      path.join(output, 'monthly-producer.json'),
      JSON.stringify(
        {
          facts: monthlyFacts.results,
          monthlyChargeMinor: 300,
          capturedBeforeRestart: 2,
          excluded: ['broadcast_failed', 'rpc_rejected', 'near_delegate'],
          replayCreatesNoNewFact: true,
          captureSharesSettlementTransaction: true,
          captureFailureRollsBackExecutionAndFunds: true,
        },
        null,
        2,
      ),
    );
    const after = await snapshot(database);
    await writeFile(path.join(output, 'reconciliation.json'), JSON.stringify(after, null, 2));
    await writeFile(
      path.join(output, 'report.json'),
      JSON.stringify(
        {
          version: 1,
          result: 'passed',
          settlementDatabaseWork,
          command:
            'pnpm -C tests exec playwright test -c playwright.config.ts e2e/console/shared-wallet-settlement.e2e.test.ts',
          migrations,
          postedBalanceMinor: -320,
          monthlyChargeMinor: 300,
          remainingHoldsMinor: 0,
          executionRecords: 4,
          canonicalExecutionCharges: 4,
          originalDebitKeysPreserved: true,
          rawUsageReceipts: 3,
          lowBalanceNotifications: warningCount,
          injectedLostCommitReplies: 1,
          quoteRounding: {
            evm: { estimated: 4, actual: 32 },
            near: { estimated: 7, actual: 8 },
            zero: 0,
          },
          verified: [
            'concurrent identical settlement',
            'replay after storage restart',
            'conflicting outcome rejection',
            'disable after admission',
            'timer retains uncertain holds',
            'explicit NEAR outcome reconciliation',
            'zero quote receipt without zero posting',
            'EVM broadcast timeout retains the independently verified signed transaction hash',
            'NEAR service transport timeout retains its hold without a transaction reference',
            'proved pre-broadcast rejection releases its hold',
            'two Wallet projects cannot admit the same organization execution concurrently',
            'foreign environment replay returns no execution receipt',
          ],
          billingDocument: 'statement.pdf',
        },
        null,
        2,
      ),
    );
  } finally {
    await worker.dispose();
  }
});
