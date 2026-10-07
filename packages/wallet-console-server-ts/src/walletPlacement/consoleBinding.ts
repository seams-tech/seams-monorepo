import type { TenantRuntimeWriterV1 } from '../tenantDeployment/resourceVerification';
import { isWalletHomeServiceRequest } from './service';

// Placement requests carry the local runtime identity, never caller-supplied writer headers.
export class WalletPlacementConsoleBinding {
  constructor(
    private readonly service: { fetch(request: Request): Promise<Response> },
    private readonly writer: TenantRuntimeWriterV1,
  ) {}

  fetch(input: Request | string, init?: RequestInit): Promise<Response> {
    const request = new Request(input, init);
    if (!isWalletHomeServiceRequest(request)) return this.service.fetch(request);
    const headers = new Headers(request.headers);
    headers.set('x-seams-writer-role', this.writer.role);
    headers.set('x-seams-writer-version', this.writer.versionId);
    headers.set('x-seams-writer-account', this.writer.resource.accountId);
    headers.set('x-seams-writer-database', this.writer.resource.databaseId);
    return this.service.fetch(new Request(request, { headers, redirect: 'manual' }));
  }
}
