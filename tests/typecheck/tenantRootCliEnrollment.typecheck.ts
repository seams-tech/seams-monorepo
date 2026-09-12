import type { CliEnrollment, EnrollmentApproval } from '../../packages/wallet-console-server-ts/src/tenantRootSecurity/cliEnrollmentStore';

declare const pending: Extract<CliEnrollment, { kind: 'pending' }>;
declare const approval: EnrollmentApproval;

// @ts-expect-error Approval requires an authenticated, bound browser approval.
const missingApproval: CliEnrollment = { ...pending, kind: 'approved' };
// @ts-expect-error A pending request cannot carry enrollment authority.
const prematureApproval: CliEnrollment = { ...pending, approval };
// @ts-expect-error Completion requires the recorded enrollment result.
const missingResult: CliEnrollment = { ...pending, kind: 'completed', approval };
void [missingApproval, prematureApproval, missingResult];
