import { locale, t } from '@/marketing/i18n/browser';
import React from 'react';
import { Layers2, LockKeyhole } from 'lucide-react';
import type { PreviewId } from './ComponentShowcase';
import { EmbeddedPlayback } from './embeddedPlayback';
import type { ModalBackdrop } from '@/showcase/modalBackdrop';
import { useDemoTheme } from '@/context/demoTheme';

type PreviewProps = {
  id: PreviewId;
  active: boolean;
  backdrop?: ModalBackdrop;
  onComplete: () => void;
  onInteract: () => void;
};

function embeddedRoute(id: PreviewId): string {
  switch (id) {
    case 'profile':
      return 'account';
    case 'create':
      return 'authentication';
    case 'transaction-modal':
      return 'transaction';
    case 'prediction-market':
      return 'checkout';
    case 'voiceid':
      return 'voiceid';
  }
}

function embeddedTitle(id: PreviewId): string {
  switch (id) {
    case 'profile':
      return t('recoverLink');
    case 'create':
      return t('authentication');
    case 'transaction-modal':
      return t('transactionModal');
    case 'prediction-market':
      return t('predictionMarket');
    case 'voiceid':
      return t('voiceId');
  }
}

function startEmbeddedPlayback(
  frame: React.RefObject<HTMLIFrameElement | null>,
  kind: PreviewId,
  onComplete: () => void,
  onInteract: () => void,
): (() => void) | undefined {
  if (!frame.current) return;
  const playback = new EmbeddedPlayback(frame.current, kind, onComplete, onInteract);
  return playback.dispose;
}

function EmbeddedPreview({
  kind,
  onComplete,
  onInteract,
  ...props
}: React.IframeHTMLAttributes<HTMLIFrameElement> & {
  kind: PreviewId;
  onComplete: () => void;
  onInteract: () => void;
}): React.JSX.Element {
  const frame = React.useRef<HTMLIFrameElement>(null);
  React.useEffect(startEmbeddedPlayback.bind(null, frame, kind, onComplete, onInteract), [
    kind,
    onComplete,
    onInteract,
  ]);

  return <iframe {...props} ref={frame} />;
}

export function ComponentPreview({
  id,
  active,
  backdrop = 'dimmed',
  onComplete,
  onInteract,
}: PreviewProps): React.JSX.Element {
  const { theme } = useDemoTheme();
  if (active) {
    const route = embeddedRoute(id);
    const title = embeddedTitle(id);
    return (
      <EmbeddedPreview
        kind={id}
        onComplete={onComplete}
        onInteract={onInteract}
        className="showcase-preview__embed"
        data-preview={id}
        title={title}
        src={`${import.meta.env.BASE_URL}showcase/${route}/?lang=${locale}&backdrop=${backdrop}&theme=${theme}`}
      />
    );
  }
  return (
    <article className="showcase-preview" data-preview={id}>
      <div className="showcase-preview__origin">
        <LockKeyhole aria-hidden />
        shop.example.com
      </div>
      <div className="showcase-preview__content">
        <div className="showcase-preview__icon">
          <Layers2 aria-hidden />
        </div>
        <h3>{embeddedTitle(id)}</h3>
      </div>
      <div className="showcase-preview__footer">
        <Layers2 aria-hidden />
        {t('poweredBy')}
      </div>
    </article>
  );
}
