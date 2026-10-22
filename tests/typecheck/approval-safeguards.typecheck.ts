import type {
  ApproveConsoleApprovalRequest,
  CreateConsoleApprovalRequest,
} from '../../packages/wallet-console-server-ts/src/approvals/types';
import type {
  ApproveConsoleKeyExportRequest,
  CreateConsoleKeyExportRequest,
} from '../../packages/wallet-console-server-ts/src/keyExports/types';

declare const verifiedStepUp: Extract<
  ApproveConsoleApprovalRequest,
  { readonly kind: 'with_step_up' }
>['stepUp'];

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

void [missingProof, invalidBranch, callerQuorum, wrongTarget, callerExportQuorum, callerMfaClaim];
