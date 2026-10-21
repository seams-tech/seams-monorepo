import { consoleApplicationUrl } from '../boundary/normalization';
import {
  formatEmailDate,
  formatEmailDateTime,
  formatEmailMonth,
  renderEmailLayoutHtml,
  type EmailBlock,
  type EmailFact,
} from './layout';
import {
  FREE_PLAN_CARD_GRACE_DAYS,
  FREE_PLAN_CARD_REMINDER_DAYS,
  FREE_PLAN_LIMITS_V1,
  type FreePlanCardReminderDayV1,
  type FreePlanLimitV1,
  type FreePlanNoticeV1,
} from '../billing/freePlan';
import type {
  AccountWelcomeEmailV1,
  BillingRefundResultEmailV1,
  ConsoleEmailInvitationRole,
  ConsoleEmailNonInvitationTemplateV1,
  ConsoleEmailTemplateV1,
  FreePlanNoticeEmailV1,
  OrganizationInvitationEmailV1,
  OwnerMembershipChangedEmailV1,
  PrepaidTopUpReceiptEmailV1,
  RenderedConsoleEmail,
  TeamSignupAlertEmailV1,
} from './types';

type UnknownRecord = Readonly<Record<string, unknown>>;

export interface AccountWelcomeEmailV1Input {
  readonly recipientDisplayName: string;
  readonly organizationName: string;
  readonly projectName: string;
  readonly consoleBaseUrl: string;
  readonly docsBaseUrl: string;
}

export interface OrganizationInvitationEmailV1Input {
  readonly invitationId: string;
  readonly organizationName: string;
  readonly inviterDisplayName: string;
  readonly invitedRole: ConsoleEmailInvitationRole;
  readonly consoleBaseUrl: string;
  readonly expiresAt: string;
}

export type OwnerMembershipChangedEmailV1Input =
  | {
      readonly change: 'ADDED';
      readonly organizationName: string;
      readonly ownerDisplayName: string;
      readonly changedByDisplayName: string;
    }
  | {
      readonly change: 'REMOVED';
      readonly organizationName: string;
      readonly ownerDisplayName: string;
      readonly changedByDisplayName: string;
    };

export interface PrepaidTopUpReceiptEmailV1Input {
  readonly organizationName: string;
  readonly purchaseId: string;
  readonly amountMinor: number;
  readonly balanceAfterMinor: number;
  readonly purchasedAt: string;
  readonly consoleBaseUrl: string;
}

export interface BillingRefundResultEmailV1Input {
  readonly outcome: 'SUCCEEDED';
  readonly organizationName: string;
  readonly refundId: string;
  readonly amountMinor: number;
  readonly balanceAfterMinor: number;
  readonly consoleBaseUrl: string;
}

export interface FreePlanNoticeEmailV1Input {
  readonly organizationName: string;
  readonly consoleBaseUrl: string;
  readonly notice: FreePlanNoticeV1;
}

export interface TeamSignupAlertEmailV1Input {
  readonly accountEmail: string;
  readonly accountDisplayName: string;
  readonly organizationName: string;
  readonly signedUpAt: string;
}

export function buildAccountWelcomeEmailV1(
  input: AccountWelcomeEmailV1Input,
): AccountWelcomeEmailV1 {
  return {
    family: 'ACCOUNT_WELCOME',
    version: 1,
    recipientDisplayName: requiredText(input.recipientDisplayName, 'recipientDisplayName'),
    organizationName: requiredText(input.organizationName, 'organizationName'),
    projectName: requiredText(input.projectName, 'projectName'),
    consoleBaseUrl: httpBaseUrl(input.consoleBaseUrl, 'consoleBaseUrl'),
    docsBaseUrl: httpBaseUrl(input.docsBaseUrl, 'docsBaseUrl'),
  };
}

