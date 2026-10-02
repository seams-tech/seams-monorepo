import {
  consoleWalletKeyString,
  type ConsoleWalletKey,
} from '@seams-internal/wallet-console-shared';
import { parseConsoleWalletKey } from './requests';
import { type D1DatabaseLike } from '@seams/wallet-server/cloud-host';
import type {
  WalletRuntimeWalletIdentitiesResult,
  WalletRuntimeWalletIdentityRequest,
} from '@seams/wallet-server/cloud-host';
import { ConsoleWalletError } from './errors';
import type {
  ConsoleWalletBalanceRefreshResult,
  ConsoleWalletService,
  ConsoleWalletsContext,
  RefreshConsoleWalletBalancesRequest,
} from './service';
import type { ConsoleWallet, ConsoleWalletGasBalances } from './types';

const DEFAULT_NEAR_RPC_URL = 'https://rpc.testnet.fastnear.com';
const DEFAULT_TEMPO_RPC_URL = 'https://rpc.moderato.tempo.xyz';
const DEFAULT_ARC_RPC_URL = 'https://rpc.drpc.testnet.arc.network';
const TEMPO_ALPHA_USD_TOKEN = '0x20c0000000000000000000000000000000000001';
const BALANCE_OF_SELECTOR = '0x70a08231';
const BALANCE_CACHE_TTL_MS = 5 * 60 * 1_000;
const MAX_REFRESH_WALLETS = 10;
const RPC_TIMEOUT_MS = 8_000;
const TEMPO_ALPHA_USD_MINOR_DIVISOR = 10_000n;
const ARC_NATIVE_MINOR_DIVISOR = 10_000_000_000_000_000n;

type JsonRecord = Record<string, unknown>;

type WalletSignerIdentity = {
  readonly nearAccountId: string;
  readonly evmAddress: `0x${string}`;
};

type WalletBalanceSnapshot = {
  readonly wallet: ConsoleWalletKey;
  readonly nearAccountId: string;
  readonly evmAddress: `0x${string}`;
  readonly nearBalanceYocto: string;
  readonly tempoAlphaUsdRaw: string;
  readonly arcBalanceWei: string;
  readonly stablecoinBalanceMinor: number;
  readonly funded: boolean;
  readonly observedAtMs: number;
};

type WalletRefreshOutcome =
  | {
      readonly kind: 'refreshed';
      readonly snapshot: WalletBalanceSnapshot;
    }
  | {
      readonly kind: 'failed';
      readonly wallet: ConsoleWalletKey;
      readonly message: string;
    };

type JsonRpcResponse = {
  readonly result?: unknown;
  readonly error?: unknown;
};

class JsonRpcRequestError extends Error {
  constructor(
    message: string,
    readonly causeName: string,
  ) {
    super(message);
    this.name = 'JsonRpcRequestError';
  }
}

export interface D1ConsoleWalletBalanceReaderOptions {
  readonly resolveWalletIdentities: (
    input: WalletRuntimeWalletIdentityRequest,
  ) => Promise<WalletRuntimeWalletIdentitiesResult>;
  readonly nearRpcUrl?: string;
  readonly tempoRpcUrl?: string;
  readonly arcRpcUrl?: string;
  readonly fetchImpl?: typeof fetch;
}

export interface RefreshD1ConsoleWalletBalancesInput {
  readonly consoleDatabase: D1DatabaseLike;
  readonly namespace: string;
  readonly now: () => Date;
  readonly reader: D1ConsoleWalletBalanceReaderOptions;
  readonly ctx: ConsoleWalletsContext;
  readonly wallets: readonly ConsoleWallet[];
}

