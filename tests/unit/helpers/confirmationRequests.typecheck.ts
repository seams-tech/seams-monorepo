import {
  UserConfirmationType,
  type ConfirmPrompt,
  type UserConfirmRequest,
  type UserConfirmRequestByType,
  type WorkerExportConfirmRequest,
} from '@/core/signingEngine/stepUpConfirmation/channel/confirmTypes';
import type { UiConfirmRequestBridgeContext } from '@/core/signingEngine/stepUpConfirmation/confirmOperation';
import type { UserConfirmWorkerMessage } from '@/core/types/secure-confirm-worker';
import type { ExportPrivateKeysWithUiWorkerPayload } from '@/core/types/secure-confirm-worker';

declare const artifact: Extract<
  ExportPrivateKeysWithUiWorkerPayload,
  { artifactKind: 'ecdsa-derivation-secp256k1-export' }
>;
const {
  artifactKind: _kind,
  privateKeyHex: _key,
  publicKeyHex: _public,
  ethereumAddress: _address,
  ...untaggedExport
} = artifact;
// @ts-expect-error ECDSA export requires an explicit artifact; PRF derivation requests are retired.
const invalidExport: ExportPrivateKeysWithUiWorkerPayload = untaggedExport;
void invalidExport;

declare const registration: UserConfirmRequestByType<UserConfirmationType.REGISTER_ACCOUNT>;
declare const decrypt: UserConfirmRequestByType<UserConfirmationType.AUTHORIZE_KEY_EXPORT>;
declare const show: UserConfirmRequestByType<UserConfirmationType.SHOW_SECURE_PRIVATE_KEY_UI>;
declare const signing: UserConfirmRequestByType<UserConfirmationType.SIGN_INTENT_DIGEST>;
declare const onLifecycle: (event: 'opened' | 'closed') => void;

// @ts-expect-error a request tag must select its own payload and summary
const mismatchedLiteral: UserConfirmRequest = {
  requestId: 'request',
  type: UserConfirmationType.SIGN_TRANSACTION,
  summary: {},
  payload: registration.payload,
};
// @ts-expect-error spreading a valid branch cannot authorize a different operation
const mismatchedSpread: UserConfirmRequest = {
  ...registration,
  type: UserConfirmationType.AUTHORIZE_KEY_EXPORT,
};
const mismatchedCast =
  // @ts-expect-error a direct cast cannot turn unrelated request branches into one another
  registration as UserConfirmRequestByType<UserConfirmationType.AUTHORIZE_KEY_EXPORT>;

const { signingAuthPlan: _plan, ...withoutPlan } = signing.payload;
// @ts-expect-error signing always requires an explicit authorization plan
const missingPlan: UserConfirmRequest = { ...signing, payload: withoutPlan };
const missingChallenge: UserConfirmRequest = {
  ...signing,
  payload: {
    signingSubject: signing.payload.signingSubject,
    challengeB64u: 'challenge',
    // @ts-expect-error passkey intent signing requires a typed WebAuthn challenge
    signingAuthPlan: { kind: 'passkeyReauth', method: 'passkey' },
  },
};

const callbackOnWire: WorkerExportConfirmRequest = {
  ...show,
  // @ts-expect-error callbacks cannot travel in a worker export prompt
  payload: { ...show.payload, onLifecycle },
};
// @ts-expect-error a pending request carries only its reference
const mixedPrompt: ConfirmPrompt = {
  kind: 'pending_request',
  requestId: 'request',
  requestToken: 'worker-request',
  request: decrypt,
};
// @ts-expect-error workers cannot initiate signing or registration through the export boundary
const signingOnExportWire: ConfirmPrompt = { kind: 'export_request', request: signing };
// @ts-expect-error the owned confirmation bridge is required
const missingBridge: UiConfirmRequestBridgeContext = {};

const fullRequestOnWire: UserConfirmWorkerMessage = {
  type: 'SECURE_CONFIRM_REQUEST',
  id: 'worker-request',
  // @ts-expect-error the confirmation worker receives a request reference only
  payload: { request: signing },
};

const signingWithSecret: UserConfirmRequest = {
  ...signing,
  // @ts-expect-error broad spreads cannot smuggle PRF material into confirmation requests
  payload: { ...signing.payload, prfOutput: 'secret' },
};

const exportWithSecret: WorkerExportConfirmRequest = {
  ...show,
  // @ts-expect-error export wire payloads also reject secrets introduced by a spread
  payload: { ...show.payload, onLifecycle: undefined, prfOutput: 'secret' },
};

void [
  _plan,
  mismatchedLiteral,
  mismatchedSpread,
  mismatchedCast,
  missingPlan,
  missingChallenge,
  callbackOnWire,
  mixedPrompt,
  signingOnExportWire,
  missingBridge,
  fullRequestOnWire,
  signingWithSecret,
  exportWithSecret,
];