export function buildOrganizationInvitationEmailV1(
  input: OrganizationInvitationEmailV1Input,
): OrganizationInvitationEmailV1 {
  return {
    family: 'ORGANIZATION_INVITATION',
    version: 1,
    invitationId: requiredText(input.invitationId, 'invitationId'),
    organizationName: requiredText(input.organizationName, 'organizationName'),
    inviterDisplayName: requiredText(input.inviterDisplayName, 'inviterDisplayName'),
    invitedRole: invitationRole(input.invitedRole),
    consoleBaseUrl: httpBaseUrl(input.consoleBaseUrl, 'consoleBaseUrl'),
    expiresAt: isoTimestamp(input.expiresAt, 'expiresAt'),
  };
}

export function buildOwnerMembershipChangedEmailV1(
  input: OwnerMembershipChangedEmailV1Input,
): OwnerMembershipChangedEmailV1 {
  const common = {
    family: 'OWNER_MEMBERSHIP_CHANGED' as const,
    version: 1 as const,
    organizationName: requiredText(input.organizationName, 'organizationName'),
    ownerDisplayName: requiredText(input.ownerDisplayName, 'ownerDisplayName'),
    changedByDisplayName: requiredText(input.changedByDisplayName, 'changedByDisplayName'),
  };
  switch (input.change) {
    case 'ADDED':
      return { ...common, change: 'ADDED' };
    case 'REMOVED':
      return { ...common, change: 'REMOVED' };
    default:
      return assertNever(input);
  }
}

export function buildPrepaidTopUpReceiptEmailV1(
  input: PrepaidTopUpReceiptEmailV1Input,
): PrepaidTopUpReceiptEmailV1 {
  return {
    family: 'PREPAID_TOP_UP_RECEIPT',
    version: 1,
    organizationName: requiredText(input.organizationName, 'organizationName'),
    purchaseId: requiredText(input.purchaseId, 'purchaseId'),
    amountMinor: positiveMinorAmount(input.amountMinor, 'amountMinor'),
    balanceAfterMinor: integerMinorAmount(input.balanceAfterMinor, 'balanceAfterMinor'),
    currency: 'USD',
    purchasedAt: isoTimestamp(input.purchasedAt, 'purchasedAt'),
    consoleBaseUrl: httpBaseUrl(input.consoleBaseUrl, 'consoleBaseUrl'),
  };
}

export function buildBillingRefundResultEmailV1(
  input: BillingRefundResultEmailV1Input,
): BillingRefundResultEmailV1 {
  return {
    family: 'BILLING_REFUND_RESULT',
    version: 1,
    outcome: 'SUCCEEDED',
    organizationName: requiredText(input.organizationName, 'organizationName'),
    refundId: requiredText(input.refundId, 'refundId'),
    amountMinor: positiveMinorAmount(input.amountMinor, 'amountMinor'),
    currency: 'USD',
    balanceAfterMinor: integerMinorAmount(input.balanceAfterMinor, 'balanceAfterMinor'),
    consoleBaseUrl: httpBaseUrl(input.consoleBaseUrl, 'consoleBaseUrl'),
  };
}

export function buildFreePlanNoticeEmailV1(
  input: FreePlanNoticeEmailV1Input,
): FreePlanNoticeEmailV1 {
  return {
    family: 'FREE_PLAN_NOTICE',
    version: 1,
    organizationName: requiredText(input.organizationName, 'organizationName'),
    consoleBaseUrl: httpBaseUrl(input.consoleBaseUrl, 'consoleBaseUrl'),
    notice: freePlanNotice(input.notice),
  };
}

export function buildTeamSignupAlertEmailV1(
  input: TeamSignupAlertEmailV1Input,
): TeamSignupAlertEmailV1 {
  return {
    family: 'TEAM_SIGNUP_ALERT',
    version: 1,
    accountEmail: requiredText(input.accountEmail, 'accountEmail'),
    accountDisplayName: requiredText(input.accountDisplayName, 'accountDisplayName'),
    organizationName: requiredText(input.organizationName, 'organizationName'),
    signedUpAt: isoTimestamp(input.signedUpAt, 'signedUpAt'),
  };
}