function isJsonRecord(value: unknown): value is JsonRecord {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function requiredString(value: unknown, label: string): string {
  const normalized = String(value || '').trim();
  if (!normalized) throw new Error(`${label} is missing`);
  return normalized;
}

function parseHexQuantity(value: unknown, label: string): bigint {
  const normalized = requiredString(value, label);
  if (!/^0x[0-9a-fA-F]+$/.test(normalized)) {
    throw new Error(`${label} is invalid`);
  }
  return BigInt(normalized);
}

function parseUnsignedDecimal(value: unknown, label: string): bigint {
  const normalized = requiredString(value, label);
  if (!/^\d+$/.test(normalized)) throw new Error(`${label} is invalid`);
  return BigInt(normalized);
}

function stablecoinMinorToNumber(value: bigint): number {
  if (value > BigInt(Number.MAX_SAFE_INTEGER)) return Number.MAX_SAFE_INTEGER;
  return Number(value);
}

function jsonRpcRequestError(raw: unknown, method: string): JsonRpcRequestError {
  const error = isJsonRecord(raw) ? raw : null;
  const cause = isJsonRecord(error?.cause) ? error.cause : null;
  const message = String(error?.data || error?.message || '').trim() || `${method} failed`;
  return new JsonRpcRequestError(message, String(cause?.name || '').trim());
}

export function parseRefreshConsoleWalletBalancesRequest(
  raw: unknown,
): RefreshConsoleWalletBalancesRequest {
  if (!isJsonRecord(raw) || !Array.isArray(raw.wallets)) {
    throw new ConsoleWalletError(
      'invalid_body',
      400,
      'wallets must be an array of scoped wallet keys',
    );
  }
  if (raw.wallets.length === 0 || raw.wallets.length > MAX_REFRESH_WALLETS) {
    throw new ConsoleWalletError(
      'invalid_body',
      400,
      `wallets must contain 1 to ${MAX_REFRESH_WALLETS} scoped wallet keys`,
    );
  }
  const wallets = new Map<string, ConsoleWalletKey>();
  for (const rawWallet of raw.wallets) {
    const wallet = parseConsoleWalletKey(rawWallet);
    wallets.set(consoleWalletKeyString(wallet), wallet);
  }
  return { wallets: [...wallets.values()] };
}

async function postJsonRpc(input: {
  readonly fetchImpl: typeof fetch;
  readonly rpcUrl: string;
  readonly method: string;
  readonly params: readonly unknown[] | JsonRecord;
}): Promise<unknown> {
  const controller = new AbortController();
  const timeoutId = globalThis.setTimeout(() => controller.abort(), RPC_TIMEOUT_MS);
  try {
    const response = await input.fetchImpl(input.rpcUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: Date.now(),
        method: input.method,
        params: input.params,
      }),
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`${input.method} returned HTTP ${response.status}`);
    const raw: unknown = await response.json();
    if (!isJsonRecord(raw)) throw new Error(`${input.method} returned an invalid response`);
    const payload: JsonRpcResponse = raw;
    if (payload.error !== undefined) {
      throw jsonRpcRequestError(payload.error, input.method);
    }
    if (!Object.prototype.hasOwnProperty.call(payload, 'result')) {
      throw new Error(`${input.method} returned no result`);
    }
    return payload.result;
  } finally {
    globalThis.clearTimeout(timeoutId);
  }
}

async function readNearBalance(input: {
  readonly fetchImpl: typeof fetch;
  readonly rpcUrl: string;
  readonly nearAccountId: string;
}): Promise<bigint> {
  try {
    const result = await postJsonRpc({
      fetchImpl: input.fetchImpl,
      rpcUrl: input.rpcUrl,
      method: 'query',
      params: {
        request_type: 'view_account',
        finality: 'final',
        account_id: input.nearAccountId,
      },
    });
    if (!isJsonRecord(result)) throw new Error('NEAR view_account returned an invalid result');
    return parseUnsignedDecimal(result.amount, 'NEAR account balance');
  } catch (error: unknown) {
    if (error instanceof JsonRpcRequestError && error.causeName === 'UNKNOWN_ACCOUNT') return 0n;
    throw error;
  }
}

async function readTempoAlphaUsdBalance(input: {
  readonly fetchImpl: typeof fetch;
  readonly rpcUrl: string;
  readonly evmAddress: `0x${string}`;
}): Promise<bigint> {
  const encodedAddress = input.evmAddress.slice(2).padStart(64, '0');
  const result = await postJsonRpc({
    fetchImpl: input.fetchImpl,
    rpcUrl: input.rpcUrl,
    method: 'eth_call',
    params: [
      {
        to: TEMPO_ALPHA_USD_TOKEN,
        data: `${BALANCE_OF_SELECTOR}${encodedAddress}`,
      },
      'latest',
    ],
  });
  return parseHexQuantity(result, 'Tempo AlphaUSD balance');
}

