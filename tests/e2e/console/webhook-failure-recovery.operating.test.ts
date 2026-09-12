import type { Route } from '@playwright/test';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { expect, readConsoleSuccess, test } from './harness';

type WebhookEventPayload = {
  readonly id: string;
  readonly type: string;
  readonly createdAt: string;
  readonly data: object;
};

type WebhookEndpointSummary = {
  readonly id: string;
  readonly url: string;
  readonly status: string;
  readonly eventCategories: readonly string[];
};

type WebhookDeliverySummary = {
  readonly id: string;
  readonly eventId: string;
  readonly status: string;
  readonly attemptCount: number;
  readonly responseStatus: number | null;
};

type WebhookDeadLetterSummary = {
  readonly id: string;
  readonly deliveryId: string;
  readonly failedAttempts: number;
  readonly lastResponseStatus: number | null;
  readonly resolvedAt: string | null;
};

type WebhookObservation = {
  readonly endpointId: string;
  readonly eventId: string;
  readonly eventType: string;
  readonly timestamp: string;
  readonly body: string;
  readonly payload: WebhookEventPayload | null;
  readonly signatureValid: boolean;
  readonly responseStatus: number;
};

type ReceiverState = {
  readonly secret: { value: string };
  readonly observations: WebhookObservation[];
  readonly waiters: Map<number, Array<(observation: WebhookObservation) => void>>;
  responseStatus: number;
};

type WebhookReceiver = {
  readonly url: string;
  readonly observations: readonly WebhookObservation[];
  setSecret(secret: string): void;
  waitForRequest(index: number): Promise<WebhookObservation>;
  close(): Promise<void>;
};

function requireString(value: unknown, label: string): string {
  if (typeof value !== 'string') throw new Error(`${label} must be a non-empty string`);
  const result = value.trim();
  if (!result) throw new Error(`${label} must be a non-empty string`);
  return result;
}

function readWebhookString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function readWebhookNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function readNullableWebhookNumber(value: unknown): number | null | undefined {
  if (value === null) return null;
  return readWebhookNumber(value) ?? undefined;
}

function parseWebhookEventPayload(value: unknown): WebhookEventPayload | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
  const id = readWebhookString(Reflect.get(value, 'id'));
  const type = readWebhookString(Reflect.get(value, 'type'));
  const createdAt = readWebhookString(Reflect.get(value, 'createdAt'));
  const data = Reflect.get(value, 'data');
  if (
    id === null ||
    type === null ||
    createdAt === null ||
    data === null ||
    typeof data !== 'object' ||
    Array.isArray(data)
  ) {
    return null;
  }
  return { id, type, createdAt, data };
}

function parseWebhookEndpoint(value: unknown): WebhookEndpointSummary | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
  const id = readWebhookString(Reflect.get(value, 'id'));
  const url = readWebhookString(Reflect.get(value, 'url'));
  const status = readWebhookString(Reflect.get(value, 'status'));
  const eventCategories = Reflect.get(value, 'eventCategories');
  if (id === null || url === null || status === null || !Array.isArray(eventCategories)) {
    return null;
  }
  if (eventCategories.some((entry) => typeof entry !== 'string')) return null;
  return { id, url, status, eventCategories };
}

function parseWebhookEndpointListResponse(
  value: unknown,
  _label: string,
): readonly WebhookEndpointSummary[] | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
  if (Reflect.get(value, 'ok') !== true) return null;
  const endpoints = Reflect.get(value, 'endpoints');
  if (!Array.isArray(endpoints)) return null;
  const decoded: WebhookEndpointSummary[] = [];
  for (const endpoint of endpoints) {
    const parsed = parseWebhookEndpoint(endpoint);
    if (parsed === null) return null;
    decoded.push(parsed);
  }
  return decoded;
}

function parseWebhookPolicyResponse(value: unknown, _label: string): string | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
  if (Reflect.get(value, 'ok') !== true) return null;
  const policy = Reflect.get(value, 'policy');
  if (policy === null || typeof policy !== 'object' || Array.isArray(policy)) return null;
  return readWebhookString(Reflect.get(policy, 'id'));
}