export function parseConsoleEmailTemplate(raw: unknown): ConsoleEmailTemplateV1 {
  const record = unknownRecord(raw, 'template');
  if (record.version !== 1) {
    throw new Error('Unsupported console email template version');
  }
  switch (record.family) {
    case 'ACCOUNT_WELCOME':
      return parseAccountWelcome(record);
    case 'ORGANIZATION_INVITATION':
      return parseOrganizationInvitation(record);
    case 'OWNER_MEMBERSHIP_CHANGED':
      return parseOwnerMembershipChanged(record);
    case 'PREPAID_TOP_UP_RECEIPT':
      return parsePrepaidTopUpReceipt(record);
    case 'BILLING_REFUND_RESULT':
      return parseBillingRefundResult(record);
    case 'FREE_PLAN_NOTICE':
      return buildFreePlanNoticeEmailV1({
        organizationName: requiredRawString(record.organizationName, 'organizationName'),
        consoleBaseUrl: requiredRawString(record.consoleBaseUrl, 'consoleBaseUrl'),
        notice: parseFreePlanNotice(unknownRecord(record.notice, 'notice')),
      });
    case 'TEAM_SIGNUP_ALERT':
      return buildTeamSignupAlertEmailV1({
        accountEmail: requiredRawString(record.accountEmail, 'accountEmail'),
        accountDisplayName: requiredRawString(record.accountDisplayName, 'accountDisplayName'),
        organizationName: requiredRawString(record.organizationName, 'organizationName'),
        signedUpAt: requiredRawString(record.signedUpAt, 'signedUpAt'),
      });
    default:
      throw new Error('Unsupported console email template family');
  }
}

export function renderOrganizationInvitationEmailV1(
  template: OrganizationInvitationEmailV1,
  invitationSecret: string,
): RenderedConsoleEmail {
  const secret = requiredText(invitationSecret, 'invitationSecret');
  const invitationUrl = consoleApplicationUrl(
    new URL(template.consoleBaseUrl),
    '/dashboard/invitations/accept',
  );
  invitationUrl.searchParams.set('invitation_id', template.invitationId);
  invitationUrl.searchParams.set('token', secret);
  const subject = `Invitation to join ${template.organizationName}`;
  const role = invitationRoleLabel(template.invitedRole);
  const text = [
    `${template.inviterDisplayName} invited you to join ${template.organizationName} as ${role}.`,
    `Accept the invitation: ${invitationUrl.toString()}`,
    `This invitation expires ${formatEmailDateTime(template.expiresAt)}.`,
  ].join('\n\n');
  return {
    subject,
    text,
    html: htmlMessage({
      kicker: 'Invitation',
      heading: subject,
      paragraphs: [
        `${template.inviterDisplayName} invited you to join ${template.organizationName} as ${role}.`,
        `This invitation expires ${formatEmailDateTime(template.expiresAt)}.`,
      ],
      actionLabel: 'Accept invitation',
      actionUrl: invitationUrl.toString(),
    }),
  };
}

export function renderConsoleEmailV1(
  template: ConsoleEmailNonInvitationTemplateV1,
): RenderedConsoleEmail {
  switch (template.family) {
    case 'ACCOUNT_WELCOME':
      return renderAccountWelcome(template);
    case 'OWNER_MEMBERSHIP_CHANGED':
      return renderOwnerMembershipChanged(template);
    case 'PREPAID_TOP_UP_RECEIPT':
      return renderPrepaidTopUpReceipt(template);
    case 'BILLING_REFUND_RESULT':
      return renderSucceededRefund(template);
    case 'FREE_PLAN_NOTICE':
      return renderFreePlanNotice(template);
    case 'TEAM_SIGNUP_ALERT':
      return renderTeamSignupAlert(template);
    default:
      return assertNever(template);
  }
}

