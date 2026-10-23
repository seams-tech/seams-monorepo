import { expect, test, type Dialog, type Response } from '@playwright/test';
import { writeFile } from 'node:fs/promises';

// Supply a fresh identity-only cookie from the local Console session fixture.
// The browser performs organization creation, project creation, and session upgrade
// against the running Console. No API responses are mocked.
async function confirmDeletion(dialog: Dialog): Promise<void> {
  expect(dialog.message()).toContain('This permanently removes the organization');
  await dialog.accept();
}

function isOrganizationDeletion(response: Response): boolean {
  return (
    response.request().method() === 'DELETE' &&
    response.url().includes('/console/account/organizations/')
  );
}

test('Wallet identity completes onboarding on its session origin and survives reload', async ({
  page,
}, testInfo) => {
  const origin = process.env.SEAMS_HANDOFF_APP_ORIGIN || 'http://localhost:4001';
  const cookie = process.env.SEAMS_HANDOFF_IDENTITY_COOKIE;
  if (!cookie) throw new Error('SEAMS_HANDOFF_IDENTITY_COOKIE must contain a fresh local identity');
  expect(new URL(origin).hostname).toBe('localhost');
  const separator = cookie.indexOf('=');
  expect(separator).toBeGreaterThan(0);
  await page.context().addCookies([
    {
      name: cookie.slice(0, separator),
      value: cookie.slice(separator + 1),
      domain: new URL(origin).hostname,
      path: '/console',
      httpOnly: true,
      secure: true,
      sameSite: 'Lax',
    },
  ]);
  const before = await page.request.get(`${origin}/console/auth/session`);
  expect(await before.json()).toEqual({ ok: true, session: { kind: 'console_identity_v1' } });

  await page.goto(`${origin}/dashboard/login?db_org=previous-account&db_project=previous-project`);
  const organization = page.getByRole('form', { name: 'Create organization', exact: true });
  await expect(organization).toBeVisible();
  expect(new URL(page.url()).origin).toBe(origin);
  await page.reload();
  await expect(organization).toBeVisible();
  const suffix = Date.now().toString(36);
  await organization.getByLabel('Organization name').fill(`GitHub acceptance ${suffix}`);
  await organization.getByRole('button', { name: 'Continue', exact: true }).click();

  const project = page.getByRole('form', { name: 'Create project', exact: true });
  await expect(project).toBeVisible();
  await page.reload();
  await expect(project).toBeVisible();
  await project.getByLabel('Project name').fill(`Acceptance app ${suffix}`);
  await project.getByRole('button', { name: 'Create project', exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`${origin}/dashboard/overview`));
  await expect(page.getByRole('heading', { name: 'Overview', exact: true })).toBeVisible();
  const completed = await page.request.get(`${origin}/console/session`);
  expect(completed.status()).toBe(200);
  const session = await completed.json();
  expect(session.claims.userId).toMatch(/^github:handoff-/);
  expect(session.claims.orgId).toBeTruthy();
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Overview', exact: true })).toBeVisible();
  const resumed = await page.request.get(`${origin}/console/session`);
  expect(resumed.status()).toBe(200);
  const resumedSession = await resumed.json();
  expect(resumedSession.claims.userId).toBe(session.claims.userId);
  expect(resumedSession.claims.orgId).toBe(session.claims.orgId);
  await page.screenshot({ path: testInfo.outputPath('workspace.png'), fullPage: true });
  await page.goto(`${origin}/dashboard/account-settings`);
  await page.getByRole('button', { name: `More actions for GitHub acceptance ${suffix}` }).click();
  page.once('dialog', confirmDeletion);
  const deletionResponse = page.waitForResponse(isOrganizationDeletion);
  await page.getByRole('menuitem', { name: 'Delete', exact: true }).click();
  const deletion = await deletionResponse;
  if (!deletion.ok()) throw new Error(await deletion.text());
  expect(deletion.status()).toBe(200);
  await expect(page.getByRole('heading', { name: 'Signed out', exact: true })).toBeVisible();
  const deletedSession = await page.request.get(`${origin}/console/session`);
  expect(deletedSession.status()).toBe(401);
  const remaining = await page.request.get(`${origin}/console/account/organizations`, {
    headers: { Cookie: cookie },
  });
  expect(remaining.status()).toBe(200);
  expect((await remaining.json()).organizations).toEqual([]);
  await page.screenshot({ path: testInfo.outputPath('deleted-workspace.png'), fullPage: true });
  await writeFile(
    testInfo.outputPath('evidence.json'),
    JSON.stringify(
      {
        origin,
        userId: session.claims.userId,
        orgId: session.claims.orgId,
        identityStatus: before.status(),
        workspaceStatus: completed.status(),
        reloadStatus: resumed.status(),
        deletedSessionStatus: deletedSession.status(),
        remainingOrganizations: 0,
        finalUrl: page.url(),
      },
      null,
      2,
    ),
  );
});
