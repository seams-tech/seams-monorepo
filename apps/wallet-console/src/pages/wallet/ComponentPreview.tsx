import React from 'react';
import {
  ArrowRight,
  Check,
  ChevronRight,
  Fingerprint,
  KeyRound,
  Laptop,
  Layers2,
  LockKeyhole,
  MousePointer2,
  Plus,
  QrCode,
  ShieldCheck,
  Smartphone,
} from 'lucide-react';
import type { PreviewId } from './ComponentShowcase';
import type { ModalBackdrop } from '@/showcase/modalBackdrop';

type PreviewProps = { id: PreviewId; active: boolean; backdrop?: ModalBackdrop };

type PreviewAction = 'create' | 'google' | 'link' | 'recover' | 'security' | 'reset';

type PreviewResult = { title: string; message: string };

type PreviewState =
  | { kind: 'ready' }
  | { kind: 'result'; source: 'demo' | 'user'; result: PreviewResult };

function resultForAction(action: string): PreviewResult | null {
  switch (action) {
    case 'create':
      return {
        title: 'Wallet created',
        message: 'Your wallet is ready.',
      };
    case 'google':
      return {
        title: 'Continue with Google',
        message: 'Choose your Google account to continue.',
      };
    case 'link':
      return {
        title: 'Device linked',
        message: 'Your wallet is now available on this device.',
      };
    case 'recover':
      return {
        title: 'Access restored',
        message: 'Your wallet is ready on this device.',
      };
    case 'security':
      return {
        title: 'Recovery is ready',
        message: 'Keep your recovery code somewhere safe.',
      };
    default:
      return null;
  }
}

function activatePreview(
  setState: React.Dispatch<React.SetStateAction<PreviewState>>,
  source: 'demo' | 'user',
  button: HTMLButtonElement,
): void {
  const result = resultForAction(button.dataset.previewAction ?? '');
  if (result !== null) setState({ kind: 'result', source, result });
}

function previewAction(
  setState: React.Dispatch<React.SetStateAction<PreviewState>>,
  event: React.MouseEvent<HTMLElement>,
): void {
  if (!(event.target instanceof Element)) return;
  const button = event.target.closest<HTMLButtonElement>('button[data-preview-action]');
  if (button === null) return;
  if (button.dataset.previewAction === 'reset') {
    setState({ kind: 'ready' });
    requestAnimationFrame(focusPreviewAction.bind(null, event.currentTarget));
    return;
  }
  activatePreview(setState, 'user', button);
}

// Both the cursor and a real click use the same local preview action.
function advanceDemo(
  setState: React.Dispatch<React.SetStateAction<PreviewState>>,
  event: React.AnimationEvent<HTMLElement>,
): void {
  if (!(event.target instanceof Element)) return;
  if (event.animationName === 'showcase-cursor-visit') {
    const button = event.target.closest<HTMLButtonElement>('button[data-preview-action]');
    if (button !== null) activatePreview(setState, 'demo', button);
  } else if (event.animationName === 'showcase-result-replay') {
    setState({ kind: 'ready' });
  }
}

function focusPreviewAction(preview: HTMLElement): void {
  if (!preview.isConnected) return;
  preview.querySelector<HTMLButtonElement>('button[data-preview-action]')?.focus();
}

function PreviewCursor(): React.JSX.Element {
  return (
    <span className="showcase-preview__cursor" aria-hidden="true">
      <span className="showcase-preview__cursor-motion">
        <MousePointer2 />
        <span className="showcase-preview__cursor-pulse" />
      </span>
    </span>
  );
}

function PrimaryAction({
  action,
  children,
  focus = false,
}: {
  action: PreviewAction;
  children: React.ReactNode;
  focus?: boolean;
}): React.JSX.Element {
  return (
    <button
      className="showcase-preview__primary"
      type="button"
      data-preview-action={action}
      autoFocus={focus}
    >
      {children}
      <ArrowRight aria-hidden />
      {action !== 'reset' && <PreviewCursor />}
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
        <PreviewCursor />
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

function previewContent(id: PreviewId): React.JSX.Element {
  switch (id) {
    case 'transaction-modal':
      return (
        <>
          <div className="showcase-preview__icon">
            <Fingerprint aria-hidden />
          </div>
          <h3>Transaction modal</h3>
          <p className="showcase-preview__subtitle">Review, approve, and follow your transfer.</p>
        </>
      );
    case 'prediction-market':
      return (
        <>
          <div className="showcase-preview__icon">
            <Layers2 aria-hidden />
          </div>
          <h3>Prediction market</h3>
          <p className="showcase-preview__subtitle">Your custom review, then wallet approval.</p>
        </>
      );
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
    default:
      return assertNever(id);
  }
}

function assertNever(value: never): never {
  throw new Error(`Unknown component preview: ${String(value)}`);
}

export function ComponentPreview({
  id,
  active,
  backdrop = 'dimmed',
}: PreviewProps): React.JSX.Element {
  const [state, setState] = React.useState<PreviewState>({ kind: 'ready' });
  if (active && (id === 'transaction-modal' || id === 'prediction-market')) {
    const route = id === 'transaction-modal' ? 'transaction' : 'checkout';
    const title = id === 'transaction-modal' ? 'Transaction modal' : 'Prediction market';
    return (
      <iframe
        className="showcase-preview__embed"
        data-preview={id}
        title={title}
        src={`${import.meta.env.BASE_URL}showcase/${route}/?backdrop=${backdrop}`}
      />
    );
  }
  return (
    <article
      className="showcase-preview"
      data-preview={id}
      onClick={previewAction.bind(null, setState)}
      onAnimationEnd={active ? advanceDemo.bind(null, setState) : undefined}
    >
      <div className="showcase-preview__origin">
        <LockKeyhole aria-hidden />
        shop.example.com
      </div>
      <div className="showcase-preview__content">
        {state.kind === 'ready' ? (
          previewContent(id)
        ) : (
          <div className="showcase-preview__result" data-source={state.source}>
            <div className="showcase-preview__icon">
              <Check aria-hidden />
            </div>
            <h3>{state.result.title}</h3>
            <p
              className="showcase-preview__feedback"
              role={active && state.source === 'user' ? 'status' : undefined}
            >
              {state.result.message}
            </p>
            <PrimaryAction action="reset" focus={state.source === 'user'}>
              Back
            </PrimaryAction>
          </div>
        )}
      </div>
      <div className="showcase-preview__footer">
        <Layers2 aria-hidden />
        Powered by seams
      </div>
    </article>
  );
}