function parseAccountWelcome(record: UnknownRecord): AccountWelcomeEmailV1 {
  return buildAccountWelcomeEmailV1({
    recipientDisplayName: requiredRawString(record.recipientDisplayName, 'recipientDisplayName'),
    organizationName: requiredRawString(record.organizationName, 'organizationName'),
    projectName: requiredRawString(record.projectName, 'projectName'),
    consoleBaseUrl: requiredRawString(record.consoleBaseUrl, 'consoleBaseUrl'),
    docsBaseUrl: requiredRawString(record.docsBaseUrl, 'docsBaseUrl'),
  });
}

function parseOrganizationInvitation(record: UnknownRecord): OrganizationInvitationEmailV1 {
  rejectPresent(record, 'invitationSecret');
  rejectPresent(record, 'token');
  return buildOrganizationInvitationEmailV1({
    invitationId: requiredRawString(record.invitationId, 'invitationId'),
    organizationName: requiredRawString(record.organizationName, 'organizationName'),
    inviterDisplayName: requiredRawString(record.inviterDisplayName, 'inviterDisplayName'),
    invitedRole: parseInvitationRole(record.invitedRole),
    consoleBaseUrl: requiredRawString(record.consoleBaseUrl, 'consoleBaseUrl'),
    expiresAt: requiredRawString(record.expiresAt, 'expiresAt'),
  });
}

function parseOwnerMembershipChanged(record: UnknownRecord): OwnerMembershipChangedEmailV1 {
  const common = {
    organizationName: requiredRawString(record.organizationName, 'organizationName'),
    ownerDisplayName: requiredRawString(record.ownerDisplayName, 'ownerDisplayName'),
    changedByDisplayName: requiredRawString(record.changedByDisplayName, 'changedByDisplayName'),
  };
  switch (record.change) {
    case 'ADDED':
      return buildOwnerMembershipChangedEmailV1({ ...common, change: 'ADDED' });
    case 'REMOVED':
      return buildOwnerMembershipChangedEmailV1({ ...common, change: 'REMOVED' });
    default:
      throw new Error('Invalid owner membership email change');
  }
}

function parsePrepaidTopUpReceipt(record: UnknownRecord): PrepaidTopUpReceiptEmailV1 {
  requireUsd(record.currency);
  return buildPrepaidTopUpReceiptEmailV1({
    organizationName: requiredRawString(record.organizationName, 'organizationName'),
    purchaseId: requiredRawString(record.purchaseId, 'purchaseId'),
    amountMinor: requiredRawNumber(record.amountMinor, 'amountMinor'),
    balanceAfterMinor: requiredRawNumber(record.balanceAfterMinor, 'balanceAfterMinor'),
    purchasedAt: requiredRawString(record.purchasedAt, 'purchasedAt'),
    consoleBaseUrl: requiredRawString(record.consoleBaseUrl, 'consoleBaseUrl'),
  });
}

function parseBillingRefundResult(record: UnknownRecord): BillingRefundResultEmailV1 {
  requireUsd(record.currency);
  if (record.outcome !== 'SUCCEEDED') throw new Error('Only a completed refund has an email');
  rejectPresent(record, 'failureCode');
  return buildBillingRefundResultEmailV1({
    outcome: 'SUCCEEDED',
    organizationName: requiredRawString(record.organizationName, 'organizationName'),
    refundId: requiredRawString(record.refundId, 'refundId'),
    amountMinor: requiredRawNumber(record.amountMinor, 'amountMinor'),
    balanceAfterMinor: requiredRawNumber(record.balanceAfterMinor, 'balanceAfterMinor'),
    consoleBaseUrl: requiredRawString(record.consoleBaseUrl, 'consoleBaseUrl'),
  });
}

function renderOwnerMembershipChanged(
  template: OwnerMembershipChangedEmailV1,
): RenderedConsoleEmail {
  const added = template.change === 'ADDED';
  const subject = added
    ? `Owner added to ${template.organizationName}`
    : `Owner removed from ${template.organizationName}`;
  const sentence = added
    ? `${template.ownerDisplayName} is now an owner of ${template.organizationName}.`
    : `${template.ownerDisplayName} is no longer an owner of ${template.organizationName}.`;
  const changedBy = `This change was made by ${template.changedByDisplayName}.`;
  return {
    subject,
    text: `${sentence}\n\n${changedBy}`,
    html: htmlMessage({
      kicker: 'Team',
      heading: subject,
      paragraphs: [sentence, changedBy],
      actionLabel: null,
      actionUrl: null,
    }),
  };
}

