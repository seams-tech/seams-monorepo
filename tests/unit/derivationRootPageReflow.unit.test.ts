import { createRequire } from 'node:module';
import { expect, test } from '@playwright/test';
import { build } from 'esbuild';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

/**
 * Narrow-layout verification for the Derivation root security page.
 *
 * This renders the real component — not a mock of its markup — against a
 * stubbed console API, and asserts the page never scrolls horizontally at
 * 320 CSS pixels or at the equivalent of 200% zoom. Those are the two widths
 * the specification names, and a page that overflows at either is unusable
 * for the operator who most needs it.
 */

const REPO_ROOT = fileURLToPath(new URL('../..', import.meta.url));
const PAGE_DIRECTORY = path.join(
  REPO_ROOT,
  'apps/wallet-console/src/products/wallet/derivation-root',
);
const PAGE_ENTRY = path.join(PAGE_DIRECTORY, 'DerivationRootSecurityWorkspace.tsx');
/** The page's own stylesheet, inlined so the test exercises the real rules. */
const PAGE_CSS = readFileSync(path.join(PAGE_DIRECTORY, 'derivationRootSecurity.css'), 'utf8');

/** A status with every section populated, so nothing is hidden by emptiness. */
const STATUS = {
  identity: { orgId: 'org-1', projectId: 'project-2', envId: 'production' },
  custodyLineageId: 'MTExMTExMTExMTExMTExMQ',
  lifecycleRevision: 7,
  operationalShares: {
    activeEpoch: 4,
    rootCommitmentFingerprintB64u: '6IKxMQFrUsHTM3CAGHz3aEI-_Mu1F7tJWrgSxBYP9E4',
    deriverAStatus: 'healthy',
    deriverBStatus: 'healthy',
    lastCompletedRotationAt: '2026-09-01T00:00:00.000Z',
    nextScheduledRotationAt: '2026-10-01T00:00:00.000Z',
    securityProfile: 'operational_rotation_v1',
    job: {
      status: 'installing',
      jobId: 'job-00000000-0000-4000-8000-000000000000',
      requestedAt: '2026-09-05T12:00:00.000Z',
    },
  },
  recoveryBackup: {
    status: 'ready',
    governance: {
      kind: 'two_person_v1',
      selectedByOwnerId: 'owner-1',
      selectedAt: '2026-08-01T00:00:00.000Z',
    },
    active: {
      recoverySetId: 'QUFBQUFBQUFBQUFBQUFBQQ',
      recipientPair: {
        deriverAFingerprintB64u: 'GSYMSrbHNIS_I8s_-HNmSiE1IUPWtFBiAWyacCVe8uY',
        deriverBFingerprintB64u: 'nF1YOuRpN5POO1FZDHiGUboN9MIzmyW4RnZmX85Eqos',
      },
      createdAt: '2026-08-29T10:20:30.123Z',
      rootCommitmentFingerprintB64u: '6IKxMQFrUsHTM3CAGHz3aEI-_Mu1F7tJWrgSxBYP9E4',
      deriverAPackage: { kind: 'never_downloaded' },
      deriverBPackage: { kind: 'never_downloaded' },
      manifest: { kind: 'never_downloaded' },
    },
  },
  restore: {
    status: 'awaiting_role_imports',
    sessionId: 'session-00000000-0000-4000-8000-000000000000',
    expiresAt: '2026-09-06T12:00:00.000Z',
    destinationFingerprintB64u: 'ZmluZ2VycHJpbnQtZm9yLXRoZS1kZXN0aW5hdGlvbg',
    recoverySetId: 'QUFBQUFBQUFBQUFBQUFBQQ',
    installed: { kind: 'neither_installed' },
  },
  trustLevel: { kind: 'cryptographically_valid_offline' },
};

/**
 * Bundles the page with its console calls and app chrome stubbed.
 *
 * Only the network and the surrounding shell are replaced; the component and
 * its presentation module are the real ones.
 */
