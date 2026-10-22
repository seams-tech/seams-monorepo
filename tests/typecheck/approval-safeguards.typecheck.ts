import type {
  ApproveConsoleApprovalRequest,
  CreateConsoleApprovalRequest,
} from '../../packages/wallet-console-server-ts/src/approvals/types';
import type {
  ApproveConsoleKeyExportRequest,
  CreateConsoleKeyExportRequest,
} from '../../packages/wallet-console-server-ts/src/keyExports/types';
import { ConsolePolicyRulesDigest } from '../../packages/wallet-console-server-ts/src/policies/reviewDigest';
import type { ConsolePolicyPublication } from '../../packages/wallet-console-server-ts/src/policies/service';

declare const verifiedStepUp: Extract<
  ApproveConsoleApprovalRequest,
  { readonly kind: 'with_step_up' }
>['stepUp'];
declare const approvedRulesDigest: ConsolePolicyRulesDigest;

// @ts-expect-error A policy approval must carry a server-computed rules digest.
const unsealedPolicyApproval: CreateConsoleApprovalRequest = {
  operationType: 'POLICY_PUBLISH',
  resourceType: 'policy',
  resourceId: 'policy-a',
  reason: 'Publish',
};

// @ts-expect-error A key-export approval cannot carry a policy digest.
const unrelatedKeyApproval: CreateConsoleApprovalRequest = {
  operationType: 'KEY_EXPORT',
  resourceType: 'key_export',
  resourceId: 'export-a',
  reason: 'Export',
  policyRulesDigest: approvedRulesDigest,
};

// @ts-expect-error A reviewed publication requires the approved rules digest.
const unsealedPublication: ConsolePolicyPublication = { kind: 'approved' };

// @ts-expect-error Only the digest parser can construct a rules digest.
const forgedDigest = new ConsolePolicyRulesDigest('sha256:00');

// @ts-expect-error A direct object literal cannot become a review digest.
const forgedDigestShape: ConsolePolicyRulesDigest = { value: 'sha256:00' };

// @ts-expect-error A key-export approval requires server-issued step-up evidence.
const missingProof: ApproveConsoleApprovalRequest = {
  kind: 'with_step_up',
  reason: 'Approve export',
};

// @ts-expect-error A request without step-up cannot carry a proof.
const invalidBranch: ApproveConsoleApprovalRequest = {
  kind: 'without_step_up',
  reason: 'Approve policy',
  stepUp: verifiedStepUp,
};

const callerQuorum: CreateConsoleApprovalRequest = {
  operationType: 'KEY_EXPORT',
  resourceType: 'key_export',
  resourceId: 'export-a',
  reason: 'Export',
  // @ts-expect-error The caller cannot lower the approval quorum.
  requiredApprovals: 1,
};

// @ts-expect-error Policy publication cannot use a key-export target.
const wrongTarget: CreateConsoleApprovalRequest = {
  operationType: 'POLICY_PUBLISH',
  resourceType: 'key_export',
  resourceId: 'export-a',
  reason: 'Publish',
};

const callerExportQuorum: CreateConsoleKeyExportRequest = {
  environmentId: 'environment-a',
  reason: 'Export',
  // @ts-expect-error A key-export record cannot set its own quorum.
  requiredApprovals: 1,
};

const callerMfaClaim: ApproveConsoleKeyExportRequest = {
  reason: 'Approve export',
  // @ts-expect-error A caller-provided MFA claim is not a step-up proof.
  mfaVerified: true,
};

void [
  unsealedPolicyApproval,
  unrelatedKeyApproval,
  unsealedPublication,
  forgedDigest,
  forgedDigestShape,
  missingProof,
  invalidBranch,
  callerQuorum,
  wrongTarget,
  callerExportQuorum,
  callerMfaClaim,
];
