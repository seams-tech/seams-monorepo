import {
  readOptionalQueryStringField as readOptionalQueryString,
  readOptionalStringField as readOptionalString,
  readRequiredStringField as readRequiredString,
  requireBodyObject as requireObject,
  requireQueryObject,
} from '@seams-internal/console-server/shared/requestParse';
import { ConsoleApprovalsError } from './errors';
import type {
  ConsoleApprovalOperationType,
  ConsoleApprovalStatus,
  ParsedCreateConsoleApprovalRequest,
  ListConsoleApprovalsRequest,
  RejectConsoleApprovalRequest,
} from './types';

const APPROVAL_OPERATION_TYPES = new Set<ConsoleApprovalOperationType>([
  'POLICY_PUBLISH',
  'KEY_EXPORT',
]);
const APPROVAL_STATUSES = new Set<ConsoleApprovalStatus>([
  'PENDING',
  'APPROVED',
  'REJECTED',
  'CANCELED',
]);

function createError(code: string, status: number, message: string): ConsoleApprovalsError {
  return new ConsoleApprovalsError(code, status, message);
}

function parseOperationType(raw: unknown): ConsoleApprovalOperationType | undefined {
  if (raw === undefined || raw === null || String(raw).trim() === '') return undefined;
  const value = String(raw).trim().toUpperCase() as ConsoleApprovalOperationType;
  if (!APPROVAL_OPERATION_TYPES.has(value)) {
    throw createError(
      'invalid_body',
      400,
      `Field operationType must be one of: ${Array.from(APPROVAL_OPERATION_TYPES).join(', ')}`,
    );
  }
  return value;
}

function parseStatus(raw: unknown): ConsoleApprovalStatus | undefined {
  if (raw === undefined || raw === null || String(raw).trim() === '') return undefined;
  const value = String(raw).trim().toUpperCase() as ConsoleApprovalStatus;
  if (!APPROVAL_STATUSES.has(value)) {
    throw createError(
      'invalid_query',
      400,
      `Query status must be one of: ${Array.from(APPROVAL_STATUSES).join(', ')}`,
    );
  }
  return value;
}

function parseMetadata(raw: unknown): Record<string, unknown> | undefined {
  if (raw === undefined || raw === null) return undefined;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw createError('invalid_body', 400, 'Field metadata must be an object');
  }
  return raw as Record<string, unknown>;
}

export function parseListConsoleApprovalsRequest(query: unknown): ListConsoleApprovalsRequest {
  const obj = requireQueryObject(query, createError);
  const status = parseStatus(readOptionalQueryString(obj, 'status'));
  const operationType = parseOperationType(readOptionalQueryString(obj, 'operationType'));
  return {
    ...(status ? { status } : {}),
    ...(operationType ? { operationType } : {}),
    ...(readOptionalQueryString(obj, 'projectId')
      ? { projectId: readOptionalQueryString(obj, 'projectId') }
      : {}),
    ...(readOptionalQueryString(obj, 'environmentId')
      ? { environmentId: readOptionalQueryString(obj, 'environmentId') }
      : {}),
  };
}

export function parseCreateConsoleApprovalRequest(
  body: unknown,
): ParsedCreateConsoleApprovalRequest {
  const obj = requireObject(body, createError);
  const operationType = parseOperationType(obj.operationType);
  if (!operationType) {
    throw createError('invalid_body', 400, 'Missing required field: operationType');
  }
  if ('requiredApprovals' in obj || 'requireMfa' in obj) {
    throw createError('invalid_body', 400, 'Approval safeguards are set by the server');
  }
  const resourceType = readRequiredString(obj, 'resourceType', createError).toLowerCase();
  const resourceId = readRequiredString(obj, 'resourceId', createError);
  const expectedResourceType = operationType === 'POLICY_PUBLISH' ? 'policy' : 'key_export';
  if (resourceType !== expectedResourceType) {
    throw createError('invalid_body', 400, `Field resourceType must be ${expectedResourceType}`);
  }
  const metadata = parseMetadata(obj.metadata);
  const id = readOptionalString(obj, 'id');
  const reason = readRequiredString(obj, 'reason', createError);
  const projectId = readOptionalString(obj, 'projectId');
  const environmentId = readOptionalString(obj, 'environmentId');
  switch (operationType) {
    case 'POLICY_PUBLISH':
      return {
        operationType,
        resourceType: 'policy',
        resourceId,
        reason,
        ...(id ? { id } : {}),
        ...(projectId ? { projectId } : {}),
        ...(environmentId ? { environmentId } : {}),
        ...(metadata ? { metadata } : {}),
      };
    case 'KEY_EXPORT':
      return {
        operationType,
        resourceType: 'key_export',
        resourceId,
        reason,
        ...(id ? { id } : {}),
        ...(projectId ? { projectId } : {}),
        ...(environmentId ? { environmentId } : {}),
        ...(metadata ? { metadata } : {}),
      };
    default:
      throw createError('invalid_body', 400, 'Unsupported approval operation');
  }
}

export function parseApproveConsoleApprovalRequest(body: unknown): { readonly reason: string } {
  const obj = requireObject(body, createError);
  if ('mfaVerified' in obj) {
    throw createError('invalid_body', 400, 'MFA must be verified by the server');
  }
  return {
    reason: readRequiredString(obj, 'reason', createError),
  };
}

export function parseRejectConsoleApprovalRequest(body: unknown): RejectConsoleApprovalRequest {
  const obj = requireObject(body, createError);
  return {
    reason: readRequiredString(obj, 'reason', createError),
  };
}