function renderAccountWelcome(template: AccountWelcomeEmailV1): RenderedConsoleEmail {
  const consoleUrl = consoleApplicationUrl(
    new URL(template.consoleBaseUrl),
    '/dashboard',
  ).toString();
  const quickstartUrl = new URL('/getting-started/', template.docsBaseUrl).toString();
  const architectureUrl = new URL('/concepts/architecture', template.docsBaseUrl).toString();
  const subject = 'Welcome to Seams';
  const greeting = `Hey ${template.recipientDisplayName},`;
  const setup = `Your ${template.organizationName} organization and ${template.projectName} project are ready.`;
  const purpose =
    'We built Seams to make keys, credentials, and policies easier to ship without giving up control of your infrastructure.';
  const question = 'P.S. What are you building? Reply and tell us. We read every response.';
  const text = [
    greeting,
    'Welcome to Seams.',
    setup,
    purpose,
    'Here are three good places to start:',
    `1. Open your console: ${consoleUrl}`,
    `2. Follow the quickstart: ${quickstartUrl}`,
    `3. See how Seams works: ${architectureUrl}`,
    question,
    'Cheers,\nThe Seams team',
  ].join('\n\n');
  const html = renderEmailLayoutHtml({
    kicker: 'Welcome',
    preheader: setup,
    heading: subject,
    blocks: [
      { kind: 'paragraph', text: greeting },
      { kind: 'paragraph', text: setup },
      { kind: 'paragraph', text: purpose },
      { kind: 'paragraph', text: 'Here are three good places to start:' },
      {
        kind: 'links',
        items: [
          { label: 'Open your console', url: consoleUrl },
          { label: 'Follow the quickstart', url: quickstartUrl },
          { label: 'See how Seams works', url: architectureUrl },
        ],
      },
      { kind: 'paragraph', text: question },
    ],
    action: null,
    closing: 'Cheers, the Seams team',
  });
  return { subject, text, html };
}

function renderPrepaidTopUpReceipt(template: PrepaidTopUpReceiptEmailV1): RenderedConsoleEmail {
  const subject = `Top-up receipt for ${template.organizationName}`;
  const amount = usd(template.amountMinor);
  const balance = usd(template.balanceAfterMinor);
  const details = `We received your ${amount} prepaid top-up. Your balance is ${balance}.`;
  const purchasedAt = formatEmailDateTime(template.purchasedAt);
  const reference = `Purchase ${template.purchaseId} on ${purchasedAt}.`;
  return {
    subject,
    text: `${details}\n\n${reference}\n\nView billing: ${billingUrl(template.consoleBaseUrl)}`,
    html: htmlMessage({
      kicker: 'Billing',
      heading: subject,
      paragraphs: [details],
      facts: [
        { label: 'Top-up', value: amount },
        { label: 'Balance', value: balance },
        { label: 'Purchase', value: template.purchaseId },
        { label: 'Date', value: purchasedAt },
      ],
      actionLabel: 'View billing',
      actionUrl: billingUrl(template.consoleBaseUrl),
    }),
  };
}

function renderSucceededRefund(template: BillingRefundResultEmailV1): RenderedConsoleEmail {
  const subject = `Refund completed for ${template.organizationName}`;
  const details = `${usd(template.amountMinor)} was refunded. Your prepaid balance is ${usd(
    template.balanceAfterMinor,
  )}.`;
  const reference = `Refund reference: ${template.refundId}.`;
  return {
    subject,
    text: `${details}\n\n${reference}\n\nView billing: ${billingUrl(template.consoleBaseUrl)}`,
    html: htmlMessage({
      kicker: 'Billing',
      heading: subject,
      paragraphs: [details],
      facts: [
        { label: 'Refund', value: usd(template.amountMinor) },
        { label: 'Balance', value: usd(template.balanceAfterMinor) },
        { label: 'Reference', value: template.refundId },
      ],
      actionLabel: 'View billing',
      actionUrl: billingUrl(template.consoleBaseUrl),
    }),
  };
}