function parseWebhookApprovalResponse(value: unknown, _label: string): true | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
  if (Reflect.get(value, 'ok') !== true) return null;
  const approval = Reflect.get(value, 'approval');
  if (approval === null || typeof approval !== 'object' || Array.isArray(approval)) return null;
  return readWebhookString(Reflect.get(approval, 'id')) === null ? null : true;
}

function parseWebhookDelivery(value: unknown): WebhookDeliverySummary | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
  const id = readWebhookString(Reflect.get(value, 'id'));
  const eventId = readWebhookString(Reflect.get(value, 'eventId'));
  const status = readWebhookString(Reflect.get(value, 'status'));
  const attemptCount = readWebhookNumber(Reflect.get(value, 'attemptCount'));
  const responseStatus = readNullableWebhookNumber(Reflect.get(value, 'responseStatus'));
  if (
    id === null ||
    eventId === null ||
    status === null ||
    attemptCount === null ||
    !Number.isInteger(attemptCount) ||
    responseStatus === undefined
  ) {
    return null;
  }
  return { id, eventId, status, attemptCount, responseStatus };
}

function parseWebhookDeliveryListResponse(
  value: unknown,
  _label: string,
): readonly WebhookDeliverySummary[] | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
  if (Reflect.get(value, 'ok') !== true) return null;
  const deliveries = Reflect.get(value, 'deliveries');
  if (!Array.isArray(deliveries)) return null;
  const decoded: WebhookDeliverySummary[] = [];
  for (const delivery of deliveries) {
    const parsed = parseWebhookDelivery(delivery);
    if (parsed === null) return null;
    decoded.push(parsed);
  }
  return decoded;
}

function parseWebhookDeadLetter(value: unknown): WebhookDeadLetterSummary | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
  const id = readWebhookString(Reflect.get(value, 'id'));
  const deliveryId = readWebhookString(Reflect.get(value, 'deliveryId'));
  const failedAttempts = readWebhookNumber(Reflect.get(value, 'failedAttempts'));
  const lastResponseStatus = readNullableWebhookNumber(Reflect.get(value, 'lastResponseStatus'));
  const resolvedAtRaw = Reflect.get(value, 'resolvedAt');
  const resolvedAt =
    resolvedAtRaw === null
      ? null
      : resolvedAtRaw === undefined
        ? undefined
        : readWebhookString(resolvedAtRaw);
  if (
    id === null ||
    deliveryId === null ||
    failedAttempts === null ||
    !Number.isInteger(failedAttempts) ||
    lastResponseStatus === undefined ||
    resolvedAt === undefined
  ) {
    return null;
  }
  return { id, deliveryId, failedAttempts, lastResponseStatus, resolvedAt };
}

function parseWebhookDeadLetterListResponse(
  value: unknown,
  _label: string,
): readonly WebhookDeadLetterSummary[] | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
  if (Reflect.get(value, 'ok') !== true) return null;
  const deadLetters = Reflect.get(value, 'deadLetters');
  if (!Array.isArray(deadLetters)) return null;
  const decoded: WebhookDeadLetterSummary[] = [];
  for (const deadLetter of deadLetters) {
    const parsed = parseWebhookDeadLetter(deadLetter);
    if (parsed === null) return null;
    decoded.push(parsed);
  }
  return decoded;
}

function requireWebhookEventPayload(payload: WebhookEventPayload | null): WebhookEventPayload {
  if (payload === null) throw new Error('Webhook receiver captured an invalid event payload');
  return payload;
}

function readHeader(request: IncomingMessage, name: string): string {
  const value = request.headers[name.toLowerCase()];
  return Array.isArray(value) ? String(value[0] || '') : String(value || '');
}

async function readRequestBody(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
  }
  return Buffer.concat(chunks).toString('utf8');
}

function verifySignature(secret: string, timestamp: string, body: string, header: string): boolean {
  const received = header.trim().replace(/^v1=/, '');
  const expected = createHmac('sha256', secret)
    .update(`${timestamp}.${body}`, 'utf8')
    .digest('hex');
  const receivedBytes = Buffer.from(received, 'utf8');
  const expectedBytes = Buffer.from(expected, 'utf8');
  return (
    receivedBytes.length === expectedBytes.length && timingSafeEqual(receivedBytes, expectedBytes)
  );
}

