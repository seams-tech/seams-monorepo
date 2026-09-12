import {
  request as playwrightRequest,
  test as base,
  type APIRequestContext,
  type APIResponse,
  type Locator,
  type Page,
  type Request,
  type Response,
  type TestInfo,
} from '@playwright/test';

const DEFAULT_CONSOLE_ORIGIN = 'https://localhost:4101';
const CONSOLE_ORGANIZATION_ID_PATTERN = /^org_[a-z0-9]{12}$/;

export type ConsoleTenantIdentity = {
  readonly orgId: string;
  readonly userId: string;
  readonly projectId: string;
  readonly environmentId: string;
  readonly organizationName: string;
  readonly projectName: string;
  readonly cookie: string;
};

export type ConsoleOrganization = {
  readonly id: string;
  readonly name: string;
  readonly slug: string;
  readonly status: string;
};

export type ConsoleProject = {
  readonly id: string;
  readonly name: string;
  readonly status: string;
};

export type ConsoleEnvironment = {
  readonly id: string;
  readonly projectId: string;
  readonly key: string;
  readonly name: string;
  readonly status: string;
};

export type ConsoleApiKey = {
  readonly id: string;
  readonly name: string;
  readonly kind: 'secret_key' | 'publishable_key';
  readonly environmentId: string;
  readonly status: string;
  readonly secretPreview: string;
};

export type ConsoleTenantResources = {
  readonly organization: ConsoleOrganization;
  readonly project: ConsoleProject;
  readonly environment: ConsoleEnvironment;
  readonly apiKeys: readonly ConsoleApiKey[];
};

export type ConsoleOperatingHarness = {
  readonly page: Page;
  readonly api: APIRequestContext;
  readonly tenant: ConsoleTenantIdentity;
  readonly diagnostics: ConsoleDiagnostics;
  readonly provisionCompletedTenant: () => Promise<ConsoleTenantResources>;
  readonly readTenantResources: () => Promise<ConsoleTenantResources>;
};

export type ConsoleDestination = {
  readonly name: string;
  readonly pathname: string;
};

export type ConsoleFixtures = {
  readonly console: ConsoleOperatingHarness;
};

function readRequiredString(value: unknown, label: string): string {
  if (typeof value !== 'string') throw new Error(`Console response omitted ${label}`);
  const result = value.trim();
  if (!result) throw new Error(`Console response omitted ${label}`);
  return result;
}

function readResponseBody(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function readConsoleErrorMessage(value: unknown): string {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return '';
  const message = Reflect.get(value, 'message');
  return typeof message === 'string' ? message.trim() : '';
}

export type ConsoleResponseDecoder<T> = (value: unknown, label: string) => T | null;

export async function readConsoleSuccess<T>(
  response: APIResponse,
  label: string,
  decode: ConsoleResponseDecoder<T>,
): Promise<T> {
  const raw = await response.text();
  const body = readResponseBody(raw);
  if (!response.ok()) {
    const message = readConsoleErrorMessage(body);
    throw new Error(
      `${label} failed with HTTP ${response.status()}${message ? `: ${message}` : ''}`,
    );
  }
  const decoded = decode(body, label);
  if (decoded === null) throw new Error(`${label} returned an invalid success response`);
  return decoded;
}

function parseOrganization(value: unknown, label: string): ConsoleOrganization {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} did not return an organization`);
  }
  return {
    id: readRequiredString(Reflect.get(value, 'id'), `${label}.id`),
    name: readRequiredString(Reflect.get(value, 'name'), `${label}.name`),
    slug: readRequiredString(Reflect.get(value, 'slug'), `${label}.slug`),
    status: readRequiredString(Reflect.get(value, 'status'), `${label}.status`),
  };
}

function parseProject(value: unknown, label: string): ConsoleProject {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} did not return a project`);
  }
  return {
    id: readRequiredString(Reflect.get(value, 'id'), `${label}.id`),
    name: readRequiredString(Reflect.get(value, 'name'), `${label}.name`),
    status: readRequiredString(Reflect.get(value, 'status'), `${label}.status`),
  };
}

