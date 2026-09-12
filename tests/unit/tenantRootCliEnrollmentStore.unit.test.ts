import { expect, test } from '@playwright/test';
import { CliEnrollmentStore } from '../../packages/wallet-console-server-ts/src/tenantRootSecurity/cliEnrollmentStore';
import {
  applyD1MigrationFiles,
  cleanupTemporaryD1Database,
  createTemporaryD1Database,
  listD1MigrationFiles,
} from '../helpers/sqliteD1';

const id = 'AAAAAAAAAAAAAAAAAAAAAA';
const secret = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
const wrongSecret = 'AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE';

test('enrollment polling requires its secret, throttles retries, and respects denial and expiry', async () => {
  const { database, tempDir } = createTemporaryD1Database();
  try {
    await applyD1MigrationFiles(database, listD1MigrationFiles('d1-console'));
    const store = new CliEnrollmentStore(database, 'cli-test');
    await store.start(
      {
        id,
        environmentId: 'project:dev',
        role: 'deriver_a',
        publicKeyB64u: secret,
        expiresAtMs: 10000,
      },
      secret,
      'source',
      1,
    );
    expect(await store.poll(id, wrongSecret, 2)).toBeNull();
    const pending = await store.poll(id, secret, 2);
    expect(pending?.kind).toBe('pending');
    expect(await store.poll(id, secret, 3)).toBeNull();
    if (pending?.kind !== 'pending') throw new Error('Expected pending enrollment');
    await store.deny(pending, 4);
    expect((await store.poll(id, secret, 2003))?.kind).toBe('denied');
    expect((await store.read(id, 10000))?.kind).toBe('expired');
    expect(await new CliEnrollmentStore(database, 'another-namespace').read(id, 5)).toBeNull();
  } finally {
    cleanupTemporaryD1Database(tempDir);
  }
});
