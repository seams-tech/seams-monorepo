import { ConsoleRuntimeSnapshotError } from './errors';
import {
  readOptionalQueryPositiveIntegerField as readOptionalQueryPositiveInteger,
  readOptionalQueryStringField as readOptionalQueryString,
  readOptionalStringField as readOptionalString,
  requireBodyObject as requireObject,
  requireQueryObject,
} from '@seams-internal/console-server/shared/requestParse';
import type {
  GetLatestConsoleRuntimeSnapshotRequest,
  ListConsoleRuntimeSnapshotsRequest,
  PublishCurrentConsoleRuntimeSnapshotRequest,
} from './types';

const LIST_LIMIT_MAX = 100;

function createError(code: string, status: number, message: string): ConsoleRuntimeSnapshotError {
  return new ConsoleRuntimeSnapshotError(code, status, message);
}

function parseRequiredEnvironmentId(
  source: Record<string, unknown>,
  sourceKind: 'query' | 'body',
): string {
  const value =
    sourceKind === 'query'
      ? readOptionalQueryString(source, 'environmentId')
      : readOptionalString(source, 'environmentId');
  if (!value) {
    throw createError(
      sourceKind === 'query' ? 'invalid_query' : 'invalid_body',
      400,
      'Missing required field: environmentId',
    );
  }
  return value;
}

function parseOptionalProjectId(
  source: Record<string, unknown>,
  sourceKind: 'query' | 'body',
): string | undefined {
  return sourceKind === 'query'
    ? readOptionalQueryString(source, 'projectId')
    : readOptionalString(source, 'projectId');
}

function parseOptionalIsoDate(raw: unknown, field: string): string | undefined {
  if (raw === undefined || raw === null) return undefined;
  const value = String(raw).trim();
  if (!value) return undefined;
  const asDate = new Date(value);
  if (!Number.isFinite(asDate.getTime())) {
    throw createError('invalid_body', 400, `Field ${field} must be a valid ISO-8601 date string`);
  }
  return asDate.toISOString();
}

export function parseListConsoleRuntimeSnapshotsRequest(
  query: unknown,
): ListConsoleRuntimeSnapshotsRequest {
  const obj = requireQueryObject(query, createError);
  const limit = readOptionalQueryPositiveInteger(obj, 'limit', createError);
  const projectId = parseOptionalProjectId(obj, 'query');
  if (limit !== undefined && limit > LIST_LIMIT_MAX) {
    throw createError(
      'invalid_query',
      400,
      `Query parameter limit must be less than or equal to ${LIST_LIMIT_MAX}`,
    );
  }
  return {
    environmentId: parseRequiredEnvironmentId(obj, 'query'),
    ...(projectId ? { projectId } : {}),
    ...(limit !== undefined ? { limit } : {}),
  };
}

export function parseGetLatestConsoleRuntimeSnapshotRequest(
  query: unknown,
): GetLatestConsoleRuntimeSnapshotRequest {
  const obj = requireQueryObject(query, createError);
  const projectId = parseOptionalProjectId(obj, 'query');
  return {
    environmentId: parseRequiredEnvironmentId(obj, 'query'),
    ...(projectId ? { projectId } : {}),
  };
}

export function parsePublishCurrentConsoleRuntimeSnapshotRequest(
  body: unknown,
): PublishCurrentConsoleRuntimeSnapshotRequest {
  const obj = requireObject(body, createError);
  const projectId = parseOptionalProjectId(obj, 'body');
  const snapshotId = readOptionalString(obj, 'snapshotId');
  const effectiveAt = parseOptionalIsoDate(obj.effectiveAt, 'effectiveAt');
  return {
    environmentId: parseRequiredEnvironmentId(obj, 'body'),
    ...(projectId ? { projectId } : {}),
    ...(snapshotId ? { snapshotId } : {}),
    ...(effectiveAt ? { effectiveAt } : {}),
  };
}
