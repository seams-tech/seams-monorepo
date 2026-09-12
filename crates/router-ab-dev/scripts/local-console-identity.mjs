import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import dotenv from 'dotenv';

export function parseLocalConsoleOrganizationId(value) {
  const organizationId = String(value || '').trim();
  if (!/^org_[a-z0-9]{12}$/.test(organizationId)) {
    throw new Error(
      'Configure SEAMS_LOCAL_CONSOLE_ORG_ID with an organization created through the Console',
    );
  }
  return organizationId;
}

export function resolveLocalConsoleOrganizationId(input) {
  const envPath = path.join(path.resolve(input.localEnvRoot), '.env.local');
  const localEnv = existsSync(envPath) ? dotenv.parse(readFileSync(envPath)) : {};
  return parseLocalConsoleOrganizationId(
    input.organizationId ??
      process.env.SEAMS_LOCAL_CONSOLE_ORG_ID ??
      localEnv.SEAMS_LOCAL_CONSOLE_ORG_ID,
  );
}
