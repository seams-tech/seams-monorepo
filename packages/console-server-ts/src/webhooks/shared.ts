import { secureRandomBase36, secureRandomBase64Url } from '../boundary';
import type { WebhookDispatchRequest, WebhookDispatchResult } from './service';
import type { EmitConsoleWebhookEventRequest, WebhookEventCategoryValidation } from './types';

export function createWebhookTestEvent(
  endpointId: string,
  now: Date,
): Required<EmitConsoleWebhookEventRequest> {
  return {
    eventId: makeId('wevt', now),
    eventType: 'webhook.test',
    payload: { test: true, endpointId, message: 'This is a test event from Seams.' },
  };
}

export const DELIVERY_RESPONSE_BODY_MAX_LEN = 2_048;
// Four UTF-8 bytes per UTF-16 code unit cover the existing string-length limit.
const DELIVERY_RESPONSE_BODY_MAX_BYTES = DELIVERY_RESPONSE_BODY_MAX_LEN * 4;
const WEBHOOK_DISPATCH_TIMEOUT_MS = 10_000;

export function makeId(prefix: string, now: Date): string {
  const ts = now.getTime().toString(36);
  const rand = secureRandomBase36(8, 'console IDs');
  return `${prefix}_${ts}_${rand}`;
}

export function coerceIsoDate(input: Date): string {
  return input.toISOString();
}

export function truncateResponseBody(input: string | undefined): string | null {
  if (!input) return null;
  if (input.length <= DELIVERY_RESPONSE_BODY_MAX_LEN) return input;
  return input.slice(0, DELIVERY_RESPONSE_BODY_MAX_LEN);
}

async function readWebhookResponsePreview(response: Response): Promise<string | undefined> {
  if (!response.body) return undefined;

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  try {
    while (totalBytes < DELIVERY_RESPONSE_BODY_MAX_BYTES) {
      const chunk = await reader.read();
      if (chunk.done) break;
      const remainingBytes = DELIVERY_RESPONSE_BODY_MAX_BYTES - totalBytes;
      const previewBytes = chunk.value.slice(0, remainingBytes);
      chunks.push(previewBytes);
      totalBytes += previewBytes.byteLength;
    }
    if (totalBytes === DELIVERY_RESPONSE_BODY_MAX_BYTES) {
      try {
        await reader.cancel();
      } catch {
        // The preview is complete even if the endpoint has closed its stream.
      }
    }
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return truncateResponseBody(new TextDecoder().decode(bytes)) || undefined;
}

const WEBHOOK_SIGNING_SECRET_BYTES = 32;
export const WEBHOOK_SIGNING_SECRET_PREFIX = 'whsec_';

/**
 * `whsec_` is a fixed prefix, so a head-slice preview is the same string for
 * every endpoint. Show the tail instead — that is the part that identifies
 * which secret a customer is holding.
 */
export function makeSecretPreview(secret: string): string {
  return `${WEBHOOK_SIGNING_SECRET_PREFIX}...${secret.slice(-4)}`;
}

/**
 * The signing secret is an HMAC key an attacker can grind offline against any
 * captured delivery, so it must be full-entropy random. It deliberately does
 * NOT embed a timestamp: `createdAt` is public on the endpoint, so any encoded
 * clock is known plaintext that shrinks the search space.
 */
export function makeSigningSecret(): string {
  return `${WEBHOOK_SIGNING_SECRET_PREFIX}${secureRandomBase64Url(
    WEBHOOK_SIGNING_SECRET_BYTES,
    'webhook signing secret',
  )}`;
}

export function normalizeEventCategory(
  eventType: string,
  categoryValidation: WebhookEventCategoryValidation,
): string | null {
  const value = String(eventType || '')
    .trim()
    .toLowerCase();
  if (!value) return null;
  const idx = value.indexOf('.');
  const category = idx === -1 ? value : value.slice(0, idx);
  return categoryValidation.normalizeCategory(category);
}

export async function signPayload(secret: string, message: string): Promise<string> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) {
    throw new Error('Webhook signing requires WebCrypto (crypto.subtle)');
  }

  const key = await subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await subtle.sign('HMAC', key, new TextEncoder().encode(message));
  const hex = Array.from(new Uint8Array(signature))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  return `v1=${hex}`;
}

export function toDispatchHeaders(input: {
  endpointId: string;
  eventId: string;
  eventType: string;
  signature: string;
  timestamp: string;
}): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    'X-Console-Webhook-Id': input.endpointId,
    'X-Console-Webhook-Event-Id': input.eventId,
    'X-Console-Webhook-Event-Type': input.eventType,
    'X-Console-Webhook-Timestamp': input.timestamp,
    'X-Console-Webhook-Signature': input.signature,
  };
}

export async function defaultDispatchWebhook(
  input: WebhookDispatchRequest,
): Promise<WebhookDispatchResult> {
  const controller = typeof AbortController === 'function' ? new AbortController() : null;
  const timeout = controller
    ? setTimeout(() => {
        try {
          controller.abort();
        } catch {
          // no-op
        }
      }, WEBHOOK_DISPATCH_TIMEOUT_MS)
    : null;

  try {
    const response = await fetch(input.endpointUrl, {
      method: 'POST',
      headers: input.headers,
      body: input.body,
      signal: controller?.signal,
    });
    const responseBody = await readWebhookResponsePreview(response);
    return {
      ok: response.ok,
      statusCode: response.status,
      responseBody,
      errorMessage: response.ok ? undefined : `HTTP ${response.status}`,
    };
  } catch (error: unknown) {
    return {
      ok: false,
      statusCode: 0,
      errorMessage: error instanceof Error ? error.message : String(error),
    };
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}
