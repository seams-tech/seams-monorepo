export type PlatformResult<T, E> =
  | { readonly kind: 'accepted'; readonly value: T; readonly error?: never }
  | { readonly kind: 'rejected'; readonly error: E; readonly value?: never };

export interface PlatformContractError {
  readonly code: 'invalid_contract' | 'version_unsupported';
  readonly field: string;
}

class InvalidContract extends Error {
  constructor(readonly detail: PlatformContractError) {
    super(`${detail.code}: ${detail.field}`);
  }
}

export function invalidContract(field: string): never {
  throw new InvalidContract({ code: 'invalid_contract', field });
}

export function contractResult<T>(
  reader: (input: unknown) => T,
  input: unknown,
): PlatformResult<T, PlatformContractError> {
  try {
    return { kind: 'accepted', value: reader(input) };
  } catch (error) {
    if (error instanceof InvalidContract) return { kind: 'rejected', error: error.detail };
    throw error;
  }
}

export function object(input: unknown, field: string): Record<string, unknown> {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    return invalidContract(field);
  }
  // This assertion describes the raw boundary value. It does not create domain state.
  return input as Record<string, unknown>;
}

export function exactKeys(record: Record<string, unknown>, keys: readonly string[]): void {
  for (const key of Object.keys(record)) {
    if (!keys.includes(key)) invalidContract(key);
  }
  for (const key of keys) {
    if (!Object.hasOwn(record, key)) invalidContract(key);
  }
}

export function textValue(input: unknown, field = 'text'): string {
  if (typeof input !== 'string' || input.length === 0 || input !== input.trim()) {
    return invalidContract(field);
  }
  return input;
}

export function integer(input: unknown, field: string, minimum: number): number {
  if (typeof input !== 'number' || !Number.isSafeInteger(input) || input < minimum) {
    return invalidContract(field);
  }
  return input;
}

export function utcTimestamp(input: unknown, field = 'timestamp'): string {
  const value = textValue(input, field);
  const milliseconds = Date.parse(value);
  if (!Number.isFinite(milliseconds) || new Date(milliseconds).toISOString() !== value) {
    return invalidContract(field);
  }
  return value;
}

export function digestValue(input: unknown, field: string): string {
  const value = textValue(input, field);
  if (!/^[a-f0-9]{64}$/.test(value)) return invalidContract(field);
  return value;
}

export function versionOne(input: unknown): 1 {
  if (input !== 1) throw new InvalidContract({ code: 'version_unsupported', field: 'version' });
  return 1;
}

export function assertNever(value: never): never {
  throw new Error(`Unexpected account platform variant: ${String(value)}`);
}

export function exactObject(
  input: unknown,
  keys: readonly string[],
  field = 'account message',
): Record<string, unknown> {
  const record = object(input, field);
  exactKeys(record, keys);
  return record;
}

export function requirePlatformContract<T>(result: PlatformResult<T, PlatformContractError>): T {
  if (result.kind === 'rejected') throw new InvalidContract(result.error);
  return result.value;
}