async function bundlePage(directory: string): Promise<void> {
  const stubs = path.join(directory, 'stubs');
  const bundlePath = path.join(directory, 'page.js');
  const apiStub = path.join(directory, 'apiStub.ts');
  writeFileSync(
    apiStub,
    `const currentStatus = ${JSON.stringify(STATUS)};
     window.governanceCalls = 0;
     export async function verifyCustodyStepUp() {}
     export async function createDerivationRoot() { throw new Error('Unexpected creation'); }
     export async function commitRecoveryKeys() { throw new Error('Unexpected commit'); }
     export async function readDerivationRootSecurityStatus() {
       if (window.cleanupPending) currentStatus.recoveryBackup = {
         status: 'cleanup_incomplete', governance: currentStatus.recoveryBackup.governance,
         active: currentStatus.recoveryBackup.active,
         outstanding: { roles: ['deriver_a', 'deriver_b'], description: 'superseded recovery packages' },
       };
       if (window.rotationRefused) currentStatus.operationalShares.job = null;
       if (window.holdRefresh) await new Promise(resolve => { window.finishRefresh = resolve; });
       if (window.singleOwner) currentStatus.recoveryBackup.governance = { kind: 'single_owner_v1', acknowledgedByOwnerId: 'owner-1', acknowledgedAt: '2026-08-01T00:00:00.000Z', warningVersion: 'tenant_root_single_owner_v1' };
       return { kind: 'active', status: currentStatus, recoveryEnrollment: 'committed', recoveryDownloadAccess: window.singleOwner ? { deriverA: true, deriverB: true } : { deriverA: window.holder !== 'b', deriverB: window.holder === 'b' } };
     }
     export async function startOperationalShareRotation() {
       if (window.cancelPasskey) throw new DOMException("The operation was not allowed", window.cancelPasskey);
       if (window.rotationRefused) return { kind: 'refused', operationId: 'rotation-1', message: 'You can rotate again after 9/10/2026, 3:39:54 PM.' };
       return { kind: 'complete', operationId: 'operation-1', receiptDigest: 'receipt-1' };
     }
     export async function readOperationalShareRotation(operationId) {
       return { kind: 'complete', operationId, receiptDigest: 'receipt-1' };
     }
     export async function setRecoveryGovernance(input) {
       window.governanceCalls += 1;
       currentStatus.recoveryBackup.governance = input.choice;
       return { kind: 'accepted', value: input.choice, operationId: 'operation-2', replayed: false };
     }
     export async function createRecoveryBackup() {
       if (window.holdBackup) await new Promise(resolve => { window.finishBackup = resolve; });
       return {
         kind: 'accepted',
         value: ${JSON.stringify(STATUS.recoveryBackup)},
         operationId: 'operation-3',
         replayed: false,
       };
     }
     export async function downloadRecoveryArtifact(input) {
       (window.artifactRequests ??= []).push(input.artifact);
       if (window.holdArtifact) await new Promise(resolve => { window.finishArtifact = resolve; });
       if (window.failArtifact && input.artifact === 'deriver_b_package') throw new Error('Deriver B download failed');
       return { bytes: new Uint8Array(), contentDigestB64u: 'digest', filename: 'file' };
     }`,
    'utf8',
  );
  writeFileSync(
    path.join(directory, 'entry.tsx'),
    `import React from 'react';
     import { createRoot } from 'react-dom/client';
     import { DerivationRootSecurityPage } from ${JSON.stringify(PAGE_ENTRY)};
     const root = createRoot(document.getElementById('root'));
     let mount = 0;
     function remount() {
       root.render(React.createElement(DerivationRootSecurityPage, { key: mount++ }));
     }
     window.remountSecurityPage = remount;
     remount();`,
    'utf8',
  );
  writeFileSync(
    path.join(stubs + '-toast.ts'),
    'export const toast = { success() {}, error(message) { window.lastToastError = message; }, message() {} };',
    'utf8',
  );
  writeFileSync(
    path.join(stubs + '-modal.tsx'),
    `import React from 'react';
     export function DashboardInlineModal({ isOpen, children }) {
       return isOpen ? React.createElement('div', { role: 'dialog' }, children) : null;
     }`,
    'utf8',
  );
  writeFileSync(
    path.join(stubs + '-http.ts'),
    'export function requireConsoleBaseUrl() { return "https://console.test"; }',
    'utf8',
  );
  writeFileSync(
    path.join(stubs + '-timestamps.ts'),
    'export function formatDashboardTimestamp(value) { return String(value); }',
    'utf8',
  );

  writeFileSync(stubs + '-members.ts', `
    export async function listDashboardOrganizationMemberships() {
      return Array.from({ length: window.ownerCount ?? 2 }, () => ({ kind: 'active', role: 'OWNER' }));
    }
  `);

  await build({
    entryPoints: [path.join(directory, 'entry.tsx')],
    bundle: true,
    outfile: bundlePath,
    format: 'iife',
    define: { 'import.meta.env': '{}' },
    jsx: 'automatic',
    logLevel: 'silent',
    absWorkingDir: REPO_ROOT,
    // The generated entry lives in a temp directory, so node resolution has to
    // be told where the workspace's modules are.
    nodePaths: [
      path.join(REPO_ROOT, 'apps/wallet-console/node_modules'),
      path.join(REPO_ROOT, 'node_modules'),
    ],
    alias: {
      '@core/dashboard/routes/team-members/consoleTeamRbacApi': stubs + '-members.ts',
      sonner: stubs + '-toast.ts',
      '@core/dashboard/components/DashboardInlineModal': stubs + '-modal.tsx',
      '@core/dashboard/consoleHttp': stubs + '-http.ts',
      '@core/dashboard/utils/timestamps': stubs + '-timestamps.ts',
    },
    plugins: [
      {
        // A relative import cannot be aliased, so the console client is
        // redirected here. Only the network is replaced.
        name: 'stub-console-client',
        setup(pluginBuild) {
          pluginBuild.onResolve({ filter: /consoleDerivationRootApi$/u }, () => ({
            path: apiStub,
          }));
        },
      },
    ],
  });
}

