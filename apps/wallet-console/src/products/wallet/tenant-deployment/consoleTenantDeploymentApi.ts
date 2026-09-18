import {
  buildConsoleJsonHeaders,
  fetchConsoleEndpoint,
  parseConsoleJson,
  requireConsoleBaseUrl,
} from '@core/dashboard/consoleHttp';
import { verifyCustodyStepUp } from '@wallet-product/derivation-root/consoleDerivationRootApi';

export type TenantDeploymentCutoverInput = {
  readonly credentialId: `ak_${string}`;
  readonly publishableKey: `pk_${string}`;
  readonly surfaces: {
    readonly applicationOrigin: string;
    readonly hostedWalletOrigin: string;
    readonly gatewayOrigin: string;
    readonly relyingPartyId: string;
  };
};

export type TenantDeploymentCutoverProgress =
  | { readonly kind: 'idle' }
  | { readonly kind: 'verifying_passkey' }
  | { readonly kind: 'planning' }
  | { readonly kind: 'preparing_tenant_root' }
  | { readonly kind: 'draining'; readonly secondsRemaining: number }
  | { readonly kind: 'checking_readiness' }
  | { readonly kind: 'activating' }
  | {
      readonly kind: 'complete';
      readonly operationId: string;
      readonly bindingRevision: string;
    }
  | { readonly kind: 'error'; readonly message: string };

type CutoverResponse = {
  readonly ok: true;
  readonly replayed: boolean;
  readonly cutover: {
    readonly state: {
      readonly kind: string;
      readonly binding?: { readonly revision?: string };
    };
  };
};

type SetProgress = (progress: TenantDeploymentCutoverProgress) => void;

const CUTOVER_STORAGE_KEY_PREFIX = 'seams.console.tenant-deployment.cutover.v1';
const SETUP_DRAIN_SECONDS = 31;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function requireCutoverResponse(value: unknown): CutoverResponse {
  if (!isRecord(value) || value.ok !== true || !isRecord(value.cutover)) {
    throw new Error('The Console returned an invalid deployment response.');
  }
  const state = value.cutover.state;
  if (!isRecord(state) || typeof state.kind !== 'string' || typeof value.replayed !== 'boolean') {
    throw new Error('The Console returned an invalid deployment state.');
  }
  const binding = state.binding;
  if (binding === undefined) {
    return {
      ok: true,
      replayed: value.replayed,
      cutover: { state: { kind: state.kind } },
    };
  }
  if (!isRecord(binding) || typeof binding.revision !== 'string') {
    throw new Error('The Console returned an invalid deployment binding.');
  }
  return {
    ok: true,
    replayed: value.replayed,
    cutover: { state: { kind: state.kind, binding: { revision: binding.revision } } },
  };
}

function errorMessage(response: Response, value: unknown): string {
  if (isRecord(value) && typeof value.message === 'string' && value.message.trim()) {
    return value.message.trim();
  }
  if (isRecord(value) && typeof value.code === 'string' && value.code.trim()) {
    return `Deployment operation failed: ${value.code.trim()}`;
  }
  return `Deployment operation failed with HTTP ${response.status}.`;
}

async function postCutover(path: string, body: unknown): Promise<CutoverResponse> {
  const base = requireConsoleBaseUrl();
  const response = await fetchConsoleEndpoint(
    `${base}${path}`,
    {
      method: 'POST',
      headers: buildConsoleJsonHeaders(),
      credentials: 'include',
      cache: 'no-store',
      body: JSON.stringify(body),
    },
    { baseUrl: base, path, operation: 'Tenant deployment cutover' },
  );
  const value: unknown = await parseConsoleJson(response);
  if (!response.ok) throw new Error(errorMessage(response, value));
  return requireCutoverResponse(value);
}

function cutoverOperationId(): string {
  const storageKey = `${CUTOVER_STORAGE_KEY_PREFIX}:${requireConsoleBaseUrl()}`;
  const stored = window.sessionStorage.getItem(storageKey)?.trim();
  if (stored?.startsWith('tco_')) return stored;
  const operationId = `tco_${crypto.randomUUID()}`;
  window.sessionStorage.setItem(storageKey, operationId);
  return operationId;
}

function pause(durationMs: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, durationMs));
}

async function waitForSetupDrain(setProgress: SetProgress): Promise<void> {
  for (let secondsRemaining = SETUP_DRAIN_SECONDS; secondsRemaining > 0; secondsRemaining -= 1) {
    setProgress({ kind: 'draining', secondsRemaining });
    await pause(1_000);
  }
}

function activeBindingRevision(response: CutoverResponse): string {
  if (response.cutover.state.kind !== 'active') {
    throw new Error('The deployment did not become active. Retry the same operation.');
  }
  const revision = response.cutover.state.binding?.revision;
  if (typeof revision !== 'string' || !revision.startsWith('tdb_')) {
    throw new Error('The active deployment revision is unavailable.');
  }
  return revision;
}

export async function activateTenantDeployment(input: {
  readonly cutover: TenantDeploymentCutoverInput;
  readonly setProgress: SetProgress;
}): Promise<void> {
  const operationId = cutoverOperationId();
  try {
    input.setProgress({ kind: 'verifying_passkey' });
    await verifyCustodyStepUp();

    input.setProgress({ kind: 'planning' });
    await postCutover('/console/tenant-deployment/cutovers', { operationId });

    input.setProgress({ kind: 'preparing_tenant_root' });
    await postCutover(`/console/tenant-deployment/cutovers/${operationId}/tenant-root`, {});

    await waitForSetupDrain(input.setProgress);

    input.setProgress({ kind: 'checking_readiness' });
    await postCutover(
      `/console/tenant-deployment/cutovers/${operationId}/readiness`,
      input.cutover,
    );

    input.setProgress({ kind: 'activating' });
    const activated = await postCutover(
      `/console/tenant-deployment/cutovers/${operationId}/activate`,
      {},
    );
    input.setProgress({
      kind: 'complete',
      operationId,
      bindingRevision: activeBindingRevision(activated),
    });
  } catch (error: unknown) {
    input.setProgress({
      kind: 'error',
      message:
        error instanceof Error
          ? error.message
          : 'Unable to activate the tenant deployment. Retry the same operation.',
    });
  }
}
