import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export default function loadIntendedConsoleFixture() {
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
  const root =
    process.env.SEAMS_INTENDED_ROUTER_AB_ROOT ||
    path.join(tmpdir(), `${path.basename(repoRoot)}-intended-router-ab`);
  const fixture = JSON.parse(readFileSync(path.join(root, 'console-fixture.json'), 'utf8'));
  const fields = {
    cookie: 'SEAMS_INTENDED_CONSOLE_COOKIE',
    userId: 'SEAMS_INTENDED_CONSOLE_USER_ID',
    organizationId: 'SEAMS_LOCAL_CONSOLE_ORG_ID',
    projectId: 'SEAMS_INTENDED_PROJECT_ID',
    environmentId: 'SEAMS_INTENDED_PROJECT_ENVIRONMENT_ID',
    publishableKey: 'SEAMS_INTENDED_PUBLISHABLE_KEY',
  };
  for (const [field, variable] of Object.entries(fields)) {
    const value = fixture[field];
    if (typeof value !== 'string' || !value) throw new Error(`Console fixture requires ${field}`);
    process.env[variable] = value;
  }
}
