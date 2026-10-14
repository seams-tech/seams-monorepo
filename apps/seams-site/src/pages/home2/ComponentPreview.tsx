import React from 'react';
import {
  ArrowRight,
  ArrowUpRight,
  Asterisk,
  BookOpen,
  Check,
  ChevronRight,
  Fingerprint,
  KeyRound,
  Laptop,
  Layers2,
  LockKeyhole,
  Plus,
  QrCode,
  ShieldCheck,
  Smartphone,
  Wallet,
} from 'lucide-react';
import type { PreviewId } from './ComponentShowcase';

type PreviewProps = { id: PreviewId; active: boolean };

type PreviewAction =
  | 'create'
  | 'google'
  | 'unlock'
  | 'link'
  | 'recover'
  | 'confirm'
  | 'contract'
  | 'pay'
  | 'cancel'
  | 'security'
  | 'reset';

function previewAction(
  setFeedback: React.Dispatch<React.SetStateAction<string | null>>,
  event: React.MouseEvent<HTMLElement>,
): void {
  if (!(event.target instanceof Element)) return;
  const action = event.target.closest<HTMLButtonElement>('button[data-preview-action]');
  if (!action) return;
  switch (action.dataset.previewAction) {
    case 'create':
      setFeedback('Wallet created. This preview did not create a real wallet or passkey.');
      break;
    case 'google':
      setFeedback(
        'Google sign-in starts here in the product. This preview does not connect an account.',
      );
      break;
    case 'unlock':
      setFeedback('Wallet unlocked. This preview did not access your real wallet.');
      break;
    case 'link':
      setFeedback('Device linked. This preview did not connect a real device.');
      break;
    case 'recover':
      setFeedback('Access restored. This preview did not use a real recovery code.');
      break;
    case 'confirm':
      setFeedback('Transfer confirmed: 125.00 USDC to Studio North. No funds were sent.');
      break;
    case 'contract':
      setFeedback('Contract call confirmed. No transaction was signed or sent.');
      break;
    case 'pay':
      setFeedback('Payment complete: $24.00 to Studio North. No payment was made.');
      break;
    case 'cancel':
      setFeedback('Transfer canceled. No funds were sent.');
      break;
    case 'security':
      setFeedback(
        'Recovery is ready for this sample account. No real recovery code appears in this preview.',
      );
      break;
    case 'reset':
      setFeedback(null);
      requestAnimationFrame(focusPreviewAction.bind(null, event.currentTarget));
      break;
  }
}

function focusPreviewAction(preview: HTMLElement): void {
  if (!preview.isConnected) return;
  preview.querySelector<HTMLButtonElement>('button[data-preview-action]')?.focus();
}

function PrimaryAction({
  action,
  children,
}: {
  action: PreviewAction;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <button
      className="showcase-preview__primary"
      type="button"
      data-preview-action={action}
      autoFocus={action === 'reset'}
    >
      {children}
      <ArrowRight aria-hidden />
    </button>
  );
}

function Profile(): React.JSX.Element {
  return (
    <div className="showcase-preview__profile">
      <span className="showcase-preview__avatar">AC</span>
      <span>
        <strong>Alex Chen</strong>
        <small>alex@example.com</small>
      </span>
      <span className="showcase-preview__connected" />
    </div>
  );
}

function Devices(): React.JSX.Element {
  return (
    <>
      <div className="showcase-preview__device">
        <Laptop aria-hidden />
        <span>
          <strong>MacBook Pro</strong>
          <small>Passkey · This device</small>
        </span>
        <span className="showcase-preview__badge">Active</span>
      </div>
      <div className="showcase-preview__device">
        <Smartphone aria-hidden />
        <span>
          <strong>iPhone</strong>
          <small>Passkey · Last used today</small>
        </span>
      </div>
      <button className="showcase-preview__secondary" type="button" data-preview-action="link">
        <Plus aria-hidden />
        Link another device
      </button>
    </>
  );
}