function resolveReceiverWaiters(state: ReceiverState, observation: WebhookObservation): void {
  const waiters = state.waiters.get(state.observations.length - 1) || [];
  state.waiters.delete(state.observations.length - 1);
  for (const resolve of waiters) resolve(observation);
}

function handleReceiverRequest(
  state: ReceiverState,
  request: IncomingMessage,
  response: ServerResponse,
): void {
  void readRequestBody(request)
    .then((body) => {
      let payload: WebhookEventPayload | null = null;
      try {
        payload = parseWebhookEventPayload(JSON.parse(body));
      } catch {
        payload = null;
      }
      const timestamp = readHeader(request, 'x-console-webhook-timestamp');
      const responseStatus = state.responseStatus;
      const observation: WebhookObservation = {
        endpointId: readHeader(request, 'x-console-webhook-id'),
        eventId: readHeader(request, 'x-console-webhook-event-id'),
        eventType: readHeader(request, 'x-console-webhook-event-type'),
        timestamp,
        body,
        payload,
        signatureValid: verifySignature(
          state.secret.value,
          timestamp,
          body,
          readHeader(request, 'x-console-webhook-signature'),
        ),
        responseStatus,
      };
      state.observations.push(observation);
      resolveReceiverWaiters(state, observation);
      response.statusCode = responseStatus;
      state.responseStatus = 200;
      response.setHeader('content-type', 'text/plain');
      response.end(responseStatus === 200 ? 'accepted' : 'failed');
    })
    .catch(() => {
      response.statusCode = 500;
      response.end('receiver error');
    });
}

async function createWebhookReceiver(): Promise<WebhookReceiver> {
  const state: ReceiverState = {
    secret: { value: '' },
    observations: [],
    waiters: new Map(),
    responseStatus: 500,
  };
  const server: Server = createServer(handleReceiverRequest.bind(null, state));
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve());
  });
  const address = server.address();
  if (!address || typeof address === 'string') {
    await closeServer(server);
    throw new Error('Webhook receiver did not expose an ephemeral port');
  }
  return {
    url: `http://127.0.0.1:${address.port}/webhooks/seams`,
    get observations() {
      return state.observations;
    },
    setSecret(secret: string): void {
      state.secret.value = secret;
    },
    waitForRequest(index: number): Promise<WebhookObservation> {
      const existing = state.observations[index];
      if (existing) return Promise.resolve(existing);
      return new Promise((resolve) => {
        const waiters = state.waiters.get(index) || [];
        waiters.push(resolve);
        state.waiters.set(index, waiters);
      });
    },
    close: async () => await closeServer(server),
  };
}

