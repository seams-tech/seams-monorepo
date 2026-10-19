import type {
  TenantRootCreationGrantIssueV1,
  TenantRootCreationGrantRecordV1,
  TenantRootCreationGrantRenewalInputV1,
} from '../../packages/wallet-console-server-ts/src/tenantRootCreation/types';

declare const active: Extract<TenantRootCreationGrantRecordV1, { readonly status: 'ACTIVE' }>;
declare const renewed: TenantRootCreationGrantIssueV1;

const activeRenewal: TenantRootCreationGrantRenewalInputV1 = {
  // @ts-expect-error An active root cannot enter initial-authorization renewal.
  previous: active,
  renewed,
  expiredThroughMs: 1,
};
const spreadRenewal: TenantRootCreationGrantRenewalInputV1 = {
  // @ts-expect-error A spread must not bypass the active-state restriction.
  previous: { ...active },
  renewed,
  expiredThroughMs: 1,
};

void [activeRenewal, spreadRenewal];
