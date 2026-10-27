import type { TransactionReceiptView } from '@wallet-ui/core/signingEngine/uiConfirm/ui/transaction-receipt';

const DURATION_MS = 240;
const EASING = 'cubic-bezier(0.32, 0.72, 0, 1)';

interface ReceiptSnapshot {
  content: HTMLElement;
  bounds: DOMRect;
  radius: number;
  anchors: Map<string, ReceiptAnchor>;
}

interface ReceiptAnchor {
  content: HTMLElement;
  bounds: DOMRect;
  inkBounds: DOMRect;
}

interface ReceiptTransition {
  destination: TransactionReceiptView;
  overlay: HTMLElement;
  animations: Animation[];
}

const transitions = new WeakMap<HTMLElement, ReceiptTransition>();

function snapshot(card: HTMLElement): ReceiptSnapshot {
  const bounds = card.getBoundingClientRect();
  const styles = getComputedStyle(card);
  const content = card.cloneNode(true);
  if (!(content instanceof HTMLElement)) throw new Error('Receipt card must be an HTML element');
  content.classList.add('showcase-receipt-content');
  content.removeAttribute('id');
  for (const element of content.querySelectorAll('[id]')) element.removeAttribute('id');
  for (const cursor of content.querySelectorAll('[data-playback-cursor]')) cursor.remove();
  Object.assign(content.style, {
    left: `${bounds.left}px`,
    top: `${bounds.top}px`,
    width: `${bounds.width}px`,
    height: `${bounds.height}px`,
  });
  const anchors = new Map<string, ReceiptAnchor>();
  for (const selector of ['[role="status"]', '.seams-receipt-symbol']) {
    const original = card.querySelector<HTMLElement>(selector);
    const copy = content.querySelector<HTMLElement>(selector);
    if (!original || !copy) continue;
    const anchor = copy.cloneNode(true);
    if (!(anchor instanceof HTMLElement)) continue;
    const anchorBounds = original.getBoundingClientRect();
    const textRange = original.ownerDocument.createRange();
    textRange.selectNodeContents(original);
    const anchorStyles = getComputedStyle(original);
    anchor.classList.add('showcase-receipt-anchor');
    Object.assign(anchor.style, {
      left: `${anchorBounds.left}px`,
      top: `${anchorBounds.top}px`,
      width: `${anchorBounds.width}px`,
      height: `${anchorBounds.height}px`,
      fontFamily: anchorStyles.fontFamily,
      fontSize: anchorStyles.fontSize,
      fontWeight: anchorStyles.fontWeight,
      fontStyle: anchorStyles.fontStyle,
      lineHeight: anchorStyles.lineHeight,
      letterSpacing: anchorStyles.letterSpacing,
      color: anchorStyles.color,
    });
    anchors.set(selector, {
      content: anchor,
      bounds: anchorBounds,
      inkBounds: selector === '[role="status"]' ? textRange.getBoundingClientRect() : anchorBounds,
    });
    copy.style.visibility = 'hidden';
  }
  return { content, bounds, radius: parseFloat(styles.borderTopLeftRadius) || 0, anchors };
}

function animateAnchors(
  source: ReceiptSnapshot,
  target: ReceiptSnapshot,
  contents: HTMLElement,
): Animation[] {
  const animations: Animation[] = [];
  const motion = { duration: DURATION_MS, easing: EASING, fill: 'both' } as const;
  for (const [selector, from] of source.anchors) {
    const to = target.anchors.get(selector);
    if (!to) continue;
    contents.append(to.content);
    const scaleX = from.inkBounds.width / to.inkBounds.width;
    const scaleY = from.inkBounds.height / to.inkBounds.height;
    const x = from.inkBounds.left - to.bounds.left - (to.inkBounds.left - to.bounds.left) * scaleX;
    const y = from.inkBounds.top - to.bounds.top - (to.inkBounds.top - to.bounds.top) * scaleY;
    animations.push(
      to.content.animate(
        [
          { transform: `translate(${x}px, ${y}px) scale(${scaleX}, ${scaleY})` },
          { transform: 'translate(0, 0) scale(1)' },
        ],
        motion,
      ),
    );
  }
  return animations;
}

function clip(snapshot: ReceiptSnapshot, inset: number, viewport: DOMRect): string {
  const { bounds, radius } = snapshot;
  return `inset(${bounds.top + inset}px ${viewport.width - bounds.right + inset}px ${viewport.height - bounds.bottom + inset}px ${bounds.left + inset}px round ${Math.max(0, radius - inset)}px)`;
}

function layer(document: Document, className: string): HTMLDivElement {
  const element = document.createElement('div');
  element.className = className;
  return element;
}