async function readArcBalance(input: {
  readonly fetchImpl: typeof fetch;
  readonly rpcUrl: string;
  readonly evmAddress: `0x${string}`;
}): Promise<bigint> {
  const result = await postJsonRpc({
    fetchImpl: input.fetchImpl,
    rpcUrl: input.rpcUrl,
    method: 'eth_getBalance',
    params: [input.evmAddress, 'latest'],
  });
  return parseHexQuantity(result, 'Arc native balance');
}

async function readWalletBalanceSnapshot(input: {
  readonly wallet: ConsoleWalletKey;
  readonly identity: WalletSignerIdentity;
  readonly observedAtMs: number;
  readonly reader: D1ConsoleWalletBalanceReaderOptions;
}): Promise<WalletBalanceSnapshot> {
  const fetchImpl = input.reader.fetchImpl || fetch.bind(globalThis);
  const [nearBalanceYocto, tempoAlphaUsdRaw, arcBalanceWei] = await Promise.all([
    readNearBalance({
      fetchImpl,
      rpcUrl: String(input.reader.nearRpcUrl || DEFAULT_NEAR_RPC_URL).trim(),
      nearAccountId: input.identity.nearAccountId,
    }),
    readTempoAlphaUsdBalance({
      fetchImpl,
      rpcUrl: String(input.reader.tempoRpcUrl || DEFAULT_TEMPO_RPC_URL).trim(),
      evmAddress: input.identity.evmAddress,
    }),
    readArcBalance({
      fetchImpl,
      rpcUrl: String(input.reader.arcRpcUrl || DEFAULT_ARC_RPC_URL).trim(),
      evmAddress: input.identity.evmAddress,
    }),
  ]);
  const stablecoinBalanceMinor = stablecoinMinorToNumber(
    tempoAlphaUsdRaw / TEMPO_ALPHA_USD_MINOR_DIVISOR + arcBalanceWei / ARC_NATIVE_MINOR_DIVISOR,
  );
  return {
    wallet: input.wallet,
    nearAccountId: input.identity.nearAccountId,
    evmAddress: input.identity.evmAddress,
    nearBalanceYocto: nearBalanceYocto.toString(),
    tempoAlphaUsdRaw: tempoAlphaUsdRaw.toString(),
    arcBalanceWei: arcBalanceWei.toString(),
    stablecoinBalanceMinor,
    funded: nearBalanceYocto > 0n || tempoAlphaUsdRaw > 0n || arcBalanceWei > 0n,
    observedAtMs: input.observedAtMs,
  };
}

async function loadFreshSnapshotKeys(input: {
  readonly database: D1DatabaseLike;
  readonly namespace: string;
  readonly orgId: string;
  readonly wallets: readonly ConsoleWalletKey[];
  readonly staleBeforeMs: number;
}): Promise<ReadonlySet<string>> {
  if (input.wallets.length === 0) return new Set();
  const selectors = input.wallets.map(
    () => '(project_id = ? AND environment_id = ? AND wallet_id = ?)',
  );
  const out = await input.database
    .prepare(
      `SELECT project_id, environment_id, wallet_id
       FROM wallet_balance_snapshots
      WHERE namespace = ? AND org_id = ? AND observed_at_ms >= ?
        AND (${selectors.join(' OR ')})`,
    )
    .bind(
      input.namespace,
      input.orgId,
      input.staleBeforeMs,
      ...input.wallets.flatMap((wallet) => [wallet.projectId, wallet.environmentId, wallet.id]),
    )
    .all<{ project_id: string; environment_id: string; wallet_id: string }>();
  const keys = new Set<string>();
  for (const row of out.results || []) {
    keys.add(
      consoleWalletKeyString({
        id: row.wallet_id,
        projectId: row.project_id,
        environmentId: row.environment_id,
      }),
    );
  }
  return keys;
}

