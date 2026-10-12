import type { WalletRegion } from './home';
import type { WalletRelocationExecution, WalletRelocationFailure } from './relocationExecution';
import { WALLET_RELOCATION_COOLDOWN_MS, type WalletRelocation } from './relocation';
import type { WalletPlacementStatus } from './relocationStatus';

type ExecutionView =
  | { readonly state: 'ready' | 'running'; readonly code?: never; readonly retryAtMs?: never }
  | {
      readonly state: 'retry_wait';
      readonly code: 'transport_unavailable' | 'authority_unavailable';
      readonly retryAtMs: number;
    }
  | {
      readonly state: 'blocked';
      readonly code: WalletRelocationFailure;
      readonly retryAtMs?: never;
    };

type ProgressView =
  | {
      readonly state: 'freezing' | 'copying' | 'verified' | 'activating';
      readonly availability: 'paused';
      readonly execution: ExecutionView;
    }
  | {
      readonly state: 'cleanup';
      readonly availability: 'active';
      readonly execution: ExecutionView;
    };

export type WalletPlacementView =
  | {
      readonly state: 'settled';
      readonly region: WalletRegion;
      readonly generation: number;
      readonly nextMoveAtMs: number;
      readonly move?: never;
      readonly code?: never;
    }
  | {
      readonly state: 'moving';
      readonly move: {
        readonly moveId: string;
        readonly sourceRegion: WalletRegion;
        readonly destinationRegion: WalletRegion;
        readonly sourceGeneration: number;
        readonly destinationGeneration: number;
        readonly admittedAtMs: number;
        readonly nextMoveAtMs: number;
        readonly progress: ProgressView;
      };
      readonly region?: never;
      readonly generation?: never;
      readonly nextMoveAtMs?: never;
      readonly code?: never;
    }
  | {
      readonly state: 'unavailable';
      readonly code: 'not_found' | 'wallet_not_established';
      readonly region?: never;
      readonly generation?: never;
      readonly nextMoveAtMs?: never;
      readonly move?: never;
    };

// Project only owner-visible state. Participant receipts and physical resources stay internal.
export function walletPlacementView(
  status: WalletPlacementStatus & { readonly state: 'moving' },
): WalletPlacementView & { readonly state: 'moving' };
export function walletPlacementView(status: WalletPlacementStatus): WalletPlacementView;
export function walletPlacementView(status: WalletPlacementStatus): WalletPlacementView {
  switch (status.state) {
    case 'settled':
      return {
        state: 'settled',
        region: status.home.region,
        generation: status.generation,
        nextMoveAtMs: status.nextMoveAtMs,
      };
    case 'unavailable':
      return { state: 'unavailable', code: status.code };
    case 'moving': {
      const move = status.move;
      const progress = move.progress;
      let view: ProgressView;
      switch (progress.state) {
        case 'freezing':
        case 'copying':
        case 'verified':
          view = {
            state: progress.state,
            availability: 'paused',
            execution: executionView(progress.execution),
          };
          break;
        case 'cutover':
          if (progress.activation.state === 'activated') {
            view = {
              state: 'cleanup',
              availability: 'active',
              execution: executionView(progress.execution),
            };
          } else {
            view = {
              state: 'activating',
              availability: 'paused',
              execution: executionView(progress.execution),
            };
          }
          break;
        case 'completed':
          throw new Error('Completed relocation must have settled placement');
        default:
          return assertNever(progress);
      }
      return {
        state: 'moving',
        move: {
          moveId: move.moveId,
          sourceRegion: move.source.region,
          destinationRegion: move.destination.region,
          sourceGeneration: move.sourceGeneration,
          destinationGeneration: move.destinationGeneration,
          admittedAtMs: move.admittedAtMs,
          nextMoveAtMs: move.admittedAtMs + WALLET_RELOCATION_COOLDOWN_MS,
          progress: view,
        },
      };
    }
    default:
      return assertNever(status);
  }
}

export type WalletRelocationStatusView =
  | (WalletPlacementView & { readonly state: 'moving' })
  | {
      readonly state: 'completed';
      readonly moveId: string;
      readonly sourceRegion: WalletRegion;
      readonly destinationRegion: WalletRegion;
      readonly sourceGeneration: number;
      readonly destinationGeneration: number;
      readonly admittedAtMs: number;
      readonly completedAtMs: number;
      readonly move?: never;
      readonly code?: never;
    };

export function walletRelocationStatusView(move: WalletRelocation): WalletRelocationStatusView {
  if (move.progress.state !== 'completed') {
    return walletPlacementView({ state: 'moving', move });
  }
  return {
    state: 'completed',
    moveId: move.moveId,
    sourceRegion: move.source.region,
    destinationRegion: move.destination.region,
    sourceGeneration: move.sourceGeneration,
    destinationGeneration: move.destinationGeneration,
    admittedAtMs: move.admittedAtMs,
    completedAtMs: move.progress.completedAtMs,
  };
}

function executionView(execution: WalletRelocationExecution): ExecutionView {
  switch (execution.state) {
    case 'ready':
    case 'running':
      return { state: execution.state };
    case 'retry_wait':
      return { state: 'retry_wait', code: execution.code, retryAtMs: execution.retryAtMs };
    case 'blocked':
      return { state: 'blocked', code: execution.code };
    default:
      return assertNever(execution);
  }
}

function assertNever(value: never): never {
  throw new Error(`Unexpected placement state: ${String(value)}`);
}
