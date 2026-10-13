export class ConsoleWalletEnvironmentError extends Error {
  constructor(
    readonly code: string,
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'ConsoleWalletEnvironmentError';
  }
}
export function isConsoleWalletEnvironmentError(
  error: unknown,
): error is ConsoleWalletEnvironmentError {
  return error instanceof ConsoleWalletEnvironmentError;
}