async function loadWalletIdentities(
  input: RefreshD1ConsoleWalletBalancesInput,
  wallets: readonly ConsoleWallet[],
): Promise<ReadonlyMap<string, WalletSignerIdentity>> {
  if (wallets.length === 0) return new Map();
  const selectors = wallets.map(() => '(project_id = ? AND id = ?)');
  const environments = await input.consoleDatabase
    .prepare(
      `SELECT project_id, id, env_key FROM environments
      WHERE namespace = ? AND org_id = ? AND (${selectors.join(' OR ')})`,
    )
    .bind(
      input.namespace,
      input.ctx.orgId,
      ...wallets.flatMap((wallet) => [wallet.projectId, wallet.environmentId]),
    )
    .all<{ project_id: string; id: string; env_key: string }>();
  const environmentKeys = new Map<string, string>();
  for (const row of environments.results || []) {
    environmentKeys.set(JSON.stringify([row.project_id, row.id]), row.env_key);
  }
  // Console persists environment IDs; signer scope uses the environment's runtime key.
  const requested = new Map<string, ConsoleWallet>();
  const runtimeWallets: WalletRuntimeWalletIdentityRequest['wallets'][number][] = [];
  for (const wallet of wallets) {
    const envId = environmentKeys.get(JSON.stringify([wallet.projectId, wallet.environmentId]));
    if (!envId) throw new Error('Wallet environment was not found in its project');
    requested.set(JSON.stringify([wallet.projectId, envId, wallet.id]), wallet);
    runtimeWallets.push({ walletId: wallet.id, projectId: wallet.projectId, envId });
  }
  const result = await input.reader.resolveWalletIdentities({
    orgId: input.ctx.orgId,
    wallets: runtimeWallets,
  });
  const identities = new Map<string, WalletSignerIdentity>();
  for (const identity of result.identities) {
    const wallet = requested.get(
      JSON.stringify([identity.projectId, identity.envId, identity.walletId]),
    );
    if (!wallet || identities.has(consoleWalletKeyString(wallet))) {
      throw new Error('Wallet Runtime returned an unexpected or duplicate wallet identity');
    }
    identities.set(consoleWalletKeyString(wallet), identity);
  }
  return identities;
}

async function refreshWallet(input: {
  readonly wallet: ConsoleWallet;
  readonly identity: WalletSignerIdentity | undefined;
  readonly observedAtMs: number;
  readonly reader: D1ConsoleWalletBalanceReaderOptions;
}): Promise<WalletRefreshOutcome> {
  try {
    if (!input.identity) throw new Error('wallet signer identities are incomplete');
    const snapshot = await readWalletBalanceSnapshot({
      wallet: {
        id: input.wallet.id,
        projectId: input.wallet.projectId,
        environmentId: input.wallet.environmentId,
      },
      identity: input.identity,
      observedAtMs: input.observedAtMs,
      reader: input.reader,
    });
    return { kind: 'refreshed', snapshot };
  } catch (error: unknown) {
    return {
      kind: 'failed',
      wallet: {
        id: input.wallet.id,
        projectId: input.wallet.projectId,
        environmentId: input.wallet.environmentId,
      },
      message: error instanceof Error ? error.message : String(error),
    };
  }
}

function snapshotStatements(input: {
  readonly database: D1DatabaseLike;
  readonly namespace: string;
  readonly orgId: string;
  readonly snapshot: WalletBalanceSnapshot;
}) {
  const snapshot = input.snapshot;
  return [
    input.database
      .prepare(
        `INSERT INTO wallet_balance_snapshots (
           namespace,
           org_id,
           project_id,
           environment_id,
           wallet_id,
           near_account_id,
           evm_address,
           near_balance_yocto,
           tempo_alpha_usd_raw,
           arc_balance_wei,
           stablecoin_balance_minor,
           funded,
           observed_at_ms
         )
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (namespace, org_id, project_id, environment_id, wallet_id)
         DO UPDATE SET
           near_account_id = EXCLUDED.near_account_id,
           evm_address = EXCLUDED.evm_address,
           near_balance_yocto = EXCLUDED.near_balance_yocto,
           tempo_alpha_usd_raw = EXCLUDED.tempo_alpha_usd_raw,
           arc_balance_wei = EXCLUDED.arc_balance_wei,
           stablecoin_balance_minor = EXCLUDED.stablecoin_balance_minor,
           funded = EXCLUDED.funded,
           observed_at_ms = EXCLUDED.observed_at_ms`,
      )
      .bind(
        input.namespace,
        input.orgId,
        snapshot.wallet.projectId,
        snapshot.wallet.environmentId,
        snapshot.wallet.id,
        snapshot.nearAccountId,
        snapshot.evmAddress,
        snapshot.nearBalanceYocto,
        snapshot.tempoAlphaUsdRaw,
        snapshot.arcBalanceWei,
        snapshot.stablecoinBalanceMinor,
        snapshot.funded ? 1 : 0,
        snapshot.observedAtMs,
      ),
    input.database
      .prepare(
        `UPDATE wallet_index
            SET balance_minor = ?,
                updated_at_ms = ?
          WHERE namespace = ?
            AND org_id = ?
            AND project_id = ? AND environment_id = ? AND id = ?`,
      )
      .bind(
        snapshot.stablecoinBalanceMinor,
        snapshot.observedAtMs,
        input.namespace,
        input.orgId,
        snapshot.wallet.projectId,
        snapshot.wallet.environmentId,
        snapshot.wallet.id,
      ),
  ];
}