function renderTeamSignupAlert(template: TeamSignupAlertEmailV1): RenderedConsoleEmail {
  const subject = `New Console sign-up: ${template.organizationName}`;
  const signedUpAt = formatEmailDateTime(template.signedUpAt);
  const paragraphs = [
    `${template.accountDisplayName} (${template.accountEmail}) created the organization ${template.organizationName}.`,
    `Signed up on ${signedUpAt}.`,
  ];
  return {
    subject,
    text: paragraphs.join('\n\n'),
    html: htmlMessage({
      kicker: 'New sign-up',
      heading: subject,
      paragraphs: [paragraphs[0] ?? subject],
      facts: [
        { label: 'Name', value: template.accountDisplayName },
        { label: 'Email', value: template.accountEmail },
        { label: 'Organization', value: template.organizationName },
        { label: 'Signed up', value: signedUpAt },
      ],
      actionLabel: null,
      actionUrl: null,
    }),
  };
}

function freePlanNotice(notice: FreePlanNoticeV1): FreePlanNoticeV1 {
  switch (notice.kind) {
    case 'card_reminder':
      return {
        kind: notice.kind,
        day: reminderDay(notice.day),
        deadlineAt: isoTimestamp(notice.deadlineAt, 'deadlineAt'),
      };
    case 'card_required':
      return { kind: notice.kind, deadlineAt: isoTimestamp(notice.deadlineAt, 'deadlineAt') };
    case 'free_limit_warning':
      return {
        kind: notice.kind,
        monthUtc: monthUtcText(notice.monthUtc),
        limit: freePlanLimit(notice.limit),
        cardOnFile: notice.cardOnFile === true,
      };
    case 'free_limit_stop':
      return {
        kind: notice.kind,
        monthUtc: monthUtcText(notice.monthUtc),
        limit: freePlanLimit(notice.limit),
      };
    case 'growth_move':
      return {
        kind: notice.kind,
        startedAt: isoTimestamp(notice.startedAt, 'startedAt'),
        monthlyBaseMinor: positiveMinorAmount(notice.monthlyBaseMinor, 'monthlyBaseMinor'),
        priceVersion: requiredText(notice.priceVersion, 'priceVersion'),
      };
    default:
      return assertNever(notice);
  }
}

function parseFreePlanNotice(record: UnknownRecord): FreePlanNoticeV1 {
  switch (record.kind) {
    case 'card_reminder':
      return freePlanNotice({
        kind: record.kind,
        day: reminderDay(requiredRawNumber(record.day, 'day')),
        deadlineAt: requiredRawString(record.deadlineAt, 'deadlineAt'),
      });
    case 'card_required':
      return freePlanNotice({
        kind: record.kind,
        deadlineAt: requiredRawString(record.deadlineAt, 'deadlineAt'),
      });
    case 'free_limit_warning':
      if (typeof record.cardOnFile !== 'boolean') throw new Error('cardOnFile must be a boolean');
      return freePlanNotice({
        kind: record.kind,
        monthUtc: requiredRawString(record.monthUtc, 'monthUtc'),
        limit: freePlanLimit(record.limit),
        cardOnFile: record.cardOnFile,
      });
    case 'free_limit_stop':
      return freePlanNotice({
        kind: record.kind,
        monthUtc: requiredRawString(record.monthUtc, 'monthUtc'),
        limit: freePlanLimit(record.limit),
      });
    case 'growth_move':
      return freePlanNotice({
        kind: record.kind,
        startedAt: requiredRawString(record.startedAt, 'startedAt'),
        monthlyBaseMinor: requiredRawNumber(record.monthlyBaseMinor, 'monthlyBaseMinor'),
        priceVersion: requiredRawString(record.priceVersion, 'priceVersion'),
      });
    default:
      throw new Error('Invalid free plan notice kind');
  }
}

