import type { Miniflare } from 'miniflare';

type MiniflareWorker = Awaited<ReturnType<Miniflare['getWorker']>>;

const NULL_BODY_STATUSES = new Set([101, 204, 205, 304]);

/**
 * Presents a miniflare Worker as a service binding.
 *
 * Production code types a binding with the global `Request` and `Response`.
 * Miniflare's Worker handle uses its own fetch types, so a test cannot pass the
 * handle where a binding is required. This re-issues each request by value.
 */
export class MiniflareServiceBinding {
  constructor(private readonly worker: MiniflareWorker) {}

  async fetch(input: Request | string, init?: RequestInit): Promise<Response> {
    const request = new Request(input, init);
    const response = await this.worker.fetch(request.url, {
      method: request.method,
      headers: Array.from(request.headers.entries()),
      body: request.body === null ? undefined : await request.arrayBuffer(),
    });
    return new Response(
      NULL_BODY_STATUSES.has(response.status) ? null : await response.arrayBuffer(),
      { status: response.status, headers: Array.from(response.headers.entries()) },
    );
  }
}