function applySnapshots(
  wallets: readonly ConsoleWallet[],
  snapshots: readonly WalletBalanceSnapshot[],
): ConsoleWallet[] {
  const snapshotsByKey = new Map(
    snapshots.map((snapshot) => [consoleWalletKeyString(snapshot.wallet), snapshot]),
  );
  return wallets.map((wallet) => {
    const snapshot = snapshotsByKey.get(consoleWalletKeyString(wallet));
    if (!snapshot) return wallet;
    return {
      ...wallet,
      balanceMinor: snapshot.stablecoinBalanceMinor,
      funded: snapshot.funded,
      gasBalances: gasBalancesFromSnapshot(snapshot),
      updatedAt: new Date(snapshot.observedAtMs).toISOString(),
    };
  });
}

function gasBalancesFromSnapshot(snapshot: WalletBalanceSnapshot): ConsoleWalletGasBalances {
  return {
    observedAt: new Date(snapshot.observedAtMs).toISOString(),
    near: {
      accountId: snapshot.nearAccountId,
      balanceYocto: snapshot.nearBalanceYocto,
    },
    tempo: {
      address: snapshot.evmAddress,
      alphaUsdRaw: snapshot.tempoAlphaUsdRaw,
    },
    arc: {
      address: snapshot.evmAddress,
      usdcRaw: snapshot.arcBalanceWei,
    },
  };
}

export async function refreshD1ConsoleWalletBalances(
  input: RefreshD1ConsoleWalletBalancesInput,
): Promise<ConsoleWalletBalanceRefreshResult> {
  const wallets = input.wallets;
  const observedAtMs = input.now().getTime();
  const freshKeys = await loadFreshSnapshotKeys({
    database: input.consoleDatabase,
    namespace: input.namespace,
    orgId: input.ctx.orgId,
    wallets,
    staleBeforeMs: observedAtMs - BALANCE_CACHE_TTL_MS,
  });
  const staleWallets = wallets.filter((wallet) => !freshKeys.has(consoleWalletKeyString(wallet)));
  const identities = await loadWalletIdentities(input, staleWallets);
  const outcomes = await Promise.all(
    staleWallets.map((wallet) =>
      refreshWallet({
        wallet,
        identity: identities.get(consoleWalletKeyString(wallet)),
        observedAtMs,
        reader: input.reader,
      }),
    ),
  );
  const snapshots = outcomes.flatMap((outcome) =>
    outcome.kind === 'refreshed' ? [outcome.snapshot] : [],
  );
  const statements = snapshots.flatMap((snapshot) =>
    snapshotStatements({
      database: input.consoleDatabase,
      namespace: input.namespace,
      orgId: input.ctx.orgId,
      snapshot,
    }),
  );
  if (statements.length > 0) await input.consoleDatabase.batch(statements);
  return {
    wallets: applySnapshots(wallets, snapshots),
    refreshedWallets: snapshots.map((snapshot) => snapshot.wallet),
    freshWallets: wallets
      .filter((wallet) => freshKeys.has(consoleWalletKeyString(wallet)))
      .map((wallet) => ({
        id: wallet.id,
        projectId: wallet.projectId,
        environmentId: wallet.environmentId,
      })),
    failures: outcomes.flatMap((outcome) =>
      outcome.kind === 'failed' ? [{ wallet: outcome.wallet, message: outcome.message }] : [],
    ),
  };
}

export function hasWalletBalanceRefresh(
  service: ConsoleWalletService,
): service is ConsoleWalletService & Required<Pick<ConsoleWalletService, 'refreshBalances'>> {
  return typeof service.refreshBalances === 'function';
}
