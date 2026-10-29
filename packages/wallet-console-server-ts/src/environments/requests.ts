import { ConsoleWalletEnvironmentError } from './errors';
import { parseExternalAuthConfiguration } from '@seams/wallet-server/cloud-host';
import {
  readOptionalQueryStringField as readOptionalQueryString,
  readOptionalStringField as readOptionalString,
  readRequiredStringField as readRequiredString,
  requireBodyObject,
  requireQueryObject,
} from '@seams-internal/console-server/shared/requestParse';
import { DEFAULT_WALLET_SIGNING_ROOT_VERSION } from './types';
import type {
  ConsoleWalletEnvironmentStatus,
  CreateConsoleWalletEnvironmentRequest,
  ListConsoleWalletEnvironmentsRequest,
  UpdateConsoleWalletEnvironmentRequest,
} from './types';
const RESOURCE_ID_PATTERN = /^[A-Za-z0-9:_-]+$/;

function parseOptionalEnvironmentStatus(
  value: string | undefined,
): ConsoleWalletEnvironmentStatus | undefined {
  switch (value?.toUpperCase()) {
    case undefined:
      return undefined;
    case 'ACTIVE':
      return 'ACTIVE';
    case 'DISABLED':
      return 'DISABLED';
    case 'ARCHIVED':
      return 'ARCHIVED';
    default:
      throw new ConsoleWalletEnvironmentError(
        'invalid_query',
        400,
        'Field status must be one of ACTIVE, DISABLED, or ARCHIVED',
      );
  }
}

function createParseError(
  code: string,
  status: number,
  message: string,
): ConsoleWalletEnvironmentError {
  return new ConsoleWalletEnvironmentError(code, status, message);
}

export function parseListConsoleWalletEnvironmentsRequest(
  query: unknown,
): ListConsoleWalletEnvironmentsRequest {
  const obj = requireQueryObject(query, createParseError);
  const status = parseOptionalEnvironmentStatus(readOptionalQueryString(obj, 'status'));
  return {
    projectId: readOptionalQueryString(obj, 'projectId'),
    ...(status ? { status } : {}),
  };
}

function readOptionalResourceId(body: Record<string, unknown>, key: string): string | undefined {
  const value = readOptionalString(body, key);
  if (!value) return undefined;
  if (!RESOURCE_ID_PATTERN.test(value)) {
    throw new ConsoleWalletEnvironmentError(
      'invalid_body',
      400,
      `Field ${key} may only contain letters, numbers, colon, underscore, and hyphen`,
    );
  }
  return value;
}

function readOptionalRuntimeVersion(body: Record<string, unknown>): string | undefined {
  const value = readOptionalString(body, 'runtimeVersion');
  if (!value) return undefined;
  if (!RESOURCE_ID_PATTERN.test(value)) {
    throw new ConsoleWalletEnvironmentError(
      'invalid_body',
      400,
      'Field runtimeVersion may only contain letters, numbers, colon, underscore, and hyphen',
    );
  }
  return value;
}

function parseEnvironmentKey(
  body: Record<string, unknown>,
): CreateConsoleWalletEnvironmentRequest['key'] {
  const key = readRequiredString(body, 'key', createParseError).toLowerCase();
  if (key === 'dev' || key === 'staging' || key === 'prod') {
    return key;
  }
  throw new ConsoleWalletEnvironmentError(
    'invalid_body',
    400,
    'Field key must be one of dev, staging, prod',
  );
}

export function parseCreateConsoleWalletEnvironmentRequest(
  body: unknown,
): CreateConsoleWalletEnvironmentRequest {
  const obj = requireBodyObject(body, createParseError);
  const id = readOptionalResourceId(obj, 'id');
  const name = readOptionalString(obj, 'name');
  const projectId = readRequiredString(obj, 'projectId', createParseError);
  const runtimeVersion = readOptionalRuntimeVersion(obj);
  if (!RESOURCE_ID_PATTERN.test(projectId)) {
    throw new ConsoleWalletEnvironmentError(
      'invalid_body',
      400,
      'Field projectId may only contain letters, numbers, colon, underscore, and hyphen',
    );
  }
  return {
    ...(id ? { id } : {}),
    projectId,
    key: parseEnvironmentKey(obj),
    signingRootVersion: runtimeVersion || DEFAULT_WALLET_SIGNING_ROOT_VERSION,
    status: 'ACTIVE',
    ...(name ? { name } : {}),
  };
}

export function parseUpdateConsoleWalletEnvironmentRequest(
  body: unknown,
): UpdateConsoleWalletEnvironmentRequest {
  const obj = requireBodyObject(body, createParseError);
  const name = readOptionalString(obj, 'name');
  const runtimeVersion = readOptionalRuntimeVersion(obj);
  let externalAuth: UpdateConsoleWalletEnvironmentRequest['externalAuth'];
  if (obj.externalAuth !== undefined) {
    const config = requireBodyObject(obj.externalAuth, createParseError);
    const parsed = parseExternalAuthUpdate(config);
    externalAuth =
      parsed.kind === 'google'
        ? { kind: 'google', clientId: parsed.clientId }
        : { kind: 'disabled' };
  }
  if (!name && !runtimeVersion && !externalAuth) {
    throw new ConsoleWalletEnvironmentError(
      'invalid_body',
      400,
      'At least one mutable field is required',
    );
  }
  return {
    ...(externalAuth ? { externalAuth } : {}),
    ...(name ? { name } : {}),
    ...(runtimeVersion ? { signingRootVersion: runtimeVersion } : {}),
  };
}

function parseExternalAuthUpdate(config: Record<string, unknown>) {
  try {
    return parseExternalAuthConfiguration({
      kind: config.kind,
      clientId: config.clientId,
      revision: 0,
    });
  } catch {
    throw createParseError('invalid_body', 400, 'External authentication configuration is invalid');
  }
}