function reminderDay(value: number): FreePlanCardReminderDayV1 {
  const day = FREE_PLAN_CARD_REMINDER_DAYS.find((candidate) => candidate === value);
  if (day === undefined) throw new Error('Invalid free plan reminder day');
  return day;
}

function freePlanLimit(value: unknown): FreePlanLimitV1 {
  switch (value) {
    case 'active_users':
    case 'signatures':
      return value;
    default:
      throw new Error('Invalid free plan limit');
  }
}

function monthUtcText(value: string): string {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(value)) throw new Error('monthUtc must be YYYY-MM');
  return value;
}

function utcDate(iso: string): string {
  return formatEmailDate(iso);
}

function freePlanLimitSentence(limit: FreePlanLimitV1): string {
  return limit === 'active_users'
    ? `${FREE_PLAN_LIMITS_V1.productionActiveUsers.toLocaleString('en-US')} production monthly active users`
    : `${FREE_PLAN_LIMITS_V1.productionSignatures.toLocaleString('en-US')} production signatures`;
}

function renderFreePlanNotice(template: FreePlanNoticeEmailV1): RenderedConsoleEmail {
  const notice = template.notice;
  const organization = template.organizationName;
  const keepOpen = 'Recovery and key export stay open. Development environments keep working.';
  let subject: string;
  let paragraphs: string[];
  let actionLabel = 'Add a card';
  switch (notice.kind) {
    case 'card_reminder': {
      const daysLeft = FREE_PLAN_CARD_GRACE_DAYS - notice.day;
      subject = `Add a card by ${utcDate(notice.deadlineAt)} to keep production running`;
      paragraphs = [
        `${organization} uses the Seams Free plan without a card. In ${daysLeft} ${daysLeft === 1 ? 'day' : 'days'}, production needs a card on file to continue.`,
        'We do not charge the card while your usage stays inside the Free limits.',
      ];
      break;
    }
    case 'card_required':
      subject = 'Production is paused until you add a card';
      paragraphs = [
        `Production sign-ups and signing for ${organization} are paused, because no usable card is on file.`,
        keepOpen,
        'Production resumes as soon as you add a card.',
      ];
      break;
    case 'free_limit_warning':
      subject = notice.cardOnFile
        ? 'You will move to Growth at the Free limit'
        : 'Add a card before the Free limit';
      paragraphs = [
        `${organization} used 80% of a Free limit in ${formatEmailMonth(notice.monthUtc)}: ${freePlanLimitSentence(notice.limit)}.`,
        notice.cardOnFile
          ? 'At the limit, your organization moves to Growth at $99 a month. Production does not stop.'
          : 'At the limit, production sign-ups and signing stop until you add a card. With a card, your organization moves to Growth at $99 a month.',
      ];
      if (notice.cardOnFile) actionLabel = 'View billing';
      break;
    case 'free_limit_stop':
      subject = 'Production sign-ups or signing are paused. Add a card.';
      paragraphs = [
        `${organization} reached a Free limit in ${formatEmailMonth(notice.monthUtc)}: ${freePlanLimitSentence(notice.limit)}.`,
        keepOpen,
        'Add a card to move to Growth at $99 a month. Production resumes at once.',
      ];
      break;
    case 'growth_move':
      subject = `Your organization moved to Growth: ${usd(notice.monthlyBaseMinor)} a month from ${utcDate(notice.startedAt)}`;
      paragraphs = [
        `${organization} reached a Free limit and moved to the Growth plan on ${utcDate(notice.startedAt)}.`,
        'Growth includes 5,000 monthly active users, then $0.004 per user.',
      ];
      actionLabel = 'View billing';
      break;
    default:
      return assertNever(notice);
  }
  const url = billingUrl(template.consoleBaseUrl);
  return {
    subject,
    text: `${paragraphs.join('\n\n')}\n\n${actionLabel}: ${url}`,
    html: htmlMessage({
      kicker: 'Free plan',
      heading: subject,
      paragraphs,
      actionLabel,
      actionUrl: url,
    }),
  };
}

