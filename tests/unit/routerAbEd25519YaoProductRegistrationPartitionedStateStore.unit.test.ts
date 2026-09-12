import { expect, test } from '@playwright/test';
import {
  ROUTER_AB_ED25519_YAO_SHARED_STATE_RECORD_KEY_V1,
  createRouterAbEd25519YaoProductRegistrationPartitionedStateStoreV1,
  encodeRouterAbEd25519YaoProductRegistrationPartitionRecordV1,
  parseRouterAbEd25519YaoProductRegistrationPartitionRecordV1,
  type RouterAbEd25519YaoProductRegistrationPartitionBatchResultV1,
  type RouterAbEd25519YaoProductRegistrationPartitionMutationV1,
  type RouterAbEd25519YaoProductRegistrationPartitionRecordStoreV1,
  type RouterAbEd25519YaoProductRegistrationPartitionedStateStoreV1,
} from '../../packages/wallet-server/src/router/domains/ed25519Yao/capabilityLifecycle/routerAbEd25519YaoProductRegistrationPartitionedStateStore';
import { createRouterAbEd25519YaoProductRegistrationStateV1 } from '../../packages/wallet-server/src/router/domains/ed25519Yao/capabilityLifecycle/routerAbEd25519YaoProductRegistration';
import { InMemoryRouterAbEd25519YaoRecoveryService } from '../../packages/wallet-server/src/router/domains/ed25519Yao/recovery/routerAbEd25519YaoRecovery';
import { encodeRouterAbEd25519YaoProductRegistrationStateV1 } from '../../packages/wallet-server/src/router/domains/ed25519Yao/capabilityLifecycle/routerAbEd25519YaoProductRegistrationPersistence';
import type {
  VersionedJsonObject,
  VersionedJsonRecordReadResult,
} from '../../packages/wallet-server/src/router/framework/versionedJsonRecordStore';
import {
  runRouterAbEd25519YaoProductRegistrationRequestScopedV1,
  type RouterAbEd25519YaoProductRegistrationRequestScopedExecutionV1,
} from '../../packages/wallet-server/src/router/domains/ed25519Yao/capabilityLifecycle/routerAbEd25519YaoProductRegistrationRequestScopedRunner';
import {
  runRouterAbEd25519YaoRegistrationTwoPhaseV1,
  type RouterAbEd25519YaoRegistrationTwoPhaseBackendResultV1,
  type RouterAbEd25519YaoRegistrationTwoPhaseCompletionV1,
  type RouterAbEd25519YaoRegistrationTwoPhasePrepareResultV1,
} from '../../packages/wallet-server/src/router/domains/ed25519Yao/registration/routerAbEd25519YaoRegistrationTwoPhaseRunner';
import {
  InMemoryRouterAbEd25519YaoRegistrationService,
  type RouterAbEd25519YaoRegistrationBackend,
} from '../../packages/wallet-server/src/router/domains/ed25519Yao/registration/routerAbEd25519YaoRegistration';
import {
  InMemoryRouterAbEd25519YaoRegistrationIntentAuthorizationAdapter,
  routerAbEd25519YaoCredentialDigestHexV1,
} from '../../packages/wallet-server/src/router/domains/ed25519Yao/registration/routerAbEd25519YaoRegistrationIntentAuthorization';
import type { RouterAbEd25519YaoProductRegistrationStateV1 } from '../../packages/wallet-server/src/router/domains/ed25519Yao/capabilityLifecycle/routerAbEd25519YaoProductRegistration';
import { walletIdFromString } from '../../packages/shared-ts/src/utils/registrationIntent';
import { buildEd25519YaoCapabilityFixture } from '../helpers/ed25519YaoCapabilityFixtures';
import {
  buildLocalYaoRegistrationFixture,
  registrationExecuteFromAdmission,
} from './helpers/d1LocalDevYaoPersistence.fixtures';

type StoredRecord = {
  readonly value: VersionedJsonObject;
  readonly version: number;
};

type TwoPhaseClaim = {
  readonly kind: 'test_registration_execute_claim';
  readonly lifecycleId: string;
};

