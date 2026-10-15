/// <reference types="@cloudflare/workers-types" />
import { WorkerEntrypoint } from 'cloudflare:workers';
import { createCloudflareD1AccountServiceBundle } from '@seams-internal/console-server/router/cloudflare/d1AccountServices';
import {
  createAccountPlatformServiceIngressFromEnvironment,
  createAccountServiceProducerFromEnvironment,
  type AccountServiceIngressEnvironment,
} from '@seams-internal/console-server/accountPlatform/serviceIngressEnvironment';
import type { D1DatabaseLike } from '@seams-internal/console-server/boundary/d1';
import { textValue } from '@seams-internal/console-shared/accountPlatform/boundary';
import { createConsoleEmailInvitationSecretCipherFromEnv } from './cron';
import { SatyrAccountOnboarding } from '@seams-internal/console-server/accountPlatform/onboarding';
import {
  createSatyrProvisioningAdapterFromEnvironment,
  type SatyrProvisioningEnvironment,
} from '@seams-internal/console-server/accountPlatform/satyrProvisioningEnvironment';

type SatyrAccountPlatformEnvironment = AccountServiceIngressEnvironment &
  SatyrProvisioningEnvironment &
  Parameters<typeof createConsoleEmailInvitationSecretCipherFromEnv>[0] & {
    readonly CONSOLE_DB: D1DatabaseLike;
    readonly SEAMS_TENANT_STORAGE_NAMESPACE: string;
    readonly CONSOLE_BASE_URL: string;
  };

/** Private Satyr authority. This entrypoint is reachable only through a service binding. */
export class SatyrAccountPlatform extends WorkerEntrypoint<SatyrAccountPlatformEnvironment> {
  async fetch(request: Request): Promise<Response> {
    const namespace = textValue(
      this.env.SEAMS_TENANT_STORAGE_NAMESPACE,
      'SEAMS_TENANT_STORAGE_NAMESPACE',
    );
    const invitationSecretCipher = createConsoleEmailInvitationSecretCipherFromEnv(this.env);
    const services = await createCloudflareD1AccountServiceBundle({
      database: this.env.CONSOLE_DB,
      namespace,
      ensureSchema: false,
      externalDeletionGuard: null,
      organizationEmail: {
        invitationSecretCipher,
        consoleBaseUrl: textValue(this.env.CONSOLE_BASE_URL, 'CONSOLE_BASE_URL'),
      },
    });
    if (new URL(request.url).pathname.startsWith('/account-platform/v1/onboarding/')) {
      const producer = await createAccountServiceProducerFromEnvironment(this.env);
      const provisioning = createSatyrProvisioningAdapterFromEnvironment(
        this.env,
        services.serviceAccess,
        globalThis.fetch.bind(globalThis),
      );
      if (!producer || !provisioning)
        return Response.json(
          { kind: 'rejected', error: { code: 'authority_unavailable' } },
          { status: 503 },
        );
      return new SatyrAccountOnboarding(
        services,
        producer,
        provisioning,
        this.ctx.waitUntil.bind(this.ctx),
      ).fetch(request);
    }
    const ingress = await createAccountPlatformServiceIngressFromEnvironment(this.env, services);
    if (!ingress)
      return Response.json(
        { kind: 'rejected', error: { code: 'authority_unavailable', retryable: true } },
        { status: 503 },
      );
    return (await ingress(request)) ?? new Response(null, { status: 404 });
  }
}