function parseEnvironment(value: unknown, label: string): ConsoleEnvironment {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} did not return an environment`);
  }
  return {
    id: readRequiredString(Reflect.get(value, 'id'), `${label}.id`),
    projectId: readRequiredString(Reflect.get(value, 'projectId'), `${label}.projectId`),
    key: readRequiredString(Reflect.get(value, 'key'), `${label}.key`),
    name: readRequiredString(Reflect.get(value, 'name'), `${label}.name`),
    status: readRequiredString(Reflect.get(value, 'status'), `${label}.status`),
  };
}

function parseApiKey(value: unknown, label: string): ConsoleApiKey {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} did not return an API key`);
  }
  const kind = readRequiredString(Reflect.get(value, 'kind'), `${label}.kind`);
  if (kind !== 'secret_key' && kind !== 'publishable_key') {
    throw new Error(`${label}.kind was invalid`);
  }
  return {
    id: readRequiredString(Reflect.get(value, 'id'), `${label}.id`),
    name: readRequiredString(Reflect.get(value, 'name'), `${label}.name`),
    kind,
    environmentId: readRequiredString(
      Reflect.get(value, 'environmentId'),
      `${label}.environmentId`,
    ),
    status: readRequiredString(Reflect.get(value, 'status'), `${label}.status`),
    secretPreview: readRequiredString(
      Reflect.get(value, 'secretPreview'),
      `${label}.secretPreview`,
    ),
  };
}

function parseOrganizationOnboardingResponse(
  value: unknown,
  label: string,
): ConsoleOrganization | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
  if (Reflect.get(value, 'ok') !== true) return null;
  const result = Reflect.get(value, 'result');
  if (result === null || typeof result !== 'object' || Array.isArray(result)) return null;
  try {
    return parseOrganization(Reflect.get(result, 'organization'), label);
  } catch {
    return null;
  }
}

function parseProjectOnboardingResponse(
  value: unknown,
  label: string,
): { readonly project: ConsoleProject; readonly environment: ConsoleEnvironment } | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
  if (Reflect.get(value, 'ok') !== true) return null;
  const result = Reflect.get(value, 'result');
  if (result === null || typeof result !== 'object' || Array.isArray(result)) return null;
  try {
    return {
      project: parseProject(Reflect.get(result, 'project'), label),
      environment: parseEnvironment(Reflect.get(result, 'environment'), label),
    };
  } catch {
    return null;
  }
}

function parseOrganizationResponse(value: unknown, label: string): ConsoleOrganization | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
  if (Reflect.get(value, 'ok') !== true) return null;
  try {
    return parseOrganization(Reflect.get(value, 'org'), label);
  } catch {
    return null;
  }
}

function parseProjectListResponse(value: unknown, label: string): readonly ConsoleProject[] | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
  if (Reflect.get(value, 'ok') !== true) return null;
  const rows = Reflect.get(value, 'projects');
  if (!Array.isArray(rows)) return null;
  try {
    return rows.map((row, index) => parseProject(row, `${label} project ${index}`));
  } catch {
    return null;
  }
}

function parseEnvironmentListResponse(
  value: unknown,
  label: string,
): readonly ConsoleEnvironment[] | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
  if (Reflect.get(value, 'ok') !== true) return null;
  const rows = Reflect.get(value, 'environments');
  if (!Array.isArray(rows)) return null;
  try {
    return rows.map((row, index) => parseEnvironment(row, `${label} environment ${index}`));
  } catch {
    return null;
  }
}

function parseApiKeyListResponse(value: unknown, label: string): readonly ConsoleApiKey[] | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
  if (Reflect.get(value, 'ok') !== true) return null;
  const rows = Reflect.get(value, 'apiKeys');
  if (!Array.isArray(rows)) return null;
  try {
    return rows.map((row, index) => parseApiKey(row, `${label} API key ${index}`));
  } catch {
    return null;
  }
}

function fnv1aBase36(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36).padStart(8, '0').slice(-8);
}

function normalizeTenantLabel(value: string): string {
  return (
    value
      .replace(/[^a-z0-9]+/gi, ' ')
      .trim()
      .replace(/\s+/g, ' ')
      .slice(0, 32) || 'Console tenant'
  );
}

