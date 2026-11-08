/* NEAR testnet reads and amounts for the Speak to pay page. The page reads the
   vault and the owner's balance straight from NEAR RPC; only owner calls go
   through the Wallet. */

export const VAULT = 'seams-wallet.testnet';
export const DEFAULT_CONTACT = 'seams-v1.testnet';
export const CALL_GAS = '30000000000000';
/** The vault keeps 0.1 NEAR of this for storage; the rest is the payable balance. */
export const CREATE_VAULT_DEPOSIT_YOCTO = '150000000000000000000000';
export const VAULT_TOP_UP_YOCTO = '100000000000000000000000';
export const RECEIPT_BASE_URL = 'https://testnet.nearblocks.io/txns/';
export const FAUCET_URL = 'https://docs.near.org/getting-started/faucet';

const YOCTO_PER_NEAR = 10n ** 24n;
const STORAGE_YOCTO_PER_BYTE = 10n ** 19n;
/** create_vault takes 0.15 NEAR, and each 30 Tgas call prepays about 0.03 NEAR. */
export const SETUP_NEED_YOCTO = 300_000_000_000_000_000_000_000n;
/** transfer_with_verdict prepays 50 Tgas: about 0.051 NEAR, refunded in part. */
export const PAYMENT_PREPAID_YOCTO = 51_000_000_000_000_000_000_000n;
const MAX_SPOKEN_HUNDREDTHS = 100_000_000n;

export type VaultView = Readonly<{
  balanceYocto: bigint;
  perTransferYocto: bigint;
  dailyYocto: bigint;
  spentTodayYocto: bigint;
  nextNonce: string;
}>;

export type VaultContact = Readonly<{ accountId: string; active: boolean }>;

export type SpokenAmount =
  | Readonly<{ ok: true; amount: string }>
  | Readonly<{ ok: false; message: string }>;

type RpcReply = Readonly<{ result?: unknown; error?: unknown }>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function yocto(value: unknown): bigint {
  if (typeof value !== 'string' || !/^\d+$/.test(value)) {
    throw new Error('NEAR RPC returned an amount that is not a whole number.');
  }
  return BigInt(value);
}

async function rpcQuery(rpcUrl: string, params: Record<string, unknown>): Promise<RpcReply> {
  const response = await fetch(rpcUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 'speak-to-pay', method: 'query', params }),
  });
  if (!response.ok) throw new Error(`NEAR RPC answered HTTP ${response.status}.`);
  const body: unknown = await response.json();
  if (!isRecord(body)) throw new Error('NEAR RPC returned no JSON object.');
  return body;
}

async function viewFunction(rpcUrl: string, method: string, ownerId: string): Promise<unknown> {
  const reply = await rpcQuery(rpcUrl, {
    request_type: 'call_function',
    finality: 'final',
    account_id: VAULT,
    method_name: method,
    args_base64: btoa(JSON.stringify({ owner_id: ownerId })),
  });
  const result = reply.result;
  if (!isRecord(result) || !Array.isArray(result.result)) {
    throw new Error(`${method} failed: ${JSON.stringify(reply.error ?? result).slice(0, 200)}`);
  }
  const bytes = Uint8Array.from(result.result as number[]);
  return JSON.parse(new TextDecoder().decode(bytes)) as unknown;
}

/** The owner's vault, or null when the owner has none yet. */
export async function readVault(rpcUrl: string, ownerId: string): Promise<VaultView | null> {
  const vault = await viewFunction(rpcUrl, 'get_vault', ownerId);
  if (vault === null) return null;
  if (!isRecord(vault) || !isRecord(vault.limits)) throw new Error('get_vault returned no vault.');
  return {
    balanceYocto: yocto(vault.balance),
    perTransferYocto: yocto(vault.limits.per_transfer),
    dailyYocto: yocto(vault.limits.daily),
    spentTodayYocto: yocto(vault.spent_today),
    nextNonce: String(vault.next_nonce),
  };
}