type TwoPhaseBackendResponse = { readonly accepted: true };

type TwoPhaseResponse = { readonly status: 'activated' };

type TwoPhaseRejection = { readonly code: 'rejected' };

class TwoPhaseTestHarness {
  readonly events: string[] = [];
  readonly store: RouterAbEd25519YaoProductRegistrationPartitionedStateStoreV1;
  readonly causeTerminalConflict: boolean;

  constructor(
    store: RouterAbEd25519YaoProductRegistrationPartitionedStateStoreV1,
    causeTerminalConflict = false,
  ) {
    this.store = store;
    this.causeTerminalConflict = causeTerminalConflict;
  }

  async prepare(
    state: RouterAbEd25519YaoProductRegistrationStateV1,
  ): Promise<
    RouterAbEd25519YaoRegistrationTwoPhasePrepareResultV1<
      TwoPhaseClaim,
      TwoPhaseResponse,
      TwoPhaseRejection
    >
  > {
    this.events.push('prepare');
    state.registration.lifecycleSessions.set('lifecycle-two-phase', 'executing');
    return {
      kind: 'claimed',
      state,
      claim: { kind: 'test_registration_execute_claim', lifecycleId: 'lifecycle-two-phase' },
    };
  }

  async backend(
    _claim: TwoPhaseClaim,
  ): Promise<RouterAbEd25519YaoRegistrationTwoPhaseBackendResultV1<TwoPhaseBackendResponse>> {
    this.events.push('backend');
    const snapshot = await this.store.load('lifecycle-two-phase');
    if (snapshot.state.registration.lifecycleSessions.get('lifecycle-two-phase') !== 'executing') {
      throw new Error('backend ran before the preclaim was persisted');
    }
    return { kind: 'response', value: { accepted: true } };
  }

  async complete(
    state: RouterAbEd25519YaoProductRegistrationStateV1,
    _claim: TwoPhaseClaim,
    _backend: TwoPhaseBackendResponse,
  ): Promise<RouterAbEd25519YaoRegistrationTwoPhaseCompletionV1<TwoPhaseResponse>> {
    this.events.push('complete');
    if (this.causeTerminalConflict) await this.commitWinner();
    state.registration.lifecycleSessions.set('lifecycle-two-phase', 'completed');
    return { state, value: { status: 'activated' } };
  }

  private async commitWinner(): Promise<void> {
    const winner = await this.store.load('lifecycle-two-phase');
    winner.state.registration.lifecycleSessions.set('lifecycle-two-phase', 'winner');
    const result = await this.store.commit({
      lifecycleId: 'lifecycle-two-phase',
      state: winner.state,
      baseline: winner.baseline,
    });
    if (result.kind !== 'stored') throw new Error('test winner must commit');
  }
}

async function uncertainTwoPhaseBackend(
  _claim: TwoPhaseClaim,
): Promise<RouterAbEd25519YaoRegistrationTwoPhaseBackendResultV1<TwoPhaseBackendResponse>> {
  return { kind: 'uncertain', message: 'backend response was lost' };
}

class MemoryPartitionRecordStore implements RouterAbEd25519YaoProductRegistrationPartitionRecordStoreV1 {
  readonly records = new Map<string, StoredRecord>();
  readManyCallCount = 0;

  async readMany(keys: readonly string[]): Promise<
    readonly {
      readonly key: string;
      readonly result: VersionedJsonRecordReadResult<VersionedJsonObject>;
    }[]
  > {
    this.readManyCallCount += 1;
    return keys.map((key) => {
      const record = this.records.get(key);
      return {
        key,
        result: record
          ? {
              kind: 'present' as const,
              value: record.value,
              version: String(record.version),
            }
          : { kind: 'missing' as const },
      };
    });
  }

