import { expect, test } from '@playwright/test';
import {
  D1_STAGING_GENERATED_AT_ISO,
  loadD1StagingScriptModule,
  writeMisScopedConsoleD1StagingConfigFiles,
  writeValidD1StagingConfigFiles,
} from './helpers/d1StagingScriptFixtures';

type RunbookModule = {
  readonly buildD1StagingRunbook: (input: {
    readonly consoleConfigPath: string;
    readonly gatewayConfigPath: string;
    readonly outputPath?: string;
    readonly generatedAtIso?: string;
    readonly operator?: string;
    readonly r2Bucket?: string;
    readonly consoleOrigin?: string;
    readonly gatewayOrigin?: string;
  }) => string;
};

const runbookModule = loadD1StagingScriptModule<RunbookModule>('d1-staging-runbook.mjs');
const runbookConfigPaths = writeValidD1StagingConfigFiles('seams-d1-staging-runbook-');
const runbookOptions = {
  ...runbookConfigPaths,
  generatedAtIso: D1_STAGING_GENERATED_AT_ISO,
  operator: 'staging-operator',
  r2Bucket: 'seams-staging-backups',
  consoleOrigin: 'https://console.staging.example',
  gatewayOrigin: 'https://gateway.staging.example',
};
test('D1 staging runbook rejects configs that fail the staging readiness gate', async () => {
  const module = await runbookModule;

  expect(() =>
    module.buildD1StagingRunbook({
      ...runbookOptions,
      ...writeMisScopedConsoleD1StagingConfigFiles('seams-d1-staging-runbook-'),
    }),
  ).toThrow(/console staging config must not reference SIGNER_DB/);
});

test('D1 staging runbook requires concrete HTTPS origins', async () => {
  const module = await runbookModule;

  expect(() =>
    module.buildD1StagingRunbook({
      ...runbookOptions,
      gatewayOrigin: 'http://gateway.staging.example',
    }),
  ).toThrow(/--gateway-origin must use https/);
});

test('D1 staging runbook rejects placeholder endpoint commands', async () => {
  const module = await runbookModule;

  expect(() =>
    module.buildD1StagingRunbook({
      ...runbookConfigPaths,
      generatedAtIso: D1_STAGING_GENERATED_AT_ISO,
      operator: 'staging-operator',
      r2Bucket: 'seams-staging-backups',
    }),
  ).toThrow(/--console-origin is required/);
});

test('D1 staging runbook rejects R2 object paths as bucket names', async () => {
  const module = await runbookModule;

  expect(() =>
    module.buildD1StagingRunbook({
      ...runbookOptions,
      r2Bucket: 'seams-staging-backups/refactor-82',
    }),
  ).toThrow(/--r2-bucket must be a bucket name/);
});