async function closeServer(server: Server): Promise<void> {
  if (!server.listening) return;
  server.closeAllConnections();
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

function findWebhookEndpoint(
  rows: readonly WebhookEndpointSummary[],
  url: string,
): WebhookEndpointSummary {
  const endpoint = rows.find((row) => row.url === url);
  if (!endpoint) throw new Error(`Webhook endpoint ${url} was not found`);
  return endpoint;
}

function findWebhookDelivery(
  rows: readonly WebhookDeliverySummary[],
  eventId: string,
): WebhookDeliverySummary {
  const delivery = rows.find((row) => row.eventId === eventId);
  if (!delivery) throw new Error(`Webhook delivery ${eventId} was not found`);
  return delivery;
}

function findWebhookDeadLetter(
  rows: readonly WebhookDeadLetterSummary[],
  deliveryId: string,
): WebhookDeadLetterSummary {
  const deadLetter = rows.find((row) => row.deliveryId === deliveryId);
  if (!deadLetter) throw new Error(`Webhook dead letter for ${deliveryId} was not found`);
  return deadLetter;
}

class DelayedWebhookRead {
  private pending: Route | null = null;

  async handle(route: Route): Promise<void> {
    this.pending = route;
  }

  hasPending(): boolean {
    return this.pending !== null;
  }

  async release(): Promise<void> {
    if (!this.pending) throw new Error('Expected a pending webhook read');
    await this.pending.continue();
    this.pending = null;
  }
}

test('webhook delivery verifies HMAC, records a dead letter, and recovers on replay', async ({
  console,
}) => {
  const receiver = await createWebhookReceiver();
  try {
    const { page, api, tenant } = console;
    await console.provisionCompletedTenant();

    await page.goto('/dashboard/webhooks');
    await expect(page.getByLabel('Webhooks page')).toBeVisible();
    await page.getByRole('button', { name: 'Add endpoint', exact: true }).click();
    const createModal = page.getByRole('dialog', { name: 'Add endpoint', exact: true });
    await createModal.getByLabel('Endpoint URL').fill(receiver.url);
    await createModal
      .getByRole('group', { name: 'Select events to listen to' })
      .getByLabel('Policy changes')
      .check();
    await createModal.getByRole('button', { name: 'Add endpoint', exact: true }).click();

    const revealModal = page.getByRole('dialog', { name: 'Endpoint added', exact: true });
    const signingSecret = requireString(
      await revealModal.getByText(/^whsec_/).textContent(),
      'Webhook signing secret',
    );
    expect(signingSecret).toMatch(/^whsec_/);
    receiver.setSecret(signingSecret);
    await revealModal.getByRole('button', { name: /saved it/i }).click();

    const endpointsResponse = await api.get('/console/webhooks');
    const endpoints = await readConsoleSuccess(
      endpointsResponse,
      'Webhook endpoint list',
      parseWebhookEndpointListResponse,
    );
    const endpoint = findWebhookEndpoint(endpoints, receiver.url);
    const endpointId = endpoint.id;
    expect(endpoint.status.toUpperCase()).toBe('ACTIVE');
    expect(endpoint.eventCategories).toEqual(expect.arrayContaining(['policy']));

    const policyResponse = await api.post('/console/policies', {
      data: {
        name: `Webhook trigger ${tenant.orgId}`,
        rules: { blockedActions: ['delete_key'] },
        assignment: { scopeType: 'ENVIRONMENT', scopeId: tenant.environmentId },
      },
    });
    const policyId = await readConsoleSuccess(
      policyResponse,
      'Webhook trigger policy',
      parseWebhookPolicyResponse,
    );

    const approvalResponse = await api.post('/console/approvals', {
      data: {
        operationType: 'POLICY_PUBLISH',
        reason: 'Webhook operating path trigger',
        projectId: tenant.projectId,
        environmentId: tenant.environmentId,
        resourceType: 'policy',
        resourceId: policyId,
      },
    });
    await readConsoleSuccess(
      approvalResponse,
      'Webhook trigger approval',
      parseWebhookApprovalResponse,
    );

    const failedObservation = await receiver.waitForRequest(0);
    const failedPayload = requireWebhookEventPayload(failedObservation.payload);
    expect(failedObservation.endpointId).toBe(endpointId);
    expect(failedObservation.eventId).toBeTruthy();
    expect(failedObservation.eventType).toMatch(/^policy\./);
    expect(Number(failedObservation.timestamp)).toBeGreaterThan(0);
    expect(failedObservation.signatureValid).toBe(true);
    expect(failedPayload.id).toBe(failedObservation.eventId);
    expect(failedPayload.type).toBe(failedObservation.eventType);
    expect(failedObservation.responseStatus).toBe(500);

    const deliveriesResponse = await api.get(
      `/console/webhooks/${encodeURIComponent(endpointId)}/deliveries?limit=20`,
    );
    const deliveries = await readConsoleSuccess(
      deliveriesResponse,
      'Webhook delivery list',
      parseWebhookDeliveryListResponse,
    );
    const failedDelivery = findWebhookDelivery(deliveries, failedObservation.eventId);
    const deliveryId = failedDelivery.id;
    expect(failedDelivery.status.toUpperCase()).toBe('FAILED');
    expect(failedDelivery.attemptCount).toBe(1);
    expect(failedDelivery.responseStatus).toBe(500);

    const deadLettersResponse = await api.get(
      `/console/webhooks/${encodeURIComponent(endpointId)}/dead-letters?limit=20`,
    );
    const deadLetters = await readConsoleSuccess(
      deadLettersResponse,
      'Webhook dead-letter list',
      parseWebhookDeadLetterListResponse,
    );
    const deadLetter = findWebhookDeadLetter(deadLetters, deliveryId);
    expect(deadLetter.failedAttempts).toBe(1);
    expect(deadLetter.lastResponseStatus).toBe(500);
    expect(deadLetter.resolvedAt).toBeNull();

    await page.reload();
    const deliveriesTable = page.getByRole('table', { name: 'Webhook deliveries table' });
    const failedRow = deliveriesTable
      .getByRole('row')
      .filter({ hasText: failedObservation.eventType });
    await expect(failedRow).toBeVisible();
    await expect(failedRow).toContainText('Failed');
    await expect(failedRow).toContainText('500');
    await expect(failedRow).toContainText('1');

    const replayRequest = receiver.waitForRequest(1);
    await failedRow.getByRole('button', { name: 'Replay', exact: true }).click();
    const replayObservation = await replayRequest;
    expect(replayObservation.endpointId).toBe(endpointId);
    expect(replayObservation.eventId).toBe(failedObservation.eventId);
    expect(replayObservation.eventType).toBe(failedObservation.eventType);
    expect(replayObservation.signatureValid).toBe(true);
    expect(replayObservation.responseStatus).toBe(200);
    await expect(failedRow).toContainText('Succeeded');
    await expect(failedRow).toContainText('2');

    const recoveredDeadLettersResponse = await api.get(
      `/console/webhooks/${encodeURIComponent(endpointId)}/dead-letters?limit=20&includeResolved=true`,
    );
    const recoveredDeadLetters = await readConsoleSuccess(
      recoveredDeadLettersResponse,
      'Recovered webhook dead-letter list',
      parseWebhookDeadLetterListResponse,
    );
    const recoveredDeadLetter = findWebhookDeadLetter(recoveredDeadLetters, deliveryId);
    if (recoveredDeadLetter.resolvedAt === null) {
      throw new Error('Dead-letter resolution time was omitted');
    }

    await page.reload();
    await expect(page.getByLabel('Webhooks page')).toBeVisible();
    await expect(page.getByRole('button', { name: receiver.url, exact: true })).toBeVisible();
    const persistedRow = page
      .getByRole('table', { name: 'Webhook deliveries table' })
      .getByRole('row')
      .filter({ hasText: failedObservation.eventType });
    await expect(persistedRow).toContainText('Succeeded');
    await expect(persistedRow).toContainText('2');

    const otherUrl = `${receiver.url}/other`;
    const addedEndpoint = await api.post('/console/webhooks', {
      data: { url: otherUrl, eventCategories: ['billing'], status: 'ACTIVE' },
    });
    expect(addedEndpoint.ok()).toBe(true);
    const allEndpoints = await readConsoleSuccess(
      await api.get('/console/webhooks'), 'Endpoint selection fixtures', parseWebhookEndpointListResponse,
    );
    const otherEndpoint = findWebhookEndpoint(allEndpoints, otherUrl);
    const delayed = new DelayedWebhookRead();
    const deliveryPattern = `**/console/webhooks/${endpointId}/deliveries?*`;
    await page.route(deliveryPattern, delayed.handle.bind(delayed));
    await page.goto(`/dashboard/webhooks?endpointId=${encodeURIComponent(endpointId)}`);
    await expect.poll(delayed.hasPending.bind(delayed)).toBe(true);
    await page.getByRole('button', { name: otherUrl, exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`endpointId=${otherEndpoint.id}$`));
    await expect(deliveriesTable).not.toContainText(failedObservation.eventType);
    await Promise.all([page.waitForResponse(deliveryPattern), delayed.release()]);
    await page.waitForLoadState('networkidle');
    await expect(deliveriesTable).not.toContainText(failedObservation.eventType);
    await expect(page).toHaveURL(new RegExp(`endpointId=${otherEndpoint.id}$`));
    await page.unroute(deliveryPattern);
  } finally {
    await receiver.close();
  }
});
