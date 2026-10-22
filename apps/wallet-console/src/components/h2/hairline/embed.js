/* global HL */
const stage = document.getElementById('stage');
const read = document.getElementById('read');
// The figure plays by following a synthetic pointer along this path: "x,y,ms"
// keyframes in the 400 by 320 frame, timed from the start of the play.
const playPath = (stage.dataset.play ?? '')
  .split(' ')
  .filter(Boolean)
  .map((keyframe) => keyframe.split(',').map(Number));
if (!playPath.length)
  playPath.push([Number(stage.dataset.pointerX), Number(stage.dataset.pointerY), 0]);
// The figure plays forward while the mouse, the keyboard or the host page wants
// it, and reverses to rest when none does. It never replays by itself.
let mouseInside = false;
let keyboardActive = false;
let hostWants = false;
let playing = false;
let playStart = 0;
let playFrame = 0;

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
function update() {
  const wanted = mouseInside || keyboardActive || hostWants;
  if (wanted === playing) return;
  playing = wanted;
  stage.setAttribute('aria-pressed', String(playing));
  cancelAnimationFrame(playFrame);
  playFrame = 0;
  if (!playing) {
    dispatchPointer('pointerleave', 0, 0);
    return;
  }
  playStart = performance.now();
  playFrame = requestAnimationFrame(playStep);
}
// Enter, Space or a tap toggles the figure. Stopping it also ends the host's
// play, so the figure stays at rest until the host plays it again.
function toggleAnimation() {
  keyboardActive = !playing;
  if (!keyboardActive) hostWants = false;
  update();
}
function onKeyDown(event) {
  if (event.key !== 'Enter' && event.key !== ' ') return;
  event.preventDefault();
  toggleAnimation();
}
function onTouch(event) {
  if (event.pointerType === 'touch') toggleAnimation();
}
// Focus hands the figure to the visitor: the host's play gives way to rest
// first, or Enter would stop the figure instead of playing it.
function onFocus() {
  if (mouseInside) return;
  hostWants = false;
  update();
}
function onBlur() {
  keyboardActive = false;
  update();
}
function mouseEntered() {
  if (mouseInside) return;
  mouseInside = true;
  // The host page gets no pointer events inside this frame, so tell it.
  window.parent.postMessage({ hairline: 'hover' }, '*');
  update();
}
// Leaving reverses the figure, also when the host started it, and the host's
// play does not start it again.
function mouseLeft() {
  if (!mouseInside) return;
  mouseInside = false;
  hostWants = false;
  window.parent.postMessage({ hairline: 'leave' }, '*');
  update();
}
// The visitor's mouse starts and reverses the play but never steers it: its
// own moves would re-pick parts under the pointer and make the figure jitter.
function onVisitorPointer(event) {
  if (!event.isTrusted) return;
  event.stopPropagation();
  if (event.pointerType !== 'mouse') return;
  if (event.type !== 'pointerleave') mouseEntered();
  else if (event.target === stage) mouseLeft();
}
// "outside": the host saw the mouse on its own page, so the mouse left without
// this frame hearing it.
function onHostMessage(event) {
  if (event.source !== window.parent) return;
  const command = event.data?.hairline;
  if (command === 'outside') mouseLeft();
  if (command !== 'play' && command !== 'rest') return;
  hostWants = command === 'play';
  update();
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
  stage.addEventListener('focus', onFocus);
  for (const type of ['pointerenter', 'pointermove', 'pointerdown', 'pointerleave'])
    window.addEventListener(type, onVisitorPointer, true);
  window.addEventListener('message', onHostMessage);
}
window.hairline = hairline;