function htmlMessage(input: {
  readonly kicker: string;
  readonly heading: string;
  readonly paragraphs: readonly string[];
  readonly facts?: readonly EmailFact[];
  readonly actionLabel: string | null;
  readonly actionUrl: string | null;
}): string {
  const blocks: EmailBlock[] = input.paragraphs.map((text) => ({ kind: 'paragraph', text }));
  if (input.facts) blocks.push({ kind: 'facts', rows: input.facts });
  return renderEmailLayoutHtml({
    kicker: input.kicker,
    preheader: input.paragraphs[0] ?? input.heading,
    heading: input.heading,
    blocks,
    action:
      input.actionLabel && input.actionUrl
        ? { label: input.actionLabel, url: input.actionUrl }
        : null,
  });
}

function billingUrl(consoleBaseUrl: string): string {
  return consoleApplicationUrl(new URL(consoleBaseUrl), '/dashboard/billing').toString();
}

function invitationRoleLabel(role: ConsoleEmailInvitationRole): string {
  switch (role) {
    case 'OWNER':
      return 'an owner';
    case 'ADMIN':
      return 'an administrator';
    case 'MEMBER':
      return 'a member';
    default:
      return assertNever(role);
  }
}

function parseInvitationRole(value: unknown): ConsoleEmailInvitationRole {
  switch (value) {
    case 'OWNER':
    case 'ADMIN':
    case 'MEMBER':
      return value;
    default:
      throw new Error('Invalid invitedRole');
  }
}

function invitationRole(value: ConsoleEmailInvitationRole): ConsoleEmailInvitationRole {
  return parseInvitationRole(value);
}

function usd(minor: number): string {
  const negative = minor < 0;
  const absolute = Math.abs(minor);
  const major = Math.floor(absolute / 100);
  const cents = String(absolute % 100).padStart(2, '0');
  return `${negative ? '-' : ''}$${major}.${cents}`;
}

function requiredText(value: string, field: string): string {
  const normalized = value.trim();
  if (!normalized) throw new Error(`${field} is required`);
  return normalized;
}

function requiredRawString(value: unknown, field: string): string {
  if (typeof value !== 'string') throw new Error(`${field} must be a string`);
  return requiredText(value, field);
}

function requiredRawNumber(value: unknown, field: string): number {
  if (typeof value !== 'number') throw new Error(`${field} must be a number`);
  return value;
}

function integerMinorAmount(value: number, field: string): number {
  if (!Number.isSafeInteger(value)) throw new Error(`${field} must be a safe integer`);
  return value;
}

function positiveMinorAmount(value: number, field: string): number {
  const amount = integerMinorAmount(value, field);
  if (amount <= 0) throw new Error(`${field} must be positive`);
  return amount;
}

function isoTimestamp(value: string, field: string): string {
  const normalized = requiredText(value, field);
  const date = new Date(normalized);
  if (!Number.isFinite(date.getTime())) throw new Error(`${field} must be an ISO timestamp`);
  return date.toISOString();
}

function httpBaseUrl(value: string, field: string): string {
  const url = new URL(requiredText(value, field));
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new Error(`${field} must use http or https`);
  }
  url.pathname = '/';
  url.hash = '';
  return consoleApplicationUrl(url, '/').toString();
}

function unknownRecord(value: unknown, field: string): UnknownRecord {
  if (!isUnknownRecord(value)) {
    throw new Error(`${field} must be an object`);
  }
  return value;
}

function isUnknownRecord(value: unknown): value is UnknownRecord {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function requireUsd(value: unknown): void {
  if (value !== 'USD') throw new Error('currency must be USD');
}

function rejectPresent(record: UnknownRecord, field: string): void {
  if (field in record) throw new Error(`${field} is not allowed for this email template`);
}

function assertNever(value: never): never {
  throw new Error(`Unhandled console email branch: ${JSON.stringify(value)}`);
}