function animateClip(
  element: HTMLElement,
  source: ReceiptSnapshot,
  target: ReceiptSnapshot,
  viewport: DOMRect,
  inset: number,
): Animation {
  return element.animate(
    [{ clipPath: clip(source, inset, viewport) }, { clipPath: clip(target, inset, viewport) }],
    { duration: DURATION_MS, easing: EASING, fill: 'both' },
  );
}

function removeTransition(surface: HTMLElement, transition: ReceiptTransition): void {
  if (transitions.get(surface) !== transition) return;
  transitions.delete(surface);
  surface.removeAttribute('data-showcase-receipt-transition');
  transition.overlay.remove();
  for (const animation of transition.animations) animation.cancel();
}

function finishTransition(surface: HTMLElement, transition: ReceiptTransition): void {
  for (const animation of transition.animations) {
    if (animation.playState !== 'finished') return;
  }
  removeTransition(surface, transition);
}

function animationFinished(animation: Animation): Promise<Animation> {
  return animation.finished;
}

function watchTransition(surface: HTMLElement, transition: ReceiptTransition): void {
  void Promise.all(transition.animations.map(animationFinished)).then(
    finishTransition.bind(null, surface, transition),
    removeTransition.bind(null, surface, transition),
  );
}

/** Settle only the SDK animations created by this render, preserving cursor and progress motion. */
function renderReceipt(surface: HTMLElement, render: () => void): void {
  const previous = new Set(surface.getAnimations({ subtree: true }));
  render();
  for (const animation of surface.getAnimations({ subtree: true })) {
    if (previous.has(animation)) continue;
    if (animation instanceof CSSAnimation || animation instanceof CSSTransition) continue;
    animation.finish();
  }
}

/** The live receipt remains interactive while inert snapshots carry its visual transition. */
export function transitionReceiptView(
  surface: HTMLElement,
  destination: TransactionReceiptView,
  render: () => void,
): void {
  const active = transitions.get(surface);
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) {
    if (active) removeTransition(surface, active);
    renderReceipt(surface, render);
    return;
  }
  if (active) {
    renderReceipt(surface, render);
    if (active.destination !== destination) {
      active.destination = destination;
      for (const animation of active.animations) animation.reverse();
      watchTransition(surface, active);
    }
    return;
  }

  const card = surface.querySelector<HTMLElement>('.modal-container-root');
  if (!card) {
    render();
    return;
  }
  const source = snapshot(card);
  renderReceipt(surface, render);
  const nextCard = surface.querySelector<HTMLElement>('.modal-container-root');
  if (!nextCard) return;
  const target = snapshot(nextCard);
  const document = surface.ownerDocument;
  const viewport = new DOMRect(0, 0, document.documentElement.clientWidth, window.innerHeight);
  const overlay = layer(document, 'seams-confirmation-modal showcase-receipt-overlay');
  overlay.setAttribute('aria-hidden', 'true');
  overlay.inert = true;
  const shape = layer(document, 'showcase-receipt-shape');
  const border = layer(document, 'showcase-receipt-border');
  const background = layer(document, 'showcase-receipt-background');
  const contents = layer(document, 'showcase-receipt-contents');
  shape.append(border, background);
  contents.append(source.content, target.content);
  overlay.append(shape, contents);
  surface.append(overlay);
  surface.setAttribute('data-showcase-receipt-transition', '');

  const dx = target.bounds.left - source.bounds.left;
  const dy = target.bounds.top - source.bounds.top;
  const motion = { duration: DURATION_MS, easing: EASING, fill: 'both' } as const;
  const fade = { duration: DURATION_MS, fill: 'both' } as const;
  const animations = [
    animateClip(border, source, target, viewport, 0),
    animateClip(background, source, target, viewport, 1),
    animateClip(contents, source, target, viewport, 1),
    source.content.animate(
      [{ transform: 'translate(0, 0)' }, { transform: `translate(${dx}px, ${dy}px)` }],
      motion,
    ),
    target.content.animate(
      [{ transform: `translate(${-dx}px, ${-dy}px)` }, { transform: 'translate(0, 0)' }],
      motion,
    ),
    source.content.animate(
      [
        { opacity: 1, offset: 0 },
        { opacity: 0, offset: 0.5 },
        { opacity: 0, offset: 1 },
      ],
      fade,
    ),
    target.content.animate(
      [
        { opacity: 0, offset: 0 },
        { opacity: 0, offset: 0.5 },
        { opacity: 1, offset: 1 },
      ],
      fade,
    ),
    ...animateAnchors(source, target, contents),
  ];
  const startTime = document.timeline.currentTime;
  if (startTime !== null) {
    for (const animation of animations) animation.startTime = startTime;
  }
  const transition = { destination, overlay, animations };
  transitions.set(surface, transition);
  watchTransition(surface, transition);
}
