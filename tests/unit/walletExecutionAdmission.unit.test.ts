import { expect, test } from '@playwright/test';
import { prepareOwnerWalletExecution } from '../../packages/wallet-server/src/router/domains/signingOperations/walletExecutionAdmission';
import { proxyOwnerLaneAdmittedNormalSigningRequest } from '../../packages/wallet-server/src/router/transport/fetch/routes/normalSigningRouterProxy';
import { routerAbMpcMaterialActivationRefToWire } from '../../packages/shared-ts/src/utils/routerAbNormalSigningIdentity';
import {
  buildCompletedAuthorizedOperationFixture,
  buildReusableAuthorizationCoreFixture,
} from './helpers/authorizationCore.fixtures';
import { buildOwnerWalletExecutionEvidenceFixture } from './helpers/walletExecutionLane.fixtures';

test.describe('R101 wallet execution admission', () => {
  test('prepares only a claimed operation bound to the exact active owner lane', async () => {
    const authorization = await buildReusableAuthorizationCoreFixture();
    const evidence = await buildOwnerWalletExecutionEvidenceFixture();
    const result = await prepareOwnerWalletExecution({
      authorizedOperation: authorization.authorizedOperation,
      evidence,
    });

    expect(result).toMatchObject({
      kind: 'prepared',
      execution: {
        kind: 'prepared_owner_wallet_execution',
        lane: { laneId: evidence.lane.laneId },
        authorization: {
          authorizedOperationId: authorization.authorizedOperation.authorizedOperationId,
          operationFingerprintDigest: authorization.authorizedOperation.operationFingerprintDigest,
          capabilityId: authorization.authorizedOperation.operation.capabilityId,
        },
      },
    });
  });

  test('refuses stale material activation before dispatch', async () => {
    const authorization = await buildReusableAuthorizationCoreFixture();
    const evidence = await buildOwnerWalletExecutionEvidenceFixture();
    const result = await prepareOwnerWalletExecution({
      authorizedOperation: authorization.authorizedOperation,
      evidence: {
        ...evidence,
        expectedMaterialActivation: {
          ...evidence.expectedMaterialActivation,
          activationId: 'activation:stale',
        },
      },
    });

    expect(result).toEqual({ kind: 'refused', reason: 'material_activation_mismatch' });
  });

  test('refuses an operation after completion', async () => {
    const authorization = await buildReusableAuthorizationCoreFixture();
    const completed = await buildCompletedAuthorizedOperationFixture(authorization);
    const result = await prepareOwnerWalletExecution({
      authorizedOperation: completed,
      evidence: await buildOwnerWalletExecutionEvidenceFixture(),
    });

    expect(result).toEqual({ kind: 'refused', reason: 'operation_not_claimed' });
  });

  test('performs zero Router calls when the current owner lane is unavailable', async () => {
    const authorization = await buildReusableAuthorizationCoreFixture();
    const evidence = await buildOwnerWalletExecutionEvidenceFixture();
    if (
      evidence.lane.laneKind !== 'owner_passkey' &&
      evidence.lane.laneKind !== 'owner_email_otp'
    ) {
      throw new Error('owner auth lane fixture is required');
    }
    let routerCalls = 0;
    const response = await proxyOwnerLaneAdmittedNormalSigningRequest({
      request: new Request('https://wallet.example.test/sign', { method: 'POST' }),
      proxy: {
        internalServiceAuthSecret: 'test-router-secret',
        fetch: async () => {
          routerCalls += 1;
          return new Response('{}');
        },
      },
      body: {},
      authorizedOperation: authorization.authorizedOperation,
      walletId: evidence.walletId,
      expectedMaterialActivation: routerAbMpcMaterialActivationRefToWire(
        evidence.materialActivation,
      ),
      authorization: {
        kind: 'wallet_auth_method',
        walletAuthMethodId: evidence.lane.walletAuthMethodId,
      },
      walletRegistration: {
        resolveActiveOwnerWalletExecutionLane: async () => ({
          kind: 'refused',
          reason: 'auth_method_inactive',
        }),
      },
    });

    expect(response.status).toBe(403);
    expect(routerCalls).toBe(0);
  });
});
