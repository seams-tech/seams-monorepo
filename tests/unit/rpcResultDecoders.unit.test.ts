import { expect, test } from '@playwright/test';
import { decodeJsonRpcEnvelope } from '../../packages/shared-ts/src/utils/jsonRpc';
import {
  decodeNearAccessKeyView,
  decodeNearAccountView,
  decodeNearBlockReference,
  decodeNearFinalExecutionOutcome,
  parseNearContractResult,
} from '../../packages/shared-ts/src/utils/nearRpcResults';
import { createEvmClient } from '../../packages/wallet/src/core/rpcClients/evm/EvmClient';

function evmRpcResponse(result: unknown): Response {
  return new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

class StaticEvmRpcFetch {
  constructor(private readonly result: unknown) {}

  async fetch(): Promise<Response> {
    return evmRpcResponse(this.result);
  }
}

test('NEAR rejects ambiguous status variants before interpreting success', () => {
  expect(() =>
    decodeNearFinalExecutionOutcome({
      final_execution_status: 'FINAL',
      receipts_outcome: [],
      status: { SuccessValue: '', Failure: { ActionError: 'failure' } },
    }),
  ).toThrow('expected exactly one variant');
});

test('contract results preserve UTF-8, large values, and plain text', () => {
  expect(parseNearContractResult([...new TextEncoder().encode(JSON.stringify('日本語'))])).toBe(
    '日本語',
  );
  const largeValue = 'x'.repeat(200000);
  expect(parseNearContractResult([...new TextEncoder().encode(JSON.stringify(largeValue))])).toBe(
    largeValue,
  );
  expect(parseNearContractResult([...new TextEncoder().encode('plain text')])).toBe('plain text');
  expect(parseNearContractResult([])).toBeNull();
  expect(() => parseNearContractResult([255])).toThrow();
});

test('JSON-RPC envelopes distinguish success, failure, and malformed bags', () => {
  expect(
    decodeJsonRpcEnvelope({
      jsonrpc: '2.0',
      id: 7,
      result: { value: 1 },
      providerExtension: true,
    }),
  ).toEqual({
    ok: true,
    value: { kind: 'success', id: 7, result: { value: 1 } },
  });

  expect(
    decodeJsonRpcEnvelope({
      jsonrpc: '2.0',
      id: 'request-8',
      error: { code: -32000, message: 'transaction rejected', data: { reason: 'nonce' } },
    }),
  ).toEqual({
    ok: true,
    value: {
      kind: 'failure',
      id: 'request-8',
      error: {
        code: -32000,
        message: 'transaction rejected',
        data: { reason: 'nonce' },
      },
    },
  });

  expect(
    decodeJsonRpcEnvelope({ jsonrpc: '2.0', id: 9, result: null, error: { message: 'mixed' } }),
  ).toEqual({ ok: false, error: 'response must contain exactly one of result or error' });
  expect(decodeJsonRpcEnvelope({ id: 10, result: null })).toEqual({
    ok: false,
    error: 'jsonrpc must equal 2.0',
  });
});

test('NEAR decoders normalize only the fields owned by each operation', () => {
  expect(
    decodeNearAccessKeyView({
      block_height: 42,
      block_hash: 'block-hash',
      nonce: 17,
      permission: 'FullAccess',
      providerExtension: 'ignored',
    }),
  ).toEqual({
    block_height: 42,
    block_hash: 'block-hash',
    nonce: 17n,
    permission: 'FullAccess',
  });

  expect(
    decodeNearAccountView({
      block_height: 43,
      block_hash: 'account-block-hash',
      amount: '1000000000000000000000000',
      locked: '0',
      code_hash: '11111111111111111111111111111111',
      storage_usage: 182,
      storage_paid_at: 0,
    }),
  ).toMatchObject({ amount: 1000000000000000000000000n, locked: 0n });

  expect(() => decodeNearBlockReference({ header: { hash: 'block-hash', height: '44' } })).toThrow(
    'header.height',
  );
  expect(() =>
    decodeNearAccessKeyView({
      block_height: 42,
      block_hash: 'block-hash',
      nonce: Number.MAX_SAFE_INTEGER + 1,
      permission: 'FullAccess',
    }),
  ).toThrow('expected a safe integer or decimal string');
});

test('named EVM operations decode consumed fields and discard provider extensions', async () => {
  const validFetch = new StaticEvmRpcFetch({
    blockNumber: '0x2a',
    status: '0x1',
    gasUsed: '0x5208',
    providerExtension: { trace: true },
  });
  const validClient = createEvmClient({
    rpcUrl: 'https://rpc.example.test',
    fetchImpl: validFetch.fetch.bind(validFetch),
  });
  await expect(
    validClient.getTransactionReceipt({ txHash: `0x${'11'.repeat(32)}` }),
  ).resolves.toEqual({ blockNumber: '0x2a', status: '0x1', gasUsed: '0x5208' });

  const malformedFetch = new StaticEvmRpcFetch({ blockNumber: 42 });
  const malformedClient = createEvmClient({
    rpcUrl: 'https://rpc.example.test',
    fetchImpl: malformedFetch.fetch.bind(malformedFetch),
  });
  await expect(
    malformedClient.getTransactionReceipt({ txHash: `0x${'22'.repeat(32)}` }),
  ).rejects.toThrow('eth_getTransactionReceipt result: blockNumber');
});