async function createTenantIdentity(testInfo: TestInfo): Promise<ConsoleTenantIdentity> {
  const runId = String(process.env.SEAMS_CONSOLE_TEST_RUN_ID || 'default').trim();
  const seed = `${runId} / ${testInfo.titlePath.join(' / ')}`;
  const suffix = fnv1aBase36(seed);
  const label = normalizeTenantLabel(testInfo.titlePath.at(-1) || 'Console tenant');
  const projectId = `proj_r117_${suffix}`;
  const orgId = `org_r117${suffix}`;
  if (!CONSOLE_ORGANIZATION_ID_PATTERN.test(orgId)) {
    throw new Error(`Generated Console organization ID was invalid: ${orgId}`);
  }
  const sessionCookie = process.env.SEAMS_INTENDED_CONSOLE_COOKIE;
  const userId = process.env.SEAMS_INTENDED_CONSOLE_USER_ID;
  if (!sessionCookie || !userId) throw new Error('Managed Console account fixture is missing');
  const accountApi = await playwrightRequest.newContext({
    baseURL: resolveConsoleApiOrigin(),
    ignoreHTTPSErrors: true,
    extraHTTPHeaders: { Cookie: sessionCookie },
  });
  let cookie: string;
  try {
    const created = await accountApi.post('/console/account/organizations', {
      data: { id: orgId, name: `Refactor 117 ${label} Organization` },
    });
    if (!created.ok()) throw new Error(`Organization creation failed (${created.status()})`);
    const selected = await accountApi.post(
      `/console/account/organizations/${orgId}/switch-context`,
      { data: {} },
    );
    if (!selected.ok()) throw new Error(`Organization selection failed (${selected.status()})`);
    cookie = selected.headers()['set-cookie']?.split(';')[0] || '';
    if (!cookie) throw new Error('Organization selection did not issue a session');
  } finally {
    await accountApi.dispose();
  }
  return {
    orgId,
    userId,
    projectId,
    environmentId: `${projectId}:dev`,
    organizationName: `Refactor 117 ${label} Organization`,
    projectName: `Refactor 117 ${label} Project`,
    cookie,
  };
}

function resolveOrigin(value: string | undefined, fallback: string): string {
  const normalized = String(value || '').trim();
  return normalized || fallback;
}

