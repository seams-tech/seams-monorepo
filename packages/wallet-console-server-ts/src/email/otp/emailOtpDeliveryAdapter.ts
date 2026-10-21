import type {
  CloudflareD1EmailOtpDeliveryProvider,
  CloudflareD1EmailOtpDeliveryProviderInput,
  CloudflareD1EmailOtpDeliveryProviderResult,
} from '@seams/wallet-server/cloud-host';
import type { WalletEmailOtpOperation } from '@seams/wallet-server/cloud-host';
import { renderEmailLayoutHtml } from '@seams-internal/console-server/email/layout';

export type EmailOtpMessage = {
  readonly deliveryId: string;
  readonly recipientEmail: string;
  readonly subject: string;
  readonly text: string;
  readonly html: string;
};

export interface EmailOtpMessageProvider {
  send(message: EmailOtpMessage): Promise<CloudflareD1EmailOtpDeliveryProviderResult>;
}

export interface RenderedEmailOtpMessage {
  readonly subject: string;
  readonly text: string;
  readonly html: string;
}

type EmailOtpOperationCopy = {
  readonly subject: string;
  readonly heading: string;
  readonly introduction: string;
  readonly caution: string;
};

export function createEmailOtpDeliveryAdapter(
  provider: EmailOtpMessageProvider,
  now: () => number = Date.now,
): CloudflareD1EmailOtpDeliveryProvider {
  return new EmailOtpDeliveryAdapter(provider, now);
}

class EmailOtpDeliveryAdapter implements CloudflareD1EmailOtpDeliveryProvider {
  constructor(
    private readonly provider: EmailOtpMessageProvider,
    private readonly now: () => number,
  ) {}

  async deliver(
    input: CloudflareD1EmailOtpDeliveryProviderInput,
  ): Promise<CloudflareD1EmailOtpDeliveryProviderResult> {
    const rendered = renderEmailOtpMessage({
      operation: input.operation,
      otpCode: input.otpCode,
      expiresAtMs: input.expiresAtMs,
      nowMs: this.now(),
    });
    return this.provider.send({
      deliveryId: input.challengeId,
      recipientEmail: input.email,
      subject: rendered.subject,
      text: rendered.text,
      html: rendered.html,
    });
  }
}

export function renderEmailOtpMessage(
  input: Pick<
    CloudflareD1EmailOtpDeliveryProviderInput,
    'operation' | 'otpCode' | 'expiresAtMs'
  > & { readonly nowMs: number },
): RenderedEmailOtpMessage {
  const copy = emailOtpOperationCopy(parseEmailOtpOperation(input.operation));
  const expiry = expiryText(input.expiresAtMs, input.nowMs);
  const text = [
    copy.heading,
    copy.introduction,
    `Your one-time code is: ${input.otpCode}`,
    `This code expires ${expiry}.`,
    copy.caution,
    'Seams staff will never ask for this code. If you did not request this action, ignore this email.',
  ].join('\n\n');
  return {
    subject: copy.subject,
    text,
    html: renderEmailLayoutHtml({
      kicker: 'Security code',
      preheader: copy.introduction,
      heading: copy.heading,
      blocks: [
        { kind: 'paragraph', text: copy.introduction },
        { kind: 'code', label: 'One-time code', code: input.otpCode },
        { kind: 'paragraph', text: `This code expires ${expiry}.` },
        { kind: 'paragraph', text: copy.caution },
      ],
      action: null,
      closing:
        'Seams staff will never ask for this code. If you did not request this action, ignore this email.',
    }),
  };
}

function emailOtpOperationCopy(operation: WalletEmailOtpOperation): EmailOtpOperationCopy {
  switch (operation) {
    case 'registration':
      return {
        subject: 'Your Seams registration code',
        heading: 'Confirm your wallet registration',
        introduction: 'Enter this code to finish creating your Seams wallet.',
        caution: 'Continue only if you started this wallet registration.',
      };
    case 'wallet_unlock':
      return {
        subject: 'Your Seams wallet unlock code',
        heading: 'Confirm your wallet unlock',
        introduction: 'Enter this code to unlock your Seams wallet.',
        caution: 'Continue only if you requested access to this wallet.',
      };
    case 'transaction_sign':
      return {
        subject: 'Confirm your Seams transaction',
        heading: 'Confirm transaction signing',
        introduction: 'Enter this code to authorize signing a transaction with your Seams wallet.',
        caution: 'Review the transaction details in your wallet before entering the code.',
      };
    case 'export_key':
      return {
        subject: 'Confirm your Seams key export',
        heading: 'Confirm key export',
        introduction: 'Enter this code to authorize exporting your Seams wallet key material.',
        caution:
          'Exported key material grants full control of your wallet. Continue only if you requested it.',
      };
    case 'wallet_relocation':
      return {
        subject: 'Confirm your Seams wallet region change',
        heading: 'Confirm wallet region change',
        introduction: 'Enter this code to move your Seams wallet to another region.',
        caution: 'Continue only if you requested this region change.',
      };
    case 'device_link':
      return {
        subject: 'Confirm your Seams device link',
        heading: 'Confirm device linking',
        introduction: 'Enter this code on the device you are linking to your Seams wallet.',
        caution: 'Continue only if you started linking this device.',
      };
    default:
      return assertNever(operation);
  }
}

function parseEmailOtpOperation(value: unknown): WalletEmailOtpOperation {
  switch (value) {
    case 'registration':
    case 'wallet_unlock':
    case 'transaction_sign':
    case 'export_key':
    case 'device_link':
    case 'wallet_relocation':
      return value;
    default:
      throw new Error(`Unsupported Email OTP operation: ${String(value)}`);
  }
}

function expiryText(expiresAtMs: number, nowMs: number): string {
  const remainingMinutes = Math.max(1, Math.ceil((expiresAtMs - nowMs) / 60_000));
  return remainingMinutes === 1 ? 'in 1 minute' : `in ${remainingMinutes} minutes`;
}

function assertNever(value: never): never {
  throw new Error(`Unsupported Email OTP operation: ${String(value)}`);
}
