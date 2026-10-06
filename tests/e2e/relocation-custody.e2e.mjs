import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createRelocationCustodyWorkers } from '../helpers/relocation-custody-workers.mjs';

const candidate = process.env.SEAMS_WALLET_SERVER_CANDIDATE;
if (!candidate) throw new Error('SEAMS_WALLET_SERVER_CANDIDATE is required');
const publicRoot = resolve(candidate, '../..');
const output = resolve(import.meta.dirname, '../../.artifacts/r155b/composed-relocation');
const custody = await createRelocationCustodyWorkers(publicRoot);
try {
  await mkdir(output, { recursive: true });
  await writeFile(
    resolve(output, 'custody-topology.json'),
    JSON.stringify(
      {
        scope:
          'Real Cloudflare Rust Workers with separate regional wallet object namespaces and SigningWorker D1. Shared tenant-root authority. Source NEAR registration completed. No directory-coordinated relocation or destination signing yet.',
        objects: custody.objects,
        registrationReceiptSha256: createHash('sha256')
          .update(JSON.stringify(custody.registration.publicReceipt))
          .digest('hex'),
        sourceRegistrationCompleted: true,
        directoryCoordinatorConnected: false,
        destinationSigningVerified: false,
      },
      null,
      2,
    ),
  );
  console.log(`Relocation custody topology passed: ${output}`);
} finally {
  await custody.topology.dispose();
}
