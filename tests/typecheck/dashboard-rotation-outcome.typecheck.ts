import type { DashboardRotationOutcome } from '../../apps/seams-console/src/products/wallet/derivation-root/consoleDerivationRootApi';

// @ts-expect-error Completion requires the activation receipt.
const missingReceipt: DashboardRotationOutcome = { kind: 'complete', operationId: 'operation' };
void missingReceipt;

// @ts-expect-error A retryable operation cannot also claim a completion receipt.
const mixedOutcome: DashboardRotationOutcome = { kind: 'retryable', operationId: 'operation', message: 'Retry', receiptDigest: 'receipt' };
void mixedOutcome;

declare const completed: Extract<DashboardRotationOutcome, { kind: 'complete' }>;
// @ts-expect-error A broad spread cannot turn completion evidence into a refused operation.
const spreadOutcome: DashboardRotationOutcome = { ...completed, kind: 'refused', message: 'Refused' };
void spreadOutcome;

import type { DashboardDerivationRootStatus } from '../../apps/seams-console/src/products/wallet/derivation-root/consoleDerivationRootApi';

// @ts-expect-error Active state requires the server's root status.
const missingRoot: DashboardDerivationRootStatus = { kind: 'active' };
void missingRoot;

declare const activeRoot: Extract<DashboardDerivationRootStatus, { kind: 'active' }>;
// @ts-expect-error An unprovisioned environment cannot carry an active root through a spread.
const mixedRoot: DashboardDerivationRootStatus = { ...activeRoot, kind: 'not_provisioned' };
void mixedRoot;
