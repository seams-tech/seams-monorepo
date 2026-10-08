/* global HL */
const stage = document.getElementById('stage');
const read = document.getElementById('read');
let keyboardActive = false;

function toggleAnimation() {
  keyboardActive = !keyboardActive;
  const box = stage.getBoundingClientRect();
  const x = Number(stage.dataset.pointerX);
  const y = Number(stage.dataset.pointerY);
  stage.dispatchEvent(
    new PointerEvent(keyboardActive ? 'pointermove' : 'pointerleave', {
      pointerType: 'mouse',
      pointerId: 1,
      bubbles: true,
      clientX: box.left + (box.width * x) / 400,
      clientY: box.top + (box.height * y) / 320,
    }),
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
}
window.hairline = hairline;
