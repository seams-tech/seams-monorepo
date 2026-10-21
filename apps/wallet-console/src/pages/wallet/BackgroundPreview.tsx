import { t } from '@/marketing/i18n/browser';
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
          <h3>{t('welcomeBack')}</h3>
          <p className="showcase-preview__subtitle">{t('walletReady')}</p>
          <div className="showcase-preview__profile">
            <span className="showcase-preview__avatar">AC</span>
            <span>
              <strong>Alex Chen</strong>
              <small>alex@example.com</small>
            </span>
          </div>
          <div className="showcase-preview__primary">
            <Fingerprint />
            {t('unlockPasskey')}
          </div>
        </>
      );
    case 'recovery':
      return (
        <>
          <div className="showcase-preview__icon">
            <KeyRound />
          </div>
          <h3>{t('recoverWallet')}</h3>
          <p className="showcase-preview__subtitle">{t('sameWallet')}</p>
          <div className="showcase-background__code">XXXX − XXXX − XXXX</div>
          <div className="showcase-preview__primary">{t('continue')}</div>
        </>
      );
    case 'payment':
      return (
        <>
          <div className="showcase-preview__icon">
            <BookOpen />
          </div>
          <h3>The Field Notes</h3>
          <p className="showcase-preview__subtitle">{t('order')}</p>
          <div className="showcase-background__amount">$24.00</div>
          <dl className="showcase-background__details">
            <div>
              <dt>{t('payWith')}</dt>
              <dd>USDC on Base</dd>
            </div>
            <div>
              <dt>{t('networkFee')}</dt>
              <dd>{t('included')}</dd>
            </div>
          </dl>
          <div className="showcase-preview__primary">{t('payAmount')}</div>
        </>
      );
    case 'receipt':
      return (
        <>
          <div className="showcase-preview__icon">
            <Check />
          </div>
          <h3>{t('transferConfirmed')}</h3>
          <p className="showcase-preview__subtitle">{t('transferArrived')}</p>
          <div className="showcase-background__amount">
            125.00 <small>USDC</small>
          </div>
          <dl className="showcase-background__details">
            <div>
              <dt>{t('to')}</dt>
              <dd>Studio North</dd>
            </div>
            <div>
              <dt>{t('network')}</dt>
              <dd>Base</dd>
            </div>
            <div>
              <dt>{t('status')}</dt>
              <dd>{t('confirmed')}</dd>
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
        shop.example.com
      </div>
      <div className="showcase-preview__content">{backgroundContent(kind)}</div>
      <div className="showcase-preview__footer">
        <Layers2 />
        {t('poweredBy')}
      </div>
    </div>
  );
}