function RecoveryOption(): React.JSX.Element {
  return (
    <button className="showcase-preview__option" type="button" data-preview-action="security">
      <span className="showcase-preview__option-icon">
        <ShieldCheck aria-hidden />
      </span>
      <span>
        <strong>Recovery code</strong>
        <small>Keep a copy somewhere safe</small>
      </span>
      <span className="showcase-preview__badge">Saved</span>
    </button>
  );
}

function TransferDetails(): React.JSX.Element {
  return (
    <dl className="showcase-preview__details">
      <div>
        <dt>From</dt>
        <dd>
          My wallet<small>0x4201…891c</small>
        </dd>
      </div>
      <div>
        <dt>To</dt>
        <dd>
          Studio North<small>0x2F01…4EC9</small>
        </dd>
      </div>
      <div>
        <dt>Network fee</dt>
        <dd>&lt; $0.01</dd>
      </div>
    </dl>
  );
}

function PaymentMethods(): React.JSX.Element {
  return (
    <label className="showcase-preview__field">
      Pay with
      <select defaultValue="base">
        <option value="base">USDC on Base</option>
        <option value="ethereum">USDC on Ethereum</option>
      </select>
    </label>
  );
}

function previewContent(id: PreviewId): React.JSX.Element {
  switch (id) {
    case 'create':
      return (
        <>
          <div className="showcase-preview__icon">
            <Layers2 aria-hidden />
          </div>
          <h3>Create your wallet</h3>
          <p className="showcase-preview__subtitle">Your keys. Your next chapter.</p>
          <PrimaryAction action="create">
            <Fingerprint aria-hidden />
            Create with passkey
          </PrimaryAction>
          <button
            className="showcase-preview__secondary"
            type="button"
            data-preview-action="google"
          >
            <span className="showcase-preview__google">G</span>Continue with Google
          </button>
          <div className="showcase-preview__divider">More ways to connect</div>
          <button className="showcase-preview__option" type="button" data-preview-action="link">
            <span className="showcase-preview__option-icon">
              <QrCode aria-hidden />
            </span>
            <span>
              <strong>Link a device</strong>
              <small>Bring your wallet with you</small>
            </span>
            <ChevronRight aria-hidden />
          </button>
          <button className="showcase-preview__option" type="button" data-preview-action="recover">
            <span className="showcase-preview__option-icon">
              <KeyRound aria-hidden />
            </span>
            <span>
              <strong>Recover wallet</strong>
              <small>Use your recovery code</small>
            </span>
            <ChevronRight aria-hidden />
          </button>
        </>
      );
    case 'unlock':
      return (
        <>
          <div className="showcase-preview__icon">
            <Fingerprint aria-hidden />
          </div>
          <h3>Welcome back</h3>
          <p className="showcase-preview__subtitle">Your wallet is ready.</p>
          <Profile />
          <PrimaryAction action="unlock">
            <Fingerprint aria-hidden />
            Unlock with passkey
          </PrimaryAction>
          <button
            className="showcase-preview__secondary"
            type="button"
            data-preview-action="google"
          >
            <span className="showcase-preview__google">G</span>Continue with Google
          </button>
        </>
      );
    case 'recovery':
      return (
        <>
          <div className="showcase-preview__icon">
            <KeyRound aria-hidden />
          </div>
          <h3>Recover your wallet</h3>
          <p className="showcase-preview__subtitle">A fresh start, with the same wallet.</p>
          <div className="showcase-preview__notice">
            <ShieldCheck aria-hidden />
            <p>Your recovery code restores access on a new device.</p>
          </div>
          <label className="showcase-preview__field">
            Sample recovery code
            <input value="DEMO − DEMO − DEMO" readOnly />
          </label>
          <PrimaryAction action="recover">
            <KeyRound aria-hidden />
            Preview recovery
          </PrimaryAction>
        </>
      );
    case 'transfer':
      return (
        <>
          <div className="showcase-preview__title-row">
            <div className="showcase-preview__icon">
              <ArrowUpRight aria-hidden />
            </div>
            <span className="showcase-preview__chain">Base</span>
          </div>
          <h3>Review your transfer</h3>
          <p className="showcase-preview__subtitle">A clear view before you sign.</p>
          <div className="showcase-preview__amount">
            125.00 <span>USDC</span>
          </div>
          <small>$125.00 USD</small>
          <TransferDetails />
          <PrimaryAction action="confirm">
            <Fingerprint aria-hidden />
            Confirm with passkey
          </PrimaryAction>
          <button className="showcase-preview__quiet" type="button" data-preview-action="cancel">
            Cancel transfer
          </button>
        </>
      );
    case 'contract':
      return (
        <>
          <div className="showcase-preview__icon">
            <Layers2 aria-hidden />
          </div>
          <h3>Review contract call</h3>
          <p className="showcase-preview__subtitle">See what your approval will do.</p>
          <div className="showcase-preview__code">
            <span>USDC · Base</span>
            <strong>transfer()</strong>
            <dl>
              <div>
                <dt>Recipient</dt>
                <dd>0x2F01…4EC9</dd>
              </div>
              <div>
                <dt>Amount</dt>
                <dd>125.00 USDC</dd>
              </div>
            </dl>
          </div>
          <dl className="showcase-preview__details">
            <div>
              <dt>Network fee</dt>
              <dd>&lt; $0.01</dd>
            </div>
          </dl>
          <PrimaryAction action="contract">
            <Fingerprint aria-hidden />
            Approve contract call
          </PrimaryAction>
          <a className="showcase-preview__demo-link" href="/transaction-mocks/">
            Explore transaction components <ArrowUpRight aria-hidden />
          </a>
        </>
      );
    case 'receipt':
      return (
        <>
          <div className="showcase-preview__icon">
            <Check aria-hidden />
          </div>
          <h3>Transfer confirmed</h3>
          <p className="showcase-preview__subtitle">Your sample transfer is complete.</p>
          <div className="showcase-preview__amount">
            125.00 <span>USDC</span>
          </div>
          <TransferDetails />
          <div className="showcase-preview__notice">
            <ShieldCheck aria-hidden />
            <p>Demo receipt. No funds were sent.</p>
          </div>
        </>
      );
    case 'payment':
      return (
        <>
          <div className="showcase-preview__merchant">
            <span className="showcase-preview__option-icon">
              <Asterisk aria-hidden />
            </span>
            <span>
              Studio North<small>Order #1042</small>
            </span>
            <ShieldCheck aria-hidden />
          </div>
          <h3>Make it yours.</h3>
          <p className="showcase-preview__subtitle">One payment. Ready when you are.</p>
          <div className="showcase-preview__order">
            <span className="showcase-preview__product">
              <BookOpen aria-hidden />
            </span>
            <span>
              <strong>The Field Notes</strong>
              <small>Digital collection · Vol. 01</small>
            </span>
            <strong>$24</strong>
          </div>
          <dl className="showcase-preview__details">
            <div>
              <dt>Subtotal</dt>
              <dd>$24.00</dd>
            </div>
            <div>
              <dt>Network fee</dt>
              <dd>Included</dd>
            </div>
            <div>
              <dt>Total</dt>
              <dd>$24.00</dd>
            </div>
          </dl>
          <PaymentMethods />
          <PrimaryAction action="pay">
            <Wallet aria-hidden />
            Pay $24.00
          </PrimaryAction>
        </>
      );
    case 'methods':
      return (
        <>
          <div className="showcase-preview__icon">
            <Wallet aria-hidden />
          </div>
          <h3>Choose how to pay</h3>
          <p className="showcase-preview__subtitle">Your wallet, your preferred network.</p>
          <Profile />
          <PaymentMethods />
          <dl className="showcase-preview__details">
            <div>
              <dt>Order</dt>
              <dd>#1042 · Studio North</dd>
            </div>
            <div>
              <dt>Total</dt>
              <dd>$24.00</dd>
            </div>
          </dl>
          <PrimaryAction action="pay">
            <Wallet aria-hidden />
            Preview payment
          </PrimaryAction>
        </>
      );
    case 'paid':
      return (
        <>
          <div className="showcase-preview__icon">
            <Check aria-hidden />
          </div>
          <h3>Payment complete</h3>
          <p className="showcase-preview__subtitle">Thanks for supporting Studio North.</p>
          <div className="showcase-preview__amount">$24.00</div>
          <dl className="showcase-preview__details">
            <div>
              <dt>Order</dt>
              <dd>#1042</dd>
            </div>
            <div>
              <dt>Payment</dt>
              <dd>USDC on Base</dd>
            </div>
            <div>
              <dt>Status</dt>
              <dd>Confirmed</dd>
            </div>
          </dl>
          <div className="showcase-preview__notice">
            <ShieldCheck aria-hidden />
            <p>Demo receipt. No payment was made.</p>
          </div>
        </>
      );
    case 'profile':
      return (
        <>
          <Profile />
          <h3>At home, everywhere.</h3>
          <p className="showcase-preview__subtitle">One wallet across your devices.</p>
          <p className="showcase-preview__section-label">Connected devices</p>
          <Devices />
          <p className="showcase-preview__section-label">Security</p>
          <RecoveryOption />
        </>
      );
    case 'devices':
      return (
        <>
          <div className="showcase-preview__icon">
            <Laptop aria-hidden />
          </div>
          <h3>Your connected devices</h3>
          <p className="showcase-preview__subtitle">Access that moves with you.</p>
          <Devices />
          <div className="showcase-preview__notice">
            <QrCode aria-hidden />
            <p>Scan with a connected device to bring your wallet to a new one.</p>
          </div>
        </>
      );
    case 'security':
      return (
        <>
          <div className="showcase-preview__icon">
            <ShieldCheck aria-hidden />
          </div>
          <h3>Keep your wallet yours</h3>
          <p className="showcase-preview__subtitle">Simple controls for everyday confidence.</p>
          <div className="showcase-preview__device">
            <Fingerprint aria-hidden />
            <span>
              <strong>Passkey</strong>
              <small>Protected by your device</small>
            </span>
            <span className="showcase-preview__badge">Enabled</span>
          </div>
          <RecoveryOption />
          <div className="showcase-preview__notice">
            <LockKeyhole aria-hidden />
            <p>Use your recovery code if you lose access to your devices.</p>
          </div>
        </>
      );
    default:
      return assertNever(id);
  }
}

function assertNever(value: never): never {
  throw new Error(`Unknown component preview: ${String(value)}`);
}

export function ComponentPreview({ id, active }: PreviewProps): React.JSX.Element {
  const [feedback, setFeedback] = React.useState<string | null>(null);
  return (
    <article
      className="showcase-preview"
      data-preview={id}
      onClick={previewAction.bind(null, setFeedback)}
    >
      <div className="showcase-preview__origin">
        <LockKeyhole aria-hidden />
        shop.example.com<span>Demo</span>
      </div>
      <div className="showcase-preview__content">
        {feedback === null ? (
          previewContent(id)
        ) : (
          <>
            <div className="showcase-preview__icon">
              <Check aria-hidden />
            </div>
            <h3>Preview complete</h3>
            <p className="showcase-preview__feedback" role={active ? 'status' : undefined}>
              {feedback}
            </p>
            <PrimaryAction action="reset">Back to preview</PrimaryAction>
          </>
        )}
      </div>
      <div className="showcase-preview__footer">
        <Layers2 aria-hidden />
        Powered by seams<span>Simulated preview</span>
      </div>
    </article>
  );
}
