export class ConsoleOrgProjectError extends Error {
  readonly code: string;

  readonly status: number;

  readonly details?: Record<string, unknown>;

  constructor(code: string, status: number, message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = 'ConsoleOrgProjectError';
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

export function isConsoleOrgProjectError(error: unknown): error is ConsoleOrgProjectError {
  return error instanceof ConsoleOrgProjectError;
}
