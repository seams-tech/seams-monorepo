export function shellQuote(value: string): string {
  return "'" + value.replaceAll("'", "'\\''") + "'";
}

export function recoveryKeySetupCommand(
  consoleUrl: string,
  environment: string,
  role: 'deriver-a' | 'deriver-b',
): string {
  const launcher = 'npx @seams/wallet-cli@0.4.1';
  return `${launcher} derivation-root recovery-key setup \\
  --console-url ${shellQuote(consoleUrl)} \\
  --environment ${shellQuote(environment)} --role ${role} \\\n  --wrapping-key-file ./${role}-wrapper.key`;
}
