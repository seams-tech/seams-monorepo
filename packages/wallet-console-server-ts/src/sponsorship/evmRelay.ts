import { createEvmClient, parseRpcHexQuantity as parseEvmRpcHexQuantity } from './evmRpcClient';
import {
  type ServerEip1559UnsignedTx,
  computeEip1559TxHash,
  secp256k1PrivateKey32ToPublicKey33,
  secp256k1PublicKey33ToEthereumAddress,
  signSecp256k1Recoverable,
  encodeEip1559SignedTxFromSignature65,
  keccak256Bytes,
} from '@seams/wallet-server/cloud-host';
import { SponsoredEvmExecutionError } from './executionFailure';
import { normalizeEvmAddress, type SponsoredEvmCall } from './evm';
import type {
  SponsoredEvmCallExecutorConfig,
  SponsoredEvmChainExecutorConfig,
  SponsoredEvmExecutionResult,
} from './evmExecutorTypes';
import { resolveSponsoredEvmCallConfigFromRecord } from './evmExecutorConfig';

function normalizeTxHashOrThrow(value: unknown): `0x${string}` {
  const normalized = String(value || '').trim();
  if (!/^0x[0-9a-fA-F]{64}$/.test(normalized)) {
    throw new Error(`Invalid transaction hash: ${normalized || 'empty'}`);
  }
  return normalized as `0x${string}`;
}

function bytesToHex(bytes: Uint8Array): `0x${string}` {
  return `0x${Array.from(bytes)
    .map((entry) => entry.toString(16).padStart(2, '0'))
    .join('')}` as `0x${string}`;
}

function privateKeyHexToBytes(value: `0x${string}`): Uint8Array {
  return Uint8Array.from(Buffer.from(value.slice(2), 'hex'));
}

async function deriveEvmAddressFromPrivateKeyHex(
  privateKeyHex: `0x${string}`,
): Promise<`0x${string}`> {
  const publicKey33 = await secp256k1PrivateKey32ToPublicKey33(privateKeyHexToBytes(privateKeyHex));
  const addressHex = (await secp256k1PublicKey33ToEthereumAddress(publicKey33)) as `0x${string}`;
  const normalized = normalizeEvmAddress(addressHex);
  if (!normalized) {
    throw new Error('Failed to derive sponsor address from private key');
  }
  return normalized;
}

async function resolveFeeCaps(args: {
  rpcUrl: string;
  maxPriorityFeePerGasFloor: bigint;
  maxFeePerGasFloor: bigint;
}): Promise<{ maxPriorityFeePerGas: bigint; maxFeePerGas: bigint }> {
  const client = createEvmClient({ rpcUrl: args.rpcUrl });
  const [latestBlock, priorityFeeHex, gasPriceHex] = await Promise.all([
    client.getBlockByNumber({ blockTag: 'latest', timeoutMs: 6_000 }).catch(() => null),
    client
      .request({ method: 'eth_maxPriorityFeePerGas', params: [], timeoutMs: 6_000 })
      .catch(() => null),
    client.request({ method: 'eth_gasPrice', params: [], timeoutMs: 6_000 }).catch(() => null),
  ]);

  const baseFee = (() => {
    const raw = String(latestBlock?.baseFeePerGas || '').trim();
    if (!/^0x[0-9a-fA-F]+$/.test(raw)) return null;
    try {
      return parseEvmRpcHexQuantity(raw, 'baseFeePerGas');
    } catch {
      return null;
    }
  })();
  const priorityFee = (() => {
    const raw = String(priorityFeeHex || '').trim();
    if (!/^0x[0-9a-fA-F]+$/.test(raw)) return null;
    try {
      return parseEvmRpcHexQuantity(raw, 'eth_maxPriorityFeePerGas');
    } catch {
      return null;
    }
  })();
  const gasPrice = (() => {
    const raw = String(gasPriceHex || '').trim();
    if (!/^0x[0-9a-fA-F]+$/.test(raw)) return null;
    try {
      return parseEvmRpcHexQuantity(raw, 'eth_gasPrice');
    } catch {
      return null;
    }
  })();

  const resolvedPriority =
    priorityFee ?? (gasPrice && gasPrice > 0n ? gasPrice / 10n : args.maxPriorityFeePerGasFloor);
  const maxPriorityFeePerGas =
    resolvedPriority > args.maxPriorityFeePerGasFloor
      ? resolvedPriority
      : args.maxPriorityFeePerGasFloor;
  const dynamicMaxFeePerGas =
    baseFee && baseFee > 0n
      ? baseFee * 2n + maxPriorityFeePerGas
      : gasPrice && gasPrice > 0n
        ? gasPrice * 2n
        : 0n;
  const maxFeePerGas =
    dynamicMaxFeePerGas > args.maxFeePerGasFloor ? dynamicMaxFeePerGas : args.maxFeePerGasFloor;
  return {
    maxPriorityFeePerGas:
      maxPriorityFeePerGas < maxFeePerGas ? maxPriorityFeePerGas : maxFeePerGas / 2n,
    maxFeePerGas,
  };
}

