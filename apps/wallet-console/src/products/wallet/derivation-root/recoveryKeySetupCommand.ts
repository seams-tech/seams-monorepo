/** The launcher release every printed command names. It must exist on npm with a signed GitHub release. */
export const WALLET_CLI_PACKAGE = '@seams/wallet-cli@0.25.0';

export function shellQuote(value: string): string {
  return "'" + value.replaceAll("'", "'\\''") + "'";
}

export function recoveryKeySetupCommand(
  consoleUrl: string,
  environment: string,
  role: 'deriver-a' | 'deriver-b',
): string {
  const launcher = `npx ${WALLET_CLI_PACKAGE}`;
  return `${launcher} derivation-root recovery-key setup \\
  --console-url ${shellQuote(consoleUrl)} \\
  --environment ${shellQuote(environment)} --role ${role} \\\n  --wrapping-key-file ./${role}-wrapper.key`;
}
