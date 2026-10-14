import { BookOpen, Check, Fingerprint, KeyRound, Layers2, LockKeyhole } from 'lucide-react';

export type BackgroundPreviewKind = 'unlock' | 'recovery' | 'payment' | 'receipt';

function backgroundContent(kind: BackgroundPreviewKind): React.JSX.Element {
  switch (kind) {
    case 'unlock':
      return (
        <>
          <div className="showcase-preview__icon">
            <Fingerprint />
          </div>
          <h3>Welcome back</h3>
          <p className="showcase-preview__subtitle">Your wallet is ready.</p>
          <div className="showcase-preview__profile">
            <span className="showcase-preview__avatar">AC</span>
            <span>
              <strong>Alex Chen</strong>
              <small>alex@example.com</small>
            </span>
          </div>
          <div className="showcase-preview__primary">
            <Fingerprint />
            Unlock with passkey
          </div>
        </>
      );
    case 'recovery':
      return (
        <>
          <div className="showcase-preview__icon">
            <KeyRound />
          </div>
          <h3>Recover your wallet</h3>
          <p className="showcase-preview__subtitle">A fresh start, with the same wallet.</p>
          <div className="showcase-background__code">XXXX − XXXX − XXXX</div>
          <div className="showcase-preview__primary">Continue</div>
        </>
      );
    case 'payment':
      return (
        <>
          <div className="showcase-preview__icon">
            <BookOpen />
          </div>
          <h3>The Field Notes</h3>
          <p className="showcase-preview__subtitle">Studio North · Order #1042</p>
          <div className="showcase-background__amount">$24.00</div>
          <dl className="showcase-background__details">
            <div>
              <dt>Pay with</dt>
              <dd>USDC on Base</dd>
            </div>
            <div>
              <dt>Network fee</dt>
              <dd>Included</dd>
            </div>
          </dl>
          <div className="showcase-preview__primary">Pay $24.00</div>
        </>
      );
    case 'receipt':
      return (
        <>
          <div className="showcase-preview__icon">
            <Check />
          </div>
          <h3>Transfer confirmed</h3>
          <p className="showcase-preview__subtitle">Your transfer reached its destination.</p>
          <div className="showcase-background__amount">
            125.00 <small>USDC</small>
          </div>
          <dl className="showcase-background__details">
            <div>
              <dt>To</dt>
              <dd>Studio North</dd>
            </div>
            <div>
              <dt>Network</dt>
              <dd>Base</dd>
            </div>
            <div>
              <dt>Status</dt>
              <dd>Confirmed</dd>
            </div>
          </dl>
        </>
      );
    default:
      return assertNever(kind);
  }
}

function assertNever(value: never): never {
  throw new Error(`Unknown background preview: ${String(value)}`);
}

/** Static artwork. Its containing canvas layer is hidden from assistive technology and inert. */
export function BackgroundPreview({ kind }: { kind: BackgroundPreviewKind }): React.JSX.Element {
  return (
    <div className="showcase-preview">
      <div className="showcase-preview__origin">
        <LockKeyhole />
        shop.example.com<span>Demo</span>
      </div>
      <div className="showcase-preview__content">{backgroundContent(kind)}</div>
      <div className="showcase-preview__footer">
        <Layers2 />
        Powered by seams
      </div>
    </div>
  );
}
