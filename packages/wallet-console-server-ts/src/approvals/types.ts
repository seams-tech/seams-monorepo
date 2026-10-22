export type ConsoleApprovalOperationType = 'POLICY_PUBLISH' | 'KEY_EXPORT';

export type ConsoleApprovalStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'CANCELED';

export type ConsoleApprovalDecision = 'APPROVE' | 'REJECT';

export interface ConsoleApprovalDecisionRecord {
  decision: ConsoleApprovalDecision;
  actorUserId: string;
  reason: string;
  mfaVerified: boolean;
  decidedAt: string;
}

export interface ConsoleApprovalRequestRecord {
  id: string;
  orgId: string;
  operationType: ConsoleApprovalOperationType;
  status: ConsoleApprovalStatus;
  reason: string;
  requestedByUserId: string;
  requiredApprovals: number;
  requireMfa: boolean;
  projectId: string | null;
  environmentId: string | null;
  resourceType: string | null;
  resourceId: string | null;
  metadata: Record<string, unknown>;
  decisions: ConsoleApprovalDecisionRecord[];
  createdAt: string;
  updatedAt: string;
  resolvedAt: string | null;
}

export interface ListConsoleApprovalsRequest {
  status?: ConsoleApprovalStatus;
  operationType?: ConsoleApprovalOperationType;
  projectId?: string;
  environmentId?: string;
}

interface CreateConsoleApprovalRequestBase {
  id?: string;
  reason: string;
  projectId?: string;
  environmentId?: string;
  resourceId: string;
  metadata?: Record<string, unknown>;
}

export type CreateConsoleApprovalRequest =
  | (CreateConsoleApprovalRequestBase & {
      readonly operationType: 'POLICY_PUBLISH';
      readonly resourceType: 'policy';
    })
  | (CreateConsoleApprovalRequestBase & {
      readonly operationType: 'KEY_EXPORT';
      readonly resourceType: 'key_export';
    });

export type ApproveConsoleApprovalRequest =
  | {
      readonly kind: 'without_step_up';
      readonly reason: string;
      readonly stepUp?: never;
    }
  | {
      readonly kind: 'with_step_up';
      readonly reason: string;
      readonly stepUp: TenantRootStepUpProofV1;
    };

export interface RejectConsoleApprovalRequest {
  reason: string;
}
import type { TenantRootStepUpProofV1 } from '../tenantRootSecurity/stepUp';
