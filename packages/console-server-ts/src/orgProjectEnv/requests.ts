import { ConsoleOrgProjectError } from './errors';
import {
  readOptionalQueryStringField as readOptionalQueryString,
  readOptionalStringField as readOptionalString,
  readRequiredStringField as readRequiredString,
  requireBodyObject,
  requireQueryObject,
} from '../shared/requestParse';
import type {
  CreateConsoleProjectRequest,
  ListConsoleProjectsRequest,
  UpdateConsoleProjectRequest,
} from './types';

const RESOURCE_ID_PATTERN = /^[A-Za-z0-9:_-]+$/;

function createParseError(code: string, status: number, message: string): ConsoleOrgProjectError {
  return new ConsoleOrgProjectError(code, status, message);
}

export function parseListConsoleProjectsRequest(query: unknown): ListConsoleProjectsRequest {
  const obj = requireQueryObject(query, createParseError);
  const statusRaw = readOptionalQueryString(obj, 'status');
  const status = statusRaw ? statusRaw.toUpperCase() : undefined;
  if (status && status !== 'ACTIVE' && status !== 'ARCHIVED') {
    throw new ConsoleOrgProjectError(
      'invalid_query',
      400,
      'Field status must be one of ACTIVE or ARCHIVED',
    );
  }
  return {
    ...(status ? { status: status as ListConsoleProjectsRequest['status'] } : {}),
  };
}

function readOptionalResourceId(body: Record<string, unknown>, key: string): string | undefined {
  const value = readOptionalString(body, key);
  if (!value) return undefined;
  if (!RESOURCE_ID_PATTERN.test(value)) {
    throw new ConsoleOrgProjectError(
      'invalid_body',
      400,
      `Field ${key} may only contain letters, numbers, colon, underscore, and hyphen`,
    );
  }
  return value;
}

export function parseCreateConsoleProjectRequest(body: unknown): CreateConsoleProjectRequest {
  const obj = requireBodyObject(body, createParseError);
  const name = readRequiredString(obj, 'name', createParseError);
  const id = readOptionalResourceId(obj, 'id');
  return {
    ...(id ? { id } : {}),
    name,
  };
}

export function parseUpdateConsoleProjectRequest(body: unknown): UpdateConsoleProjectRequest {
  const obj = requireBodyObject(body, createParseError);
  const name = readOptionalString(obj, 'name');
  if (!name) {
    throw new ConsoleOrgProjectError('invalid_body', 400, 'At least one mutable field is required');
  }
  return { name };
}