test('the page reflows at 320 pixels and at 200% zoom without horizontal scrolling', async ({
  page,
}) => {
  const directory = mkdtempSync(path.join(tmpdir(), 'derivation-root-reflow-'));
  try {
    await bundlePage(directory);
    const htmlPath = path.join(directory, 'page.html');
    writeFileSync(
      htmlPath,
      `<!doctype html><html><head><meta charset="utf-8">
       <style>
         /* Only the reset a browser would apply; the page brings its own layout. */
         *, *::before, *::after { box-sizing: border-box; }
         body { margin: 0; font-family: system-ui, sans-serif; }
         ${PAGE_CSS}
       </style>
       </head><body><div id="root"></div><script src="./page.js"></script></body></html>`,
      'utf8',
    );

    await page.goto(pathToFileURL(htmlPath).href);
    await page.waitForSelector('h1');
    await expect(page.locator('h1')).toHaveText('Threshold Keys');

    // 320 CSS pixels: the narrowest width the specification names.
    for (const width of [320, 640]) {
      await page.setViewportSize({ width, height: 900 });
      const overflow = await page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
        widest: Array.from(document.querySelectorAll('*'))
          .filter((element) => element.scrollWidth > document.documentElement.clientWidth)
          .map((element) => `${element.tagName.toLowerCase()}.${element.className}`)
          .slice(0, 5),
      }));
      expect(
        overflow.scrollWidth,
        `page scrolls horizontally at ${width}px: ${overflow.widest.join(', ')}`,
      ).toBeLessThanOrEqual(overflow.clientWidth);
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('status carries text and an icon, so colour never carries it alone', async ({ page }) => {
  const directory = mkdtempSync(path.join(tmpdir(), 'derivation-root-status-'));
  try {
    await bundlePage(directory);
    const htmlPath = path.join(directory, 'page.html');
    writeFileSync(
      htmlPath,
      `<!doctype html><html><head><meta charset="utf-8">
       <style>${PAGE_CSS}</style></head>
       <body><div id="root"></div><script src="./page.js"></script></body></html>`,
      'utf8',
    );
    await page.goto(pathToFileURL(htmlPath).href);
    await page.waitForSelector('h1');

    // Every status line states its status in words.
    const statuses = await page.locator('.dashboard-status').allTextContents();
    expect(statuses.length).toBeGreaterThanOrEqual(3);
    for (const status of statuses) {
      expect(status.replace(/[^\p{L}]/gu, '').length).toBeGreaterThan(10);
    }

    // Long identifiers expose their full value to a screen reader.
    const accessibleIds = await page.locator('.dashboard-shortid .sr-only').allTextContents();
    expect(accessibleIds.length).toBeGreaterThan(0);
    for (const value of accessibleIds) {
      expect(value).toContain(':');
    }

    // The restore section shows one command per role that still needs one.
    const commands = await page.locator('.dashboard-commands code').allTextContents();
    expect(commands).toHaveLength(2);
    expect(commands[0]).toContain('--role deriver-a');
    expect(commands[1]).toContain('--role deriver-b');
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});


test('saved governance disables duplicate saves after loading, changing, saving, and remounting', async ({ page }) => {
  const directory = mkdtempSync(path.join(tmpdir(), 'derivation-root-governance-'));
  try {
    await bundlePage(directory);
    page.on('pageerror', reportPageError);
    await page.goto('http://localhost:4004');
    await page.setContent('<div id="root"></div>');
    await page.addScriptTag({ path: path.join(directory, 'page.js') });
    await expect(page.locator('h1')).toHaveText('Threshold Keys', { timeout: 5000 });
    await page.getByText('Choose who approves changes', { exact: true }).click({ timeout: 5000 });
    await expect(page.getByRole('radio', { name: 'Two owners' })).toBeChecked();
    await expect(page.getByRole('button', { name: 'Approval policy saved', exact: true })).toBeDisabled();
    await page.getByRole('radio', { name: 'One owner' }).check();
    await page.getByRole('checkbox').check();
    await expect(page.getByRole('button', { name: 'Save approval policy', exact: true })).toBeEnabled();
    await page.getByRole('radio', { name: 'Two owners' }).check();
    await expect(page.getByRole('button', { name: 'Approval policy saved', exact: true })).toBeDisabled();
    expect(await page.evaluate('window.governanceCalls')).toBe(0);
    await page.getByRole('radio', { name: 'One owner' }).check();
    await page.getByRole('button', { name: 'Save approval policy', exact: true }).click();
    await page.getByRole('dialog').getByRole('button', { name: /Continue|Verify|Confirm/ }).click();
    await expect.poll(() => page.evaluate('window.governanceCalls')).toBe(1);
    await page.getByText('Choose who approves changes', { exact: true }).click();
    await expect(page.getByRole('button', { name: 'Approval policy saved', exact: true })).toBeDisabled();
    await page.evaluate('window.remountSecurityPage()');
    await page.getByText('Choose who approves changes', { exact: true }).click();
    await expect(page.getByRole('radio', { name: 'One owner' })).toBeChecked();
    await expect(page.getByRole('button', { name: 'Approval policy saved', exact: true })).toBeDisabled();
    expect(await page.evaluate('window.governanceCalls')).toBe(1);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

function reportPageError(error: Error): void { console.error(error.message); }


test('recovery refresh and backup show pending feedback and link the wallet CLI', async ({ page }) => {
  const directory = mkdtempSync(path.join(tmpdir(), 'derivation-root-feedback-'));
  try {
    await bundlePage(directory);
    await page.goto('http://localhost:4004');
    await page.setContent('<div id="root"></div>');
    await page.addScriptTag({ path: path.join(directory, 'page.js') });
    await page.getByText('Enroll public wrapper keys', { exact: true }).click();
    await page.evaluate('window.holdRefresh = true');
    await page.getByRole('button', { name: 'Refresh enrollment status', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Refreshing…', exact: true })).toBeDisabled();
    await expect(page.getByText('Checking the latest status…', { exact: true })).toBeVisible();
    await page.evaluate('window.holdRefresh = false; window.finishRefresh()');
    await expect(page.getByText('Status refreshed. You’re viewing the latest results.', { exact: true })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Seams wallet CLI', exact: true })).toHaveAttribute(
      'href', 'https://www.npmjs.com/package/@seams/wallet-cli',
    );
    await page.getByText('Create your backup', { exact: true }).click();
    await page.evaluate('window.holdBackup = true');
    await page.getByRole('button', { name: 'Generate a new recovery backup', exact: true }).click();
    await expect(page.getByText(/Creating your recovery backup. Complete any identity/)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Creating backup…', exact: true })).toBeDisabled();
    const progress = page.locator('.derivation-root-backup-progress');
    await expect(progress.locator('[aria-current="step"]')).toContainText('Create backup');
    await expect(progress.getByText(/\d+s elapsed/)).toBeVisible();
    await page.evaluate('window.holdRefresh = true; window.holdBackup = false; window.finishBackup()');
    await expect(progress.locator('[aria-current="step"]')).toContainText('Refresh status');
    await expect(progress.locator('li[data-complete="true"]')).toHaveCount(1);
    await page.evaluate('window.holdRefresh = false; window.finishRefresh()');
    await expect(progress.locator('[aria-current="step"]')).toContainText('Ready');
    await expect(progress.locator('li[data-complete="true"]')).toHaveCount(3);
    await expect(progress.getByText(/\d+s elapsed/)).toHaveCount(0);
    await expect(page.getByText(/Creating your recovery backup. Complete any identity/)).toHaveCount(0);
    await page.evaluate('window.rotationRefused = true; window.remountSecurityPage()');
    await page.getByRole('tab', { name: 'Rotate shares', exact: true }).click();
    await page.getByRole('button', { name: 'Review share rotation', exact: true }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Rotate operational shares', exact: true }).click();
    const refusal = page.getByRole('dialog').getByRole('alert');
    await expect(refusal).toHaveText('You can rotate again after 9/10/2026, 3:39:54 PM.');
    await expect(refusal).toHaveClass('derivation-root-error derivation-root-feedback');
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});


test('recovery ZIP contains standard filenames under one identifiable folder', async ({ page }) => {
  const directory = mkdtempSync(path.join(tmpdir(), 'derivation-root-zip-'));
  try {
    await bundlePage(directory);
    await page.goto('http://localhost:4004');
    await page.setContent('<div id="root"></div>');
    await page.evaluate('window.cleanupPending = true; window.singleOwner = true');
    await page.addScriptTag({ path: path.join(directory, 'page.js') });
    await page.getByText('Create your backup', { exact: true }).click();
    await expect(page.getByRole('button', { name: 'Generate a new recovery backup', exact: true })).toBeDisabled();
    const zipButton = page.getByRole('button', { name: 'Download recovery ZIP', exact: true });
    await expect(zipButton).toBeEnabled();
    await expect(page.getByRole('button', { name: /Download Deriver|Download recovery manifest/ })).toHaveCount(0);
    await page.evaluate('window.holdArtifact = true');
    const downloadEvent = page.waitForEvent('download');
    await zipButton.click();
    await expect(page.getByRole('button', { name: 'Preparing recovery ZIP…' })).toBeDisabled();
    await expect(page.getByText('Complete any passkey prompt. Downloading and packaging your recovery files…')).toBeVisible();
    await page.evaluate('window.holdArtifact = false; window.finishArtifact()');
    const download = await downloadEvent;
    const archivePath = path.join(directory, 'backup.zip');
    await download.saveAs(archivePath);
    const { unzipSync } = createRequire(path.join(REPO_ROOT, 'apps/wallet-console/package.json'))('fflate');
    const entries = Object.keys(unzipSync(readFileSync(archivePath)));
    const folder = download.suggestedFilename().replace(/\.zip$/, '');
    expect(folder).toMatch(/^seams-recovery-\d{4}-\d{2}-\d{2}-/);
    expect(entries.sort()).toEqual([
      `${folder}/deriver-a.backup`, `${folder}/deriver-b.backup`, `${folder}/manifest.json`,
    ]);
    let extraDownloads = 0;
    page.on('download', () => { extraDownloads += 1; });
    await page.evaluate('window.failArtifact = true');
    await zipButton.click();
    await expect.poll(() => page.evaluate('window.lastToastError')).toBe('Deriver B download failed');
    await expect(zipButton).toBeEnabled();
    expect(extraDownloads).toBe(0);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});


test('two-owner recovery requires two active organization owners', async ({ page }) => {
  const directory = mkdtempSync(path.join(tmpdir(), 'recovery-owner-count-'));
  try {
    await bundlePage(directory);
    await page.goto('http://localhost:4004');
    await page.setContent('<div id="root"></div>');
    await page.evaluate('window.ownerCount = 1');
    await page.addScriptTag({ path: path.join(directory, 'page.js') });
    await page.getByText('Choose who approves changes', { exact: true }).click();
    const twoOwners = page.getByRole('radio', { name: /Two owners/ });
    await expect(twoOwners).toBeDisabled();
    await expect(page.getByText(/Requires at least two active organization owners/)).toBeVisible();
    await page.evaluate('window.ownerCount = 2; window.dispatchEvent(new Event("focus"))');
    await expect(twoOwners).toBeEnabled();
    await expect(page.getByText(/Requires at least two active organization owners/)).toHaveCount(0);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

for (const holder of ['a', 'b'] as const) {
  test(`two-person ZIP ${holder.toUpperCase()} includes only its holder's package`, async ({ page }) => {
    const directory = mkdtempSync(path.join(tmpdir(), 'derivation-root-split-zip-'));
    try {
      await bundlePage(directory);
      await page.goto('http://localhost:4004');
      await page.setContent('<div id="root"></div>');
      await page.evaluate(`window.holder = '${holder}'`);
      await page.addScriptTag({ path: path.join(directory, 'page.js') });
      const own = holder.toUpperCase();
      const other = holder === 'a' ? 'B' : 'A';
      await expect(page.getByRole('button', { name: `Download recovery ZIP ${other}`, exact: true })).toBeDisabled();
      await expect(page.getByRole('button', { name: 'Download recovery ZIP', exact: true })).toHaveCount(0);
      const downloadEvent = page.waitForEvent('download');
      await page.getByRole('button', { name: `Download recovery ZIP ${own}`, exact: true }).click();
      const download = await downloadEvent;
      const archivePath = path.join(directory, 'backup.zip');
      await download.saveAs(archivePath);
      const { unzipSync } = createRequire(path.join(REPO_ROOT, 'apps/wallet-console/package.json'))('fflate');
      const folder = download.suggestedFilename().replace(/\.zip$/, '');
      expect(Object.keys(unzipSync(readFileSync(archivePath))).sort()).toEqual([
        `${folder}/deriver-${holder}.backup`, `${folder}/manifest.json`,
      ]);
      expect(await page.evaluate('window.artifactRequests')).toEqual(['manifest', `deriver_${holder}_package`]);
      await expect(page.locator('code').filter({ hasText: `backup verify --role deriver-${holder}` })).toBeVisible();
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
}

test('cancelling passkey verification leaves rotation ready to retry without an error', async ({ page }) => {
  const directory = mkdtempSync(path.join(tmpdir(), 'derivation-root-cancel-'));
  try {
    await bundlePage(directory);
    await page.goto('http://localhost:4004');
    await page.setContent('<div id="root"></div>');
    await page.evaluate('window.rotationRefused = true');
    await page.addScriptTag({ path: path.join(directory, 'page.js') });
    await page.getByRole('tab', { name: 'Rotate shares', exact: true }).click();
    await page.getByRole('button', { name: 'Review share rotation', exact: true }).click();
    const dialog = page.getByRole('dialog').filter({ hasText: 'Rotate operational shares?' });
    await expect(dialog).not.toContainText('has not verified cryptographic erasure');
    for (const name of ['NotAllowedError', 'AbortError']) {
      await page.evaluate(`window.cancelPasskey = '${name}'`);
      await dialog.getByRole('button', { name: 'Rotate operational shares', exact: true }).click();
      await expect(dialog.getByRole('button', { name: 'Rotate operational shares', exact: true })).toBeEnabled();
      await expect(dialog.getByRole('alert')).toHaveCount(0);
      await expect(dialog).toBeVisible();
    }
    await page.evaluate('window.cancelPasskey = null');
    await dialog.getByRole('button', { name: 'Rotate operational shares', exact: true }).click();
    await expect(dialog.getByRole('alert')).toContainText('You can rotate again');
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
