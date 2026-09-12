import type { RpcQueryRequest } from '@near-js/types';
import type { EvmClient } from '@/core/rpcClients/evm/EvmClient';
import type { NearClient } from '@/core/rpcClients/near/NearClient';
import type {
  DecodedNearFinalExecutionStatus,
  DecodedNearFinalExecutionOutcome,
} from '../../../packages/shared-ts/src/utils/nearRpcResults';

declare const outcome: DecodedNearFinalExecutionOutcome;
// @ts-expect-error A decoded transaction exposes only its validated fields.
void outcome.transaction.id;
const mixedStatus: DecodedNearFinalExecutionStatus = {
  SuccessValue: '',
  // @ts-expect-error Success and failure cannot coexist.
  Failure: { error_message: 'failed', error_type: 'ActionError' },
};
void mixedStatus;

declare const evmClient: EvmClient;
declare const nearClient: NearClient;
declare const query: RpcQueryRequest;

function decodeString(value: unknown): string {
  if (typeof value !== 'string') throw new Error('expected a string');
  return value;
}

const rawEvmResult = evmClient.request({ method: 'eth_chainId', params: [] });
// @ts-expect-error Generic EVM transport results stay unknown until decoded.
const chainId: Promise<string> = rawEvmResult;
void chainId;

// @ts-expect-error Generic NEAR queries require an operation-specific result decoder.
void nearClient.query(query);

void nearClient.query(query, decodeString);
