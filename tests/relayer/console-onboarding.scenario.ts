import { expect } from '@playwright/test';
import type { D1DatabaseLike, WalletConsoleServiceBinding } from '@seams/wallet-server/cloud-host';
import { consoleIdentityCookie } from '../helpers/consoleWorkerEnvironment';

/** Exercises the hosted entrypoint before any deployment exists in its D1 database. */
export async function verifyUnactivatedConsoleOnboarding(input: {
  readonly service: WalletConsoleServiceBinding;
  readonly database: D1DatabaseLike;
  readonly sessionSecret: string;
}) {
  const organizationId = 'org_aabbccddeeff';
  const identityCookie = await consoleIdentityCookie(input.sessionSecret, 'onboarding-owner');
  const organization = await input.service.fetch(
    'https://console.example.test/console/account/organizations',
    {
      method: 'POST',
      headers: { cookie: identityCookie, 'content-type': 'application/json' },
      body: JSON.stringify({ id: organizationId, name: 'Fresh deployment organization' }),
    },
  );
  expect(organization.status, await organization.clone().text()).toBe(200);
  const cookie = organization.headers.get('set-cookie')?.split(';')[0];
  if (!cookie) throw new Error('Organization creation did not return its session');

  const projectUrl = 'https://console.example.test/console/onboarding/project';
  const wrongMethod = await input.service.fetch(projectUrl, { headers: { cookie } });
  expect(wrongMethod.status).toBe(405);
  expect(wrongMethod.headers.get('allow')).toBe('POST');
  expect(await wrongMethod.json()).toMatchObject({ code: 'method_not_allowed' });
  const projectId = 'proj_onboarding_replay';
  const request = {
    method: 'POST',
    headers: { cookie, 'content-type': 'application/json' },
    body: JSON.stringify({ project: { id: projectId, name: 'Fresh project' } }),
  };
  const first = await input.service.fetch(projectUrl, request);
  expect(first.status, await first.clone().text()).toBe(201);
  const initial = await first.json();
  expect(initial).toMatchObject({
    ok: true,
    result: {
      project: { id: projectId },
      environment: { id: `${projectId}:dev` },
      created: { project: true },
      state: { orgId: organizationId, onboardingComplete: true, activeProjectCount: 1 },
    },
  });
  const selected = await input.service.fetch(
    `https://console.example.test/console/account/organizations/${organizationId}/switch-context`,
    { method: 'POST', headers: { cookie, 'content-type': 'application/json' }, body: '{}' },
  );
  expect(selected.status, await selected.clone().text()).toBe(200);
  expect(selected.headers.get('set-cookie')).toBeTruthy();

  // Replay the exact request after discarding its response, as a retrying browser does.
  const replay = await input.service.fetch(projectUrl, request);
  expect(replay.status, await replay.clone().text()).toBe(200);
  expect(await replay.json()).toMatchObject({
    ok: true,
    result: {
      project: { id: projectId },
      environment: { id: `${projectId}:dev` },
      created: { project: false, environment: false },
      state: { onboardingComplete: true, activeProjectCount: 1 },
    },
  });
  const stateResponse = await input.service.fetch(
    'https://console.example.test/console/onboarding/state',
    {
      headers: { cookie },
    },
  );
  expect(stateResponse.status).toBe(200);
  expect(await stateResponse.json()).toMatchObject({
    state: {
      onboardingComplete: true,
      selectedProjectId: projectId,
      selectedEnvironmentId: `${projectId}:dev`,
    },
  });
  const projects = await input.database
    .prepare('SELECT COUNT(*) AS count FROM projects WHERE id = ?')
    .bind(projectId)
    .first<number>('count');
  const activations = await input.database
    .prepare('SELECT COUNT(*) AS count FROM active_tenant_deployment_bindings')
    .first<number>('count');
  expect(projects).toBe(1);
  expect(activations).toBe(0);

  const unauthorizedActivation = await input.service.fetch(
    'https://console.example.test/internal/tenant-deployment/v1/cutover',
    {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({
        deploymentLane: 'console-preflight',
        environmentId: `${projectId}:dev`,
      }),
    },
  );
  expect(unauthorizedActivation.status).toBe(401);
  return {
    stage: 'onboarding_before_activation',
    projectId,
    environmentId: `${projectId}:dev`,
    createStatus: first.status,
    replayStatus: replay.status,
    wrongMethodStatus: wrongMethod.status,
    unauthorizedActivationStatus: unauthorizedActivation.status,
    organizationSelectionStatus: selected.status,
    projectCount: projects,
    activationCount: activations,
  };
}