  async putMany(
    mutations: readonly RouterAbEd25519YaoProductRegistrationPartitionMutationV1[],
  ): Promise<RouterAbEd25519YaoProductRegistrationPartitionBatchResultV1> {
    for (const mutation of mutations) {
      const current = this.records.get(mutation.key);
      if (mutation.expectedVersion === null) {
        if (current) return { kind: 'version_mismatch', key: mutation.key };
        continue;
      }
      if (!current || String(current.version) !== mutation.expectedVersion) {
        return { kind: 'version_mismatch', key: mutation.key };
      }
    }
    for (const mutation of mutations) {
      const current = this.records.get(mutation.key);
      this.records.set(mutation.key, {
        value: mutation.value,
        version: (current?.version ?? 0) + 1,
      });
    }
    return {
      kind: 'stored',
      versions: mutations.map((mutation) => ({
        key: mutation.key,
        version: String(this.records.get(mutation.key)?.version ?? 0),
      })),
    };
  }
}

async function executeRequestWithSession(
  state: RouterAbEd25519YaoProductRegistrationStateV1,
): Promise<{
  readonly state: RouterAbEd25519YaoProductRegistrationStateV1;
  readonly value: string;
}> {
  state.registration.lifecycleSessions.set('lifecycle-runner', 'session-runner');
  return { state, value: 'request-response' };
}

function createConflictExecutor(
  store: RouterAbEd25519YaoProductRegistrationPartitionedStateStoreV1,
): RouterAbEd25519YaoProductRegistrationRequestScopedExecutionV1<string> {
  return executeStaleRequestAfterWinner.bind(null, store);
}

async function executeStaleRequestAfterWinner(
  store: RouterAbEd25519YaoProductRegistrationPartitionedStateStoreV1,
  state: RouterAbEd25519YaoProductRegistrationStateV1,
): Promise<{
  readonly state: RouterAbEd25519YaoProductRegistrationStateV1;
  readonly value: string;
}> {
  state.registration.lifecycleSessions.set('lifecycle-conflict', 'stale-session');
  state.export.authorizationNonces.add('stale');
  const winner = await store.load('lifecycle-conflict');
  winner.state.export.authorizationNonces.add('winner');
  const committed = await store.commit({
    lifecycleId: 'lifecycle-conflict',
    state: winner.state,
    baseline: winner.baseline,
  });
  if (committed.kind !== 'stored') {
    throw new Error('Expected the concurrent winner to commit');
  }
  return { state, value: 'stale-response' };
}

