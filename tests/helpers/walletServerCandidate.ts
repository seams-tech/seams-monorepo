import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import path from 'node:path';

export function candidatePackageAliases(packageRoot: string): Record<string, string> {
  const packagePath = path.resolve(packageRoot, 'package.json');
  const definition = JSON.parse(readFileSync(packagePath, 'utf8'));
  if (definition.name !== '@seams/wallet-server') throw new Error('Wrong candidate package');
  const resolveCandidate = createRequire(packagePath);
  const aliases: Record<string, string> = {};
  for (const key of Object.keys(definition.exports)) {
    if (key.includes('*')) continue;
    const specifier = key === '.' ? definition.name : `${definition.name}/${key.slice(2)}`;
    aliases[specifier] = resolveCandidate.resolve(specifier);
  }
  return aliases;
}
