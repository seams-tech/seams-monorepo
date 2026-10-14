type PlaybackStep = {
  selector: string;
  afterConfirmation: boolean;
};

const authenticationSteps: readonly PlaybackStep[] = [
  { selector: '[data-auth-menu-primary]', afterConfirmation: false },
  { selector: '[data-authentication-reset]', afterConfirmation: false },
];

const transferSteps: readonly PlaybackStep[] = [
  { selector: 'button.confirm', afterConfirmation: false },
  { selector: '.seams-receipt-primary', afterConfirmation: true },
];

const checkoutSteps: readonly PlaybackStep[] = [
  { selector: '.checkout-buy', afterConfirmation: false },
  { selector: '.checkout-confirm', afterConfirmation: false },
  { selector: 'button.confirm', afterConfirmation: false },
  { selector: '.seams-receipt-dismiss', afterConfirmation: true },
];

type CursorVisit = {
  button: HTMLButtonElement;
  cursor: HTMLSpanElement;
  animation: Animation;
  position: string;
  overflow: string;
};

// Canvas-only playback operates the same buttons as a visitor. The standalone
// examples and the SDK's transaction lifecycle remain independent of it.
export class EmbeddedPlayback {
  private readonly steps: readonly PlaybackStep[];
  private readonly documents = new Set<Document>();
  private readonly motion = matchMedia(
    '(hover: hover) and (pointer: fine) and (prefers-reduced-motion: no-preference)',
  );
  private step = 0;
  private visit: CursorVisit | null = null;
  private timer = 0;
  private stopped = false;

  constructor(
    private readonly frame: HTMLIFrameElement,
    kind: 'create' | 'transaction-modal' | 'prediction-market',
  ) {
    switch (kind) {
      case 'create':
        this.steps = authenticationSteps;
        break;
      case 'transaction-modal':
        this.steps = transferSteps;
        break;
      case 'prediction-market':
        this.steps = checkoutSteps;
        break;
    }
    this.timer = window.setInterval(this.tick, 100);
  }

  dispose = (): void => {
    window.clearInterval(this.timer);
    this.clearVisit();
    for (const document of this.documents) {
      document.removeEventListener('pointerdown', this.takeOver, true);
      document.removeEventListener('keydown', this.takeOver, true);
    }
    this.documents.clear();
  };

  private takeOver = (event: Event): void => {
    if (!event.isTrusted) return;
    this.stopped = true;
    this.clearVisit();
  };

  private collectDocuments(frame: HTMLIFrameElement): Document[] {
    const document = frame.contentDocument;
    if (!document) return [];
    if (!this.documents.has(document)) {
      this.documents.add(document);
      document.addEventListener('pointerdown', this.takeOver, true);
      document.addEventListener('keydown', this.takeOver, true);
    }
    const result = [document];
    for (const child of document.querySelectorAll('iframe')) {
      result.push(...this.collectDocuments(child));
    }
    return result;
  }

  private tick = (): void => {
    if (this.stopped) return;
    const documents = this.collectDocuments(this.frame);
    for (const previous of this.documents) {
      if (documents.includes(previous)) continue;
      previous.removeEventListener('pointerdown', this.takeOver, true);
      previous.removeEventListener('keydown', this.takeOver, true);
      this.documents.delete(previous);
    }
    const section = this.frame.closest('.component-showcase');
    const viewport = section?.querySelector<HTMLElement>('.component-showcase__viewport');
    const playing =
      this.motion.matches &&
      !document.hidden &&
      viewport?.dataset.inView === 'true' &&
      section?.getAttribute('data-motion') !== 'keyboard' &&
      !this.frame.matches(':hover');
    if (!playing) {
      this.visit?.animation.pause();
      if (this.visit) this.visit.cursor.hidden = true;
      return;
    }
    if (this.visit) {
      const { button, animation, cursor } = this.visit;
      if (!button.isConnected) {
        this.clearVisit();
        return;
      }
      cursor.hidden = false;
      if (animation.playState === 'paused') animation.play();
      if (animation.playState === 'finished') {
        this.clearVisit();
        this.step = (this.step + 1) % this.steps.length;
        button.click();
      }
      return;
    }
    const step = this.steps[this.step];
    for (const document of documents) {
      if (
        step.afterConfirmation &&
        !document.querySelector('[role="status"]')?.textContent?.includes('Transaction complete')
      )
        continue;
      const button = document.querySelector<HTMLButtonElement>(step.selector);
      if (!button || button.disabled || button.getBoundingClientRect().width === 0) continue;
      this.visit = createCursorVisit(button);
      break;
    }
  };

  private clearVisit(): void {
    if (!this.visit) return;
    const { animation, cursor, button, position, overflow } = this.visit;
    animation.cancel();
    cursor.remove();
    button.style.position = position;
    button.style.overflow = overflow;
    this.visit = null;
  }
}

function createCursorVisit(button: HTMLButtonElement): CursorVisit {
  const cursor = button.ownerDocument.createElement('span');
  cursor.setAttribute('aria-hidden', 'true');
  cursor.dataset.playbackCursor = '';
  cursor.style.cssText =
    'position:absolute;left:72%;top:50%;width:28px;height:28px;z-index:10;pointer-events:none;color:#171717;filter:drop-shadow(0 2px 2px #0003);';
  cursor.innerHTML =
    '<svg viewBox="0 0 24 24" width="28" height="28" fill="currentColor" stroke="white" stroke-width="1.5" stroke-linejoin="round"><path d="m3 3 7 18 3-8 8-3Z"/></svg>';
  const position = button.style.position;
  const overflow = button.style.overflow;
  button.style.position = 'relative';
  button.style.overflow = 'visible';
  button.append(cursor);
  const animation = cursor.animate(
    [
      { transform: 'translate(48px, 52px)', opacity: 0, offset: 0 },
      { transform: 'translate(48px, 52px)', opacity: 0, offset: 0.25 },
      { opacity: 1, offset: 0.35 },
      { transform: 'translate(0, 0) scale(1)', opacity: 1, offset: 0.85 },
      { transform: 'translate(0, 0) scale(.88)', opacity: 1, offset: 0.95 },
      { transform: 'translate(0, 0) scale(1)', opacity: 1, offset: 1 },
    ],
    { duration: 3200, easing: 'cubic-bezier(.23, 1, .32, 1)', fill: 'both' },
  );
  return { button, cursor, animation, position, overflow };
}
