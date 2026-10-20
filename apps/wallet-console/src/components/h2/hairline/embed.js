/* global HL */
const stage = document.getElementById('stage');
const read = document.getElementById('read');
// The host page plays a figure by moving a synthetic pointer along this path:
// "x,y,ms" keyframes in the 400 by 320 frame, timed from the start of the play.
const playPath = (stage.dataset.play ?? '')
  .split(' ')
  .filter(Boolean)
  .map((keyframe) => keyframe.split(',').map(Number));
let keyboardActive = false;
let mouseInside = false;
let hostPlaying = false;
let playStart = 0;
let playFrame = 0;
let replayTimer = 0;

function dispatchPointer(type, x, y) {
  const box = stage.getBoundingClientRect();
  stage.dispatchEvent(
    new PointerEvent(type, {
      pointerType: 'mouse',
      pointerId: 1,
      bubbles: true,
      clientX: box.left + (box.width * x) / 400,
      clientY: box.top + (box.height * y) / 320,
    }),
  );
}
function toggleAnimation() {
  stopPlay();
  keyboardActive = !keyboardActive;
  dispatchPointer(
    keyboardActive ? 'pointermove' : 'pointerleave',
    Number(stage.dataset.pointerX),
    Number(stage.dataset.pointerY),
  );
  stage.setAttribute('aria-pressed', String(keyboardActive));
}
function onKeyDown(event) {
  if (event.key !== 'Enter' && event.key !== ' ') return;
  event.preventDefault();
  toggleAnimation();
}
function onTouch(event) {
  if (event.pointerType === 'touch') toggleAnimation();
}
function onBlur() {
  keyboardActive = false;
  stage.dispatchEvent(new PointerEvent('pointerleave'));
  stage.setAttribute('aria-pressed', 'false');
}
function pathPoint(elapsed) {
  let previous = playPath[0];
  for (const keyframe of playPath) {
    if (elapsed <= keyframe[2]) {
      const span = keyframe[2] - previous[2];
      const progress = span > 0 ? (elapsed - previous[2]) / span : 1;
      return [
        HL.lerp(previous[0], keyframe[0], progress),
        HL.lerp(previous[1], keyframe[1], progress),
      ];
    }
    previous = keyframe;
  }
  return previous;
}
function playStep(now) {
  const elapsed = now - playStart;
  const [x, y] = pathPoint(elapsed);
  dispatchPointer('pointermove', x, y);
  playFrame = elapsed < playPath[playPath.length - 1][2] ? requestAnimationFrame(playStep) : 0;
}
function stopPlay() {
  cancelAnimationFrame(playFrame);
  clearTimeout(replayTimer);
  playFrame = 0;
}
// A visitor's own pointer, focus, or tap outranks the host's play and rest.
function visitorControls() {
  return mouseInside || keyboardActive || (document.hasFocus() && document.activeElement === stage);
}
function hostPlay() {
  stopPlay();
  if (visitorControls() || !playPath.length) return;
  playStart = performance.now();
  playFrame = requestAnimationFrame(playStep);
}
function hostRest() {
  stopPlay();
  if (!visitorControls()) dispatchPointer('pointerleave', 0, 0);
}
// Focus hands the figure to the visitor. A figure's own Enter toggles it, so
// the host's play gives way to rest first, or Enter would stop the figure.
function onFocus() {
  if (mouseInside) return;
  stopPlay();
  dispatchPointer('pointerleave', 0, 0);
}
// When the visitor lets go during the host's turn, the figure plays again from
// rest; the pause lets a rest message from the host land first.
function resumeHostPlay() {
  clearTimeout(replayTimer);
  if (hostPlaying) replayTimer = window.setTimeout(hostPlay, 150);
}
// The host saw the mouse on its own page, so the mouse left without this frame
// hearing it. Rest the figure as a real leave would.
function hostSawMouseOutside() {
  if (!mouseInside) return;
  mouseInside = false;
  dispatchPointer('pointerleave', 0, 0);
  resumeHostPlay();
}
function onHostMessage(event) {
  if (event.source !== window.parent) return;
  const command = event.data?.hairline;
  if (command === 'outside') hostSawMouseOutside();
  if (command !== 'play' && command !== 'rest') return;
  hostPlaying = command === 'play';
  if (hostPlaying) hostPlay();
  else hostRest();
}
function onPointerEnter(event) {
  if (!event.isTrusted || event.pointerType !== 'mouse') return;
  mouseInside = true;
  stopPlay();
  // The host page gets no pointer events inside this frame, so tell it.
  window.parent.postMessage({ hairline: 'hover' }, '*');
}
function onPointerLeave(event) {
  if (!event.isTrusted || event.pointerType !== 'mouse') return;
  mouseInside = false;
  window.parent.postMessage({ hairline: 'leave' }, '*');
  resumeHostPlay();
}
function hairline(figure) {
  HL.inject(document);
  stage.dataset.hairline = figure.name;
  const svg = HL.mk('svg', { viewBox: '0 0 400 320', 'aria-hidden': 'true' }, stage);
  figure.mount({ stage, svg, read }, figure.range[1]);
  if (!stage.hasAttribute('tabindex')) {
    stage.tabIndex = 0;
    stage.setAttribute('role', 'button');
    stage.setAttribute('aria-label', figure.means);
    stage.setAttribute('aria-pressed', 'false');
    stage.addEventListener('keydown', onKeyDown);
    stage.addEventListener('blur', onBlur);
  }
  stage.addEventListener('click', onTouch);
  stage.addEventListener('pointerenter', onPointerEnter);
  stage.addEventListener('pointerleave', onPointerLeave);
  stage.addEventListener('focus', onFocus);
  stage.addEventListener('blur', resumeHostPlay);
  window.addEventListener('message', onHostMessage);
}
window.hairline = hairline;
