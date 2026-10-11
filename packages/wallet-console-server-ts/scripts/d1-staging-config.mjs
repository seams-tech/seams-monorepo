import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const repoRoot = path.resolve(packageRoot, '../..');

function shellArg(input) {
  const value = String(input);
  if (/^[A-Za-z0-9_./:=@%+,$-]+$/.test(value)) return value;
  return `'${value.replace(/'/g, "'\\''")}'`;
}

export function sqlString(input) {
  return `'${String(input).replace(/'/g, "''")}'`;
}

function normalizeString(input) {
  const out = String(input || '').trim();
  return out || '';
}

function sha256String(source) {
  return createHash('sha256').update(source).digest('hex');
}

export function sha256File(filePath) {
  return sha256String(readFileSync(filePath));
}

export function writeJsonManifest(filePath, manifest) {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(manifest, null, 2)}\n`);
  return filePath;
}

function requireNextArg(args, index, flag) {
  const value = args[index + 1] || '';
  if (!value) throw new Error(`${flag} requires a value`);
  return value;
}

export function parseFlagArgs(args, defaults, flagFields) {
  const options = { ...defaults };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index] || '';
    if (arg === '--') continue;
    const config = flagFields[arg];
    if (typeof config === 'string') {
      options[config] = requireNextArg(args, index, arg);
      index += 1;
      continue;
    }
    if (config && config.kind === 'boolean') {
      options[config.field] = true;
      continue;
    }
    if (config && config.kind === 'string') {
      const value = requireNextArg(args, index, arg);
      options[config.field] = config.parse ? config.parse(value) : value;
      index += 1;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }
  return options;
}

export function relativeToPackage(inputPath) {
  const relativePath = path.relative(packageRoot, inputPath);
  return relativePath || '.';
}

export function isJsonRecord(input) {
  return typeof input === 'object' && input !== null && !Array.isArray(input);
}

export function isDirectInvocation(importMetaUrl) {
  const invoked = process.argv[1] ? path.resolve(process.argv[1]) : '';
  return invoked === fileURLToPath(importMetaUrl);
}

export function runCommandArgs(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd || repoRoot,
    input: options.input === null ? undefined : options.input,
    encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024,
  });
  const renderedCommand = commandWithArgs(command, args);
  return requireSuccessfulCommandResult(renderedCommand, {
    command: renderedCommand,
    status: result.status,
    stdout: normalizeString(result.stdout),
    stderr: normalizeString(result.stderr),
  });
}

function requireSuccessfulCommandResult(command, result) {
  if (result.status === 0) return result;
  throw new Error(commandFailureMessage(command, result));
}

function commandFailureMessage(command, result) {
  const lines = [`Command failed: ${command}`];
  if (result.stdout) lines.push(`stdout:\n${normalizeString(result.stdout)}`);
  if (result.stderr) lines.push(`stderr:\n${normalizeString(result.stderr)}`);
  return lines.join('\n');
}

function commandWithArgs(command, args) {
  if (!args || args.length === 0) return command;
  return `${command} ${args.map(shellArg).join(' ')}`;
}