export async function readContacts(rpcUrl: string, ownerId: string): Promise<VaultContact[]> {
  const contacts = await viewFunction(rpcUrl, 'get_contacts', ownerId);
  if (!Array.isArray(contacts)) throw new Error('get_contacts returned no list.');
  return contacts.map((contact: unknown) => {
    if (!isRecord(contact) || typeof contact.account_id !== 'string') {
      throw new Error('get_contacts returned a contact without an account.');
    }
    return { accountId: contact.account_id, active: contact.active === true };
  });
}

/** The balance the account can spend (its amount less its storage stake), or null if it does not exist. */
export async function readFreeBalance(rpcUrl: string, accountId: string): Promise<bigint | null> {
  const reply = await rpcQuery(rpcUrl, {
    request_type: 'view_account',
    finality: 'final',
    account_id: accountId,
  });
  const account = reply.result;
  if (isRecord(account) && typeof account.amount === 'string') {
    const storage = BigInt(Number(account.storage_usage ?? 0));
    return yocto(account.amount) - storage * STORAGE_YOCTO_PER_BYTE;
  }
  if (JSON.stringify(reply.error ?? '').includes('UNKNOWN_ACCOUNT')) return null;
  throw new Error(`view_account failed: ${JSON.stringify(reply.error).slice(0, 200)}`);
}

const PANIC_PREFIX = 'Smart contract panicked: ';

/**
 * The contract's own error text for a transaction that NEAR executed and that
 * failed, such as "receiver is not a contact". Null while the outcome is not
 * known or when the failure carries no text.
 */
export async function readTransactionFailure(
  rpcUrl: string,
  transactionHash: string,
  senderAccountId: string,
): Promise<string | null> {
  const response = await fetch(rpcUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 'speak-to-pay',
      method: 'tx',
      params: {
        tx_hash: transactionHash,
        sender_account_id: senderAccountId,
        wait_until: 'EXECUTED_OPTIMISTIC',
      },
    }),
  });
  if (!response.ok) return null;
  const body: unknown = await response.json();
  if (!isRecord(body) || !isRecord(body.result) || !isRecord(body.result.status)) return null;
  const failure = body.result.status.Failure;
  if (!isRecord(failure)) return null;
  const actionError = failure.ActionError;
  if (!isRecord(actionError) || !isRecord(actionError.kind)) return JSON.stringify(failure);
  const functionCallError = actionError.kind.FunctionCallError;
  if (isRecord(functionCallError) && typeof functionCallError.ExecutionError === 'string') {
    const text = functionCallError.ExecutionError;
    return text.startsWith(PANIC_PREFIX) ? text.slice(PANIC_PREFIX.length) : text;
  }
  return JSON.stringify(actionError.kind);
}

/** Yocto as NEAR with at most four decimals, rounded down. */
export function formatNear(value: bigint): string {
  const sign = value < 0n ? '-' : '';
  const magnitude = value < 0n ? -value : value;
  const whole = magnitude / YOCTO_PER_NEAR;
  const fraction = ((magnitude % YOCTO_PER_NEAR) / 10n ** 20n).toString().padStart(4, '0');
  const trimmed = fraction.replace(/0+$/, '');
  return `${sign}${whole}${trimmed ? `.${trimmed}` : ''} NEAR`;
}

/** The verifier speaks whole hundredths of NEAR from 0.01 to 1,000,000. */
export function parseSpokenAmount(text: string): SpokenAmount {
  const value = text.trim();
  const match = /^(0|[1-9]\d{0,6})(?:\.(\d{1,2}))?$/.exec(value);
  if (!match) return { ok: false, message: 'Type an amount in NEAR with at most two decimals.' };
  const hundredths = BigInt(match[1]) * 100n + BigInt((match[2] ?? '').padEnd(2, '0'));
  if (hundredths < 1n || hundredths > MAX_SPOKEN_HUNDREDTHS) {
    return { ok: false, message: 'Type an amount from 0.01 to 1,000,000 NEAR.' };
  }
  return { ok: true, amount: value };
}