function resolveConsoleApiOrigin(): string {
  return resolveOrigin(
    process.env.SEAMS_CONSOLE_API_URL ||
      process.env.SEAMS_INTENDED_ROUTER_URL ||
      process.env.VITE_CONSOLE_BASE_URL,
    DEFAULT_CONSOLE_ORIGIN,
  );
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function collectDestinations(elements: HTMLElement[]): ConsoleDestination[] {
  const destinations: ConsoleDestination[] = [];
  const seen = new Set<string>();
  for (const element of elements) {
    if (element.getAttribute('aria-disabled') === 'true' || element.tabIndex === -1) continue;
    const href = element.getAttribute('href');
    if (!href) continue;
    const url = new URL(href, document.baseURI);
    if (!url.pathname.startsWith('/dashboard/') && !url.pathname.startsWith('/platform/')) {
      continue;
    }
    const name = String(element.textContent || '')
      .replace(/\s+/g, ' ')
      .trim();
    if (!name) continue;
    const destination = { name, pathname: url.pathname };
    const key = `${destination.name}:${destination.pathname}`;
    if (seen.has(key)) continue;
    seen.add(key);
    destinations.push(destination);
  }
  return destinations;
}

export async function readEnabledConsoleDestinations(
  navigation: Locator,
): Promise<readonly ConsoleDestination[]> {
  return await navigation.getByRole('link').evaluateAll(collectDestinations);
}

export function consoleDestinationUrlPattern(pathname: string): RegExp {
  return new RegExp(`${escapeRegExp(pathname)}/?$`);
}

export class ConsoleDiagnostics {
  private readonly entries: string[] = [];

  constructor(private readonly page: Page) {}

  attach(): void {
    this.page.on('pageerror', this.handlePageError);
    this.page.on('requestfailed', this.handleRequestFailed);
    this.page.on('response', this.handleResponse);
  }

  detach(): void {
    this.page.off('pageerror', this.handlePageError);
    this.page.off('requestfailed', this.handleRequestFailed);
    this.page.off('response', this.handleResponse);
  }

  hasEntries(): boolean {
    return this.entries.length > 0;
  }

  toString(): string {
    return this.entries.join('\n');
  }

  private handlePageError = (error: Error): void => {
    this.entries.push(`[pageerror] ${error.message}`);
  };

  private handleRequestFailed = (request: Request): void => {
    const failure = request.failure();
    this.entries.push(
      `[requestfailed] ${request.method()} ${request.url()}${failure?.errorText ? `: ${failure.errorText}` : ''}`,
    );
  };

  private handleResponse = (response: Response): void => {
    const status = response.status();
    if (status < 500) return;
    let pathname = '';
    try {
      pathname = new URL(response.url()).pathname;
    } catch {
      return;
    }
    if (!pathname.startsWith('/console/')) return;
    this.entries.push(`[console-${status}] ${response.url()}`);
  };
}

async function provisionOrganization(
  api: APIRequestContext,
  tenant: ConsoleTenantIdentity,
): Promise<ConsoleOrganization> {
  const response = await api.post('/console/onboarding/organization', {
    data: {
      org: {
        name: tenant.organizationName,
        slug: tenant.organizationName.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
      },
    },
  });
  return await readConsoleSuccess(
    response,
    'Console organization onboarding',
    parseOrganizationOnboardingResponse,
  );
}

async function provisionProject(
  api: APIRequestContext,
  tenant: ConsoleTenantIdentity,
): Promise<{ readonly project: ConsoleProject; readonly environment: ConsoleEnvironment }> {
  const response = await api.post('/console/onboarding/project', {
    data: {
      project: { id: tenant.projectId, name: tenant.projectName },
      environment: { id: tenant.environmentId, name: 'Development' },
    },
  });
  return await readConsoleSuccess(
    response,
    'Console project onboarding',
    parseProjectOnboardingResponse,
  );
}

async function readTenantResourcesFromApi(
  api: APIRequestContext,
  tenant: ConsoleTenantIdentity,
): Promise<ConsoleTenantResources> {
  const organizationResponse = await api.get('/console/org');
  const organization = await readConsoleSuccess(
    organizationResponse,
    'Console organization read',
    parseOrganizationResponse,
  );

  const projectsResponse = await api.get('/console/projects?status=ACTIVE');
  const projectRows = await readConsoleSuccess(
    projectsResponse,
    'Console project read',
    parseProjectListResponse,
  );
  const project = projectRows.find((row) => row.name === tenant.projectName);
  if (!project) throw new Error(`Console project ${tenant.projectName} was not found`);

  const environmentsResponse = await api.get(
    `/console/environments?projectId=${encodeURIComponent(project.id)}&status=ACTIVE`,
  );
  const environmentRows = await readConsoleSuccess(
    environmentsResponse,
    'Console environment read',
    parseEnvironmentListResponse,
  );
  const environment = environmentRows.find(
    (row) => row.projectId === project.id && row.key === 'dev',
  );
  if (!environment) throw new Error(`Development environment for ${project.id} was not found`);

  const apiKeysResponse = await api.get('/console/api-keys');
  const apiKeys = await readConsoleSuccess(
    apiKeysResponse,
    'Console API key read',
    parseApiKeyListResponse,
  );
  return { organization, project, environment, apiKeys };
}

export const test = base.extend<ConsoleFixtures>({
  console: async ({ page }, use, testInfo) => {
    const tenant = await createTenantIdentity(testInfo);
    const separator = tenant.cookie.indexOf('=');
    await page.context().addCookies([
      {
        name: tenant.cookie.slice(0, separator),
        value: tenant.cookie.slice(separator + 1),
        url: resolveConsoleApiOrigin(),
        httpOnly: true,
        secure: true,
        sameSite: 'None',
      },
    ]);
    const api = await playwrightRequest.newContext({
      baseURL: resolveConsoleApiOrigin(),
      storageState: await page.context().storageState(),
      ignoreHTTPSErrors: true,
    });
    const diagnostics = new ConsoleDiagnostics(page);
    diagnostics.attach();
    const harness: ConsoleOperatingHarness = {
      page,
      api,
      tenant,
      diagnostics,
      provisionCompletedTenant: async () => {
        const organization = await provisionOrganization(api, tenant);
        const { project, environment } = await provisionProject(api, tenant);
        if (organization.id !== tenant.orgId) {
          throw new Error(
            `Provisioned organization ID ${organization.id} did not match ${tenant.orgId}`,
          );
        }
        if (project.id !== tenant.projectId) {
          throw new Error(`Provisioned project ID ${project.id} did not match ${tenant.projectId}`);
        }
        if (environment.id !== tenant.environmentId) {
          throw new Error(
            `Provisioned environment ID ${environment.id} did not match ${tenant.environmentId}`,
          );
        }
        return { organization, project, environment, apiKeys: [] };
      },
      readTenantResources: async () => await readTenantResourcesFromApi(api, tenant),
    };

    let diagnosticError: Error | undefined;
    try {
      await use(harness);
    } finally {
      diagnostics.detach();
      if (diagnostics.hasEntries() && testInfo.status === testInfo.expectedStatus) {
        await testInfo.attach('console-diagnostics', {
          body: diagnostics.toString(),
          contentType: 'text/plain',
        });
        diagnosticError = new Error(`Console browser diagnostics were collected:\n${diagnostics}`);
      }
      await api.dispose();
    }
    if (diagnosticError) throw diagnosticError;
  },
});

export { expect } from '@playwright/test';