test.describe('partitioned Gateway product-state composition', () => {
  test('round-trips shared and ceremony records through the versioned JSON codec', async () => {
    const state = createRouterAbEd25519YaoProductRegistrationStateV1();
    state.export.authorizationNonces.add('nonce-a');
    state.registration.lifecycleSessions.set('lifecycle-codec', 'session-codec');
    const shared = {
      kind: 'router_ab_ed25519_yao_product_registration_shared_record_v1' as const,
      value: {
        kind: 'router_ab_ed25519_yao_product_registration_shared_state_v1' as const,
        recoveryCapabilities: state.recovery.capabilities,
        recoveryIdentityCapabilities: state.recovery.identityCapabilities,
        recoverySessions: state.recovery.recoverySessions,
        exportAuthorizationNonces: state.export.authorizationNonces,
        exportAuthorizationUncertain: state.export.authorizationUncertain,
      },
    };
    const ceremony = {
      kind: 'router_ab_ed25519_yao_product_registration_ceremony_record_v1' as const,
      lifecycleId: 'lifecycle-codec',
      value: {
        kind: 'router_ab_ed25519_yao_product_registration_ceremony_state_v1' as const,
        lifecycleId: 'lifecycle-codec',
        registration: {
          states: state.registration.states,
          lifecycleSessions: state.registration.lifecycleSessions,
          admissionClaims: state.registration.admissionClaims,
        },
        authorization: { authorities: state.authorization.authorities },
        recovery: {
          recoveries: state.recovery.recoveries,
        },
        export: { exports: state.export.exports },
      },
    };
    expect(
      parseRouterAbEd25519YaoProductRegistrationPartitionRecordV1(
        encodeRouterAbEd25519YaoProductRegistrationPartitionRecordV1(shared),
      ),
    ).toEqual(shared);
    expect(
      parseRouterAbEd25519YaoProductRegistrationPartitionRecordV1(
        encodeRouterAbEd25519YaoProductRegistrationPartitionRecordV1(ceremony),
      ),
    ).toEqual(ceremony);

    const contaminatedState = createRouterAbEd25519YaoProductRegistrationStateV1();
    contaminatedState.registration.lifecycleSessions.set('lifecycle-codec', 'session-codec');
    contaminatedState.registration.lifecycleSessions.set('other-lifecycle', 'other-session');
    const encodedCeremony = encodeRouterAbEd25519YaoProductRegistrationPartitionRecordV1(ceremony);
    expect(
      parseRouterAbEd25519YaoProductRegistrationPartitionRecordV1({
        ...encodedCeremony,
        state: encodeRouterAbEd25519YaoProductRegistrationStateV1(contaminatedState),
      }),
    ).toBeNull();
  });

  test('loads empty records and commits shared plus one ceremony atomically', async () => {
    const backend = new MemoryPartitionRecordStore();
    const store = createRouterAbEd25519YaoProductRegistrationPartitionedStateStoreV1(backend);
    const empty = await store.load('lifecycle-a');
    expect(empty.baseline.sharedVersion).toBeNull();
    expect(empty.baseline.ceremonyVersion).toBeNull();

    const state = createRouterAbEd25519YaoProductRegistrationStateV1();
    state.registration.lifecycleSessions.set('lifecycle-a', 'session-a');
    state.export.authorizationNonces.add('first');
    await expect(
      store.commit({
        lifecycleId: 'lifecycle-a',
        state,
        baseline: empty.baseline,
      }),
    ).resolves.toEqual({
      kind: 'stored',
      sharedVersion: '1',
      ceremonyVersion: '1',
      executionVersion: null,
    });

    const loaded = await store.load('lifecycle-a');
    expect(loaded.state.registration.lifecycleSessions.get('lifecycle-a')).toBe('session-a');
    expect(backend.records.has(ROUTER_AB_ED25519_YAO_SHARED_STATE_RECORD_KEY_V1)).toBeTruthy();
  });

  test('persists a direct verified registration with an available intent authority', async () => {
    const lifecycleId = 'lifecycle-direct-verified-available';
    const registrationFixture = buildLocalYaoRegistrationFixture(lifecycleId);
    const capabilityFixture = buildEd25519YaoCapabilityFixture({
      walletId: walletIdFromString(`wallet-${lifecycleId}`),
      nearAccountId: `wallet-${lifecycleId}.testnet`,
      nearEd25519SigningKeyId: `ed25519ks_${lifecycleId}`,
      thresholdSessionId: `wallet-session-${lifecycleId}`,
      signerSlot: 1,
      signingWorkerId: 'signing-worker.local',
      participantIds: [1, 2],
      runtimePolicyScope: {
        orgId: 'org-direct-verified',
        projectId: 'project-direct-verified',
        envId: 'env-direct-verified',
        signingRootVersion: 'root-direct-verified-v1',
      },
      lifecycleId,
      signerSetId: 'ed25519:1',
      seed: 101,
    });
    const state = createRouterAbEd25519YaoProductRegistrationStateV1();
    const authorization = new InMemoryRouterAbEd25519YaoRegistrationIntentAuthorizationAdapter(
      state.authorization,
    );
    await expect(
      authorization.bindVerifiedIntent({
        kind: 'verified_registration_intent',
        registrationIntentGrant: registrationFixture.grant,
        intent: registrationFixture.intent,
        admissionRequest: capabilityFixture.capability.admissionRequest,
        expiresAtMs: Date.now() + 60_000,
      }),
    ).resolves.toEqual({ ok: true });
    expect(state.authorization.authorities[0]?.kind).toBe('available');

    const registrationBackend: RouterAbEd25519YaoRegistrationBackend = {
      admit: async () => ({
        ok: true,
        body: capabilityFixture.capability.admissionReceipt,
      }),
      execute: async () => {
        throw new Error('direct verified registration execution belongs to the store test');
      },
    };
    const registration = new InMemoryRouterAbEd25519YaoRegistrationService(
      registrationBackend,
      state.registration,
    );
    await expect(
      registration.admit(capabilityFixture.capability.admissionRequest),
    ).resolves.toMatchObject({
      ok: true,
    });

    const backend = new MemoryPartitionRecordStore();
    const store = createRouterAbEd25519YaoProductRegistrationPartitionedStateStoreV1(backend);
    const initial = await store.load(lifecycleId);
    await expect(
      store.commit({ lifecycleId, state, baseline: initial.baseline }),
    ).resolves.toMatchObject({ kind: 'stored', executionVersion: '1' });

    const persisted = await store.load(lifecycleId);
    expect(persisted.baseline.executionVersion).toBe('1');
    const persistedAuthority = persisted.state.authorization.authorities[0];
    if (!persistedAuthority) throw new Error('direct verified intent authority was not persisted');
    expect(persistedAuthority.kind).toBe('available');
    const claim = await store.claimRegistrationExecution({
      lifecycleId,
      request: registrationExecuteFromAdmission(capabilityFixture.capability.admissionReceipt),
      requestDigestSha256Hex: 'direct-verified-request-digest',
      credentialDigestSha256Hex: routerAbEd25519YaoCredentialDigestHexV1(
        persistedAuthority.credentialDigestSha256,
      ),
      nowMs: Date.now(),
    });
    expect(claim.kind).toBe('claimed');
  });

  test('persists shared terminal mutations after a fresh load without Map aliasing', async () => {
    const backend = new MemoryPartitionRecordStore();
    const store = createRouterAbEd25519YaoProductRegistrationPartitionedStateStoreV1(backend);
    const loaded = await store.load('lifecycle-alias');
    const capabilityFixture = buildEd25519YaoCapabilityFixture({
      walletId: walletIdFromString('wallet-alias-test'),
      nearAccountId: 'wallet-alias-test.testnet',
      nearEd25519SigningKeyId: 'near-ed25519-alias-key',
      thresholdSessionId: 'threshold-alias-session',
      signerSlot: 1,
      signingWorkerId: 'signing-worker-alias',
      participantIds: [1, 2],
      runtimePolicyScope: {
        orgId: 'org-alias',
        projectId: 'project-alias',
        envId: 'env-alias',
        signingRootVersion: 'root-alias-v1',
      },
      seed: 91,
    });
    const recoveryService = new InMemoryRouterAbEd25519YaoRecoveryService(
      {
        admitRecovery: async () => ({
          ok: false as const,
          status: 503 as const,
          code: 'test_unavailable',
          message: 'test backend unavailable',
        }),
        executeRecovery: async () => ({
          ok: false as const,
          status: 503 as const,
          code: 'test_unavailable',
          message: 'test backend unavailable',
        }),
        activateRecovery: async () => ({
          ok: false as const,
          status: 503 as const,
          code: 'test_unavailable',
          message: 'test backend unavailable',
        }),
      },
      loaded.state.recovery,
    );
    const installed = recoveryService.installPersistedActiveCapability(
      capabilityFixture.capability,
    );
    if (!installed.ok) throw new Error(installed.message);
    await expect(
      store.commit({
        lifecycleId: 'lifecycle-alias',
        state: loaded.state,
        baseline: loaded.baseline,
      }),
    ).resolves.toEqual({
      kind: 'stored',
      sharedVersion: '1',
      ceremonyVersion: '1',
      executionVersion: null,
    });

    const terminal = await store.load('lifecycle-alias');
    terminal.state.export.authorizationNonces.add('mutated-after-load');
    await expect(
      store.commit({
        lifecycleId: 'lifecycle-alias',
        state: terminal.state,
        baseline: terminal.baseline,
      }),
    ).resolves.toEqual({
      kind: 'stored',
      sharedVersion: '2',
      ceremonyVersion: '2',
      executionVersion: null,
    });

    const reread = await store.load('lifecycle-alias');
    expect(reread.state.export.authorizationNonces).toEqual(new Set(['mutated-after-load']));
  });

  test('bounds the shared recovery capability cache before a D1 commit', async () => {
    const backend = new MemoryPartitionRecordStore();
    const store = createRouterAbEd25519YaoProductRegistrationPartitionedStateStoreV1(backend);
    const loaded = await store.load('lifecycle-bounded-capabilities');
    const recoveryService = new InMemoryRouterAbEd25519YaoRecoveryService(
      {
        admitRecovery: async () => ({
          ok: false as const,
          status: 503 as const,
          code: 'test_unavailable',
          message: 'test backend unavailable',
        }),
        executeRecovery: async () => ({
          ok: false as const,
          status: 503 as const,
          code: 'test_unavailable',
          message: 'test backend unavailable',
        }),
        activateRecovery: async () => ({
          ok: false as const,
          status: 503 as const,
          code: 'test_unavailable',
          message: 'test backend unavailable',
        }),
      },
      loaded.state.recovery,
    );

    for (let index = 0; index < 40; index += 1) {
      const fixture = buildEd25519YaoCapabilityFixture({
        walletId: walletIdFromString(`wallet-bounded-${index}`),
        nearAccountId: `wallet-bounded-${index}.testnet`,
        nearEd25519SigningKeyId: `near-ed25519-bounded-${index}`,
        thresholdSessionId: `threshold-bounded-${index}`,
        signerSlot: 1,
        signingWorkerId: 'signing-worker-bounded',
        participantIds: [1, 2],
        runtimePolicyScope: {
          orgId: 'org-bounded',
          projectId: 'project-bounded',
          envId: 'env-bounded',
          signingRootVersion: 'root-bounded-v1',
        },
        seed: index + 1,
      });
      const installed = recoveryService.installPersistedActiveCapability(fixture.capability);
      if (!installed.ok) throw new Error(installed.message);
    }

    await expect(
      store.commit({
        lifecycleId: 'lifecycle-bounded-capabilities',
        state: loaded.state,
        baseline: loaded.baseline,
      }),
    ).resolves.toMatchObject({ kind: 'stored' });

    const reread = await store.load('lifecycle-bounded-capabilities');
    expect(reread.state.recovery.capabilities.size).toBe(32);
    expect(reread.state.recovery.identityCapabilities.size).toBe(32);
  });

  test('preserves another ceremony while committing a separate lifecycle', async () => {
    const backend = new MemoryPartitionRecordStore();
    const store = createRouterAbEd25519YaoProductRegistrationPartitionedStateStoreV1(backend);
    const stateA = createRouterAbEd25519YaoProductRegistrationStateV1();
    stateA.registration.lifecycleSessions.set('lifecycle-a', 'session-a');
    const first = await store.load('lifecycle-a');
    await store.commit({
      lifecycleId: 'lifecycle-a',
      state: stateA,
      baseline: first.baseline,
    });

    const stateB = createRouterAbEd25519YaoProductRegistrationStateV1();
    stateB.registration.lifecycleSessions.set('lifecycle-b', 'session-b');
    const second = await store.load('lifecycle-b');
    await expect(
      store.commit({
        lifecycleId: 'lifecycle-b',
        state: stateB,
        baseline: second.baseline,
      }),
    ).resolves.toEqual({
      kind: 'stored',
      sharedVersion: null,
      ceremonyVersion: '1',
      executionVersion: null,
    });

    await expect(store.load('lifecycle-a')).resolves.toMatchObject({
      state: { registration: { lifecycleSessions: new Map([['lifecycle-a', 'session-a']]) } },
      baseline: { sharedVersion: null, ceremonyVersion: '1' },
    });
    await expect(store.load('lifecycle-b')).resolves.toMatchObject({
      state: { registration: { lifecycleSessions: new Map([['lifecycle-b', 'session-b']]) } },
      baseline: { sharedVersion: null, ceremonyVersion: '1' },
    });
  });

  test('returns a typed conflict without applying either record on stale state', async () => {
    const backend = new MemoryPartitionRecordStore();
    const store = createRouterAbEd25519YaoProductRegistrationPartitionedStateStoreV1(backend);
    const initial = await store.load('lifecycle-c');
    const initialState = createRouterAbEd25519YaoProductRegistrationStateV1();
    await store.commit({
      lifecycleId: 'lifecycle-c',
      state: initialState,
      baseline: initial.baseline,
    });

    const stale = await store.load('lifecycle-c');
    const winner = await store.load('lifecycle-c');
    winner.state.registration.lifecycleSessions.set('lifecycle-c', 'winner');
    winner.state.export.authorizationNonces.add('winner');
    await store.commit({
      lifecycleId: 'lifecycle-c',
      state: winner.state,
      baseline: winner.baseline,
    });

    stale.state.registration.lifecycleSessions.set('lifecycle-c', 'stale');
    stale.state.export.authorizationNonces.add('stale');
    await expect(
      store.commit({
        lifecycleId: 'lifecycle-c',
        state: stale.state,
        baseline: stale.baseline,
      }),
    ).resolves.toEqual({ kind: 'version_mismatch', key: 'shared' });

    await expect(store.load('lifecycle-c')).resolves.toMatchObject({
      state: { registration: { lifecycleSessions: new Map([['lifecycle-c', 'winner']]) } },
      baseline: { sharedVersion: '1', ceremonyVersion: '2' },
    });
  });

  test('loads and commits a request-local state snapshot with typed output', async () => {
    const backend = new MemoryPartitionRecordStore();
    const store = createRouterAbEd25519YaoProductRegistrationPartitionedStateStoreV1(backend);
    const initial = await store.load('lifecycle-runner');
    initial.state.export.authorizationNonces.add('seed');
    await store.commit({
      lifecycleId: 'lifecycle-runner',
      state: initial.state,
      baseline: initial.baseline,
    });

    await expect(
      runRouterAbEd25519YaoProductRegistrationRequestScopedV1({
        lifecycleId: 'lifecycle-runner',
        store,
        execute: executeRequestWithSession,
      }),
    ).resolves.toEqual({
      kind: 'committed',
      value: 'request-response',
      sharedVersion: '1',
      ceremonyVersion: '2',
    });
    expect(backend.records.get(ROUTER_AB_ED25519_YAO_SHARED_STATE_RECORD_KEY_V1)?.version).toBe(1);

    await expect(store.load('lifecycle-runner')).resolves.toMatchObject({
      state: {
        registration: {
          lifecycleSessions: new Map([['lifecycle-runner', 'session-runner']]),
        },
      },
    });
  });

  test('detaches loaded shared state from an adapter-owned record snapshot', async () => {
    const backend = new MemoryPartitionRecordStore();
    const store = createRouterAbEd25519YaoProductRegistrationPartitionedStateStoreV1(backend);
    const initial = await store.load('lifecycle-detached');
    initial.state.export.authorizationNonces.add('persisted');
    await store.commit({
      lifecycleId: 'lifecycle-detached',
      state: initial.state,
      baseline: initial.baseline,
    });

    const loaded = await store.load('lifecycle-detached');
    loaded.state.export.authorizationNonces.add('request-only');
    loaded.state.registration.lifecycleSessions.set('lifecycle-detached', 'request-session');

    const persisted = backend.records.get(ROUTER_AB_ED25519_YAO_SHARED_STATE_RECORD_KEY_V1);
    const parsed =
      persisted === undefined
        ? null
        : parseRouterAbEd25519YaoProductRegistrationPartitionRecordV1(persisted.value);
    if (parsed?.kind !== 'router_ab_ed25519_yao_product_registration_shared_record_v1') {
      throw new Error('shared state record was not persisted');
    }
    expect(parsed.value.exportAuthorizationNonces).toEqual(new Set(['persisted']));
    await expect(store.load('lifecycle-detached')).resolves.toMatchObject({
      state: {
        registration: { lifecycleSessions: new Map() },
      },
    });
  });

  test('returns a typed conflict when a concurrent request wins the shared CAS', async () => {
    const backend = new MemoryPartitionRecordStore();
    const store = createRouterAbEd25519YaoProductRegistrationPartitionedStateStoreV1(backend);
    const initial = await store.load('lifecycle-conflict');
    initial.state.export.authorizationNonces.add('initial');
    await store.commit({
      lifecycleId: 'lifecycle-conflict',
      state: initial.state,
      baseline: initial.baseline,
    });

    await expect(
      runRouterAbEd25519YaoProductRegistrationRequestScopedV1({
        lifecycleId: 'lifecycle-conflict',
        store,
        execute: createConflictExecutor(store),
      }),
    ).resolves.toEqual({ kind: 'version_mismatch', key: 'shared' });

    await expect(store.load('lifecycle-conflict')).resolves.toMatchObject({
      state: {
        registration: { lifecycleSessions: new Map() },
        export: { authorizationNonces: new Set(['initial', 'winner']) },
      },
      baseline: { sharedVersion: '2', ceremonyVersion: '2' },
    });
  });

  test('persists the execution claim before the backend and commits the terminal state', async () => {
    const backend = new MemoryPartitionRecordStore();
    const store = createRouterAbEd25519YaoProductRegistrationPartitionedStateStoreV1(backend);
    const harness = new TwoPhaseTestHarness(store);

    await expect(
      runRouterAbEd25519YaoRegistrationTwoPhaseV1({
        lifecycleId: 'lifecycle-two-phase',
        store,
        prepare: harness.prepare.bind(harness),
        backend: harness.backend.bind(harness),
        complete: harness.complete.bind(harness),
      }),
    ).resolves.toMatchObject({
      kind: 'committed',
      value: { status: 'activated' },
    });
    expect(harness.events).toEqual(['prepare', 'backend', 'complete']);
    expect(backend.readManyCallCount).toBe(2);
    await expect(store.load('lifecycle-two-phase')).resolves.toMatchObject({
      state: {
        registration: {
          lifecycleSessions: new Map([['lifecycle-two-phase', 'completed']]),
        },
      },
    });
  });

  test('leaves the durable claim in place when the backend response is uncertain', async () => {
    const backend = new MemoryPartitionRecordStore();
    const store = createRouterAbEd25519YaoProductRegistrationPartitionedStateStoreV1(backend);
    const harness = new TwoPhaseTestHarness(store);

    await expect(
      runRouterAbEd25519YaoRegistrationTwoPhaseV1({
        lifecycleId: 'lifecycle-two-phase',
        store,
        prepare: harness.prepare.bind(harness),
        backend: uncertainTwoPhaseBackend,
        complete: harness.complete.bind(harness),
      }),
    ).resolves.toMatchObject({
      kind: 'backend_uncertain',
      claim: { lifecycleId: 'lifecycle-two-phase' },
    });
    expect(harness.events).toEqual(['prepare']);
    await expect(store.load('lifecycle-two-phase')).resolves.toMatchObject({
      state: {
        registration: {
          lifecycleSessions: new Map([['lifecycle-two-phase', 'executing']]),
        },
      },
    });
  });

  test('reports a terminal CAS conflict without retrying the backend', async () => {
    const backend = new MemoryPartitionRecordStore();
    const store = createRouterAbEd25519YaoProductRegistrationPartitionedStateStoreV1(backend);
    const harness = new TwoPhaseTestHarness(store, true);

    await expect(
      runRouterAbEd25519YaoRegistrationTwoPhaseV1({
        lifecycleId: 'lifecycle-two-phase',
        store,
        prepare: harness.prepare.bind(harness),
        backend: harness.backend.bind(harness),
        complete: harness.complete.bind(harness),
      }),
    ).resolves.toMatchObject({
      kind: 'terminal_version_mismatch',
      claim: { lifecycleId: 'lifecycle-two-phase' },
    });
    expect(harness.events).toEqual(['prepare', 'backend', 'complete']);
    await expect(store.load('lifecycle-two-phase')).resolves.toMatchObject({
      state: {
        registration: {
          lifecycleSessions: new Map([['lifecycle-two-phase', 'winner']]),
        },
      },
    });
  });
});