async function prepareSponsoredEvmTransaction(args: {
  executor: SponsoredEvmChainExecutorConfig;
  call: SponsoredEvmCall;
}) {
  const client = createEvmClient({ rpcUrl: args.executor.rpcUrl });
  const nonce = await client.getTransactionCount({
    address: args.executor.sponsorAddress,
    blockTag: 'pending',
    timeoutMs: 10_000,
  });
  const feeCaps = await resolveFeeCaps({
    rpcUrl: args.executor.rpcUrl,
    maxPriorityFeePerGasFloor: args.executor.maxPriorityFeePerGasFloor,
    maxFeePerGasFloor: args.executor.maxFeePerGasFloor,
  });
  const unsignedTx: ServerEip1559UnsignedTx = {
    chainId: args.executor.chainId,
    nonce,
    maxPriorityFeePerGas: feeCaps.maxPriorityFeePerGas,
    maxFeePerGas: feeCaps.maxFeePerGas,
    gasLimit: args.call.gasLimit,
    to: args.call.to,
    value: args.call.value,
    data: args.call.data,
    accessList: [],
  };
  const digest32 = await computeEip1559TxHash(unsignedTx);
  const signature65 = await signSecp256k1Recoverable(
    digest32,
    privateKeyHexToBytes(args.executor.sponsorPrivateKeyHex),
  );
  const signedBytes = await encodeEip1559SignedTxFromSignature65({
    tx: unsignedTx,
    signature65,
  });
  return {
    client,
    unsignedTx,
    rawTxHex: bytesToHex(signedBytes),
    txHash: bytesToHex(keccak256Bytes(signedBytes)),
  };
}

async function broadcastSponsoredEvmTransaction(
  prepared: Awaited<ReturnType<typeof prepareSponsoredEvmTransaction>>,
): Promise<SponsoredEvmExecutionResult> {
  const returnedHash = normalizeTxHashOrThrow(
    await prepared.client.request({
      method: 'eth_sendRawTransaction',
      params: [prepared.rawTxHex],
      timeoutMs: 15_000,
    }),
  );
  if (returnedHash.toLowerCase() !== prepared.txHash.toLowerCase()) {
    throw new Error('Sponsored EVM RPC returned a different signed transaction hash');
  }
  await prepared.client.waitForTransactionReceipt({
    txHash: prepared.txHash,
    timeoutMs: 90_000,
    pollIntervalMs: 1_250,
    confirmations: 1,
    maxFeePerGasHint: prepared.unsignedTx.maxFeePerGas,
  });
  const receipt = await prepared.client.getTransactionReceipt({
    txHash: prepared.txHash,
    timeoutMs: 10_000,
  });
  if (!receipt) {
    throw new Error(
      `Sponsored EVM transaction ${prepared.txHash} finalized, but receipt could not be loaded`,
    );
  }
  const gasUsed = parseEvmRpcHexQuantity(String(receipt.gasUsed || '0x0'), 'gasUsed');
  const effectiveGasPrice = parseEvmRpcHexQuantity(
    String(receipt.effectiveGasPrice || receipt.gasPrice || '0x0'),
    'effectiveGasPrice',
  );
  const execution = {
    txHash: prepared.txHash,
    gasUsed: gasUsed.toString(10),
    effectiveGasPrice: effectiveGasPrice.toString(10),
    feeAmount: (gasUsed * effectiveGasPrice).toString(10),
  };
  const status = String(receipt.status || '')
    .trim()
    .toLowerCase();
  if (status && status !== '0x1' && status !== '0x01') {
    throw new SponsoredEvmExecutionError(
      { kind: 'reverted', execution },
      new Error(`Sponsored EVM transaction reverted (${prepared.txHash})`),
    );
  }
  return execution;
}

export async function executeSponsoredEvmCall(args: {
  executor: SponsoredEvmChainExecutorConfig;
  call: SponsoredEvmCall;
}): Promise<SponsoredEvmExecutionResult> {
  let prepared: Awaited<ReturnType<typeof prepareSponsoredEvmTransaction>>;
  try {
    prepared = await prepareSponsoredEvmTransaction(args);
  } catch (error: unknown) {
    throw new SponsoredEvmExecutionError({ kind: 'rejected' }, error);
  }
  try {
    return await broadcastSponsoredEvmTransaction(prepared);
  } catch (error: unknown) {
    if (error instanceof SponsoredEvmExecutionError) throw error;
    throw new SponsoredEvmExecutionError({ kind: 'indeterminate', txHash: prepared.txHash }, error);
  }
}

export async function resolveSponsoredEvmCallConfigFromEnv(
  env: NodeJS.ProcessEnv,
): Promise<SponsoredEvmCallExecutorConfig | null> {
  return await resolveSponsoredEvmCallConfigFromRecord({
    env: {
      SPONSORED_EVM_EXECUTORS_JSON: env.SPONSORED_EVM_EXECUTORS_JSON,
    },
    deriveSponsorAddress: deriveEvmAddressFromPrivateKeyHex,
  });
}

export function resolveSponsoredEvmExecutorForChain(
  config: SponsoredEvmCallExecutorConfig | null,
  chainId: number,
): SponsoredEvmChainExecutorConfig | null {
  if (!config) return null;
  return config.executorsByChain.get(chainId) || null;
}
