/* global translateAlong, depthOf, PROJECTION */
// build.mjs supplies the Anatomy geometry helpers and this figure's camera.
const lesson = { curve: 'ed25519', scenario: 'success', step: 0, view: 'walkthrough' };
const machine = document.getElementById('machine');
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
const machineParts = Array.from(machine.children, readMachinePart);
let pressPosition = 0;
let pressTarget = 0;
let animationFrame = 0;
let previousTime = 0;
let onScreen = true;
let tourTimer = 0;
let tourRunning = false;
let inspection = '';

function readMachinePart(element) {
  return {
    element,
    key: Number(element.dataset.key),
    move: element.dataset.move.split(',').map(Number),
    currentKey: Number(element.dataset.key),
  };
}

function setText(id, text) {
  document.getElementById(id).textContent = text;
}

function stepContent() {
  const ecdsa = lesson.curve === 'ecdsa';
  if (lesson.view === 'replay-refused') {
    return {
      title: 'That presignature stays consumed',
      copy: 'A second attempt with the consumed entry is refused. A new signing attempt needs fresh one-use material and its own authorization.',
      label: 'Same presignature, second attempt',
      value: 'Refused',
      focus: 'pool',
      press: 0,
      boundary: 'A missing response cannot restore a claimed presignature to the available pool.',
    };
  }
  switch (lesson.step) {
    case 0:
      return {
        title: 'Two separate derivation roles',
        copy: ecdsa
          ? 'Deriver A and Deriver B each use their own tenant-root share. A threshold pseudorandom function (PRF) requires both roles to provision ECDSA lane material.'
          : 'Deriver A garbles a fixed computation. Deriver B evaluates it. Streaming Yao creates Ed25519 lane material while keeping their private inputs separate.',
        label: 'Provisioning protocol',
        value: ecdsa ? 'Threshold PRF · 2 of 2' : 'Streaming Yao · A + B',
        focus: 'derivers',
        press: 0,
        boundary: ecdsa
          ? 'Each Deriver answers Router. ECDSA derivation sends no message between the Derivers.'
          : 'The Derivers exchange the framed Yao stream directly. Router coordinates the admitted operation.',
      };
    case 1:
      return {
        title: 'Deliver to separate recipients',
        copy: 'Encrypted outputs reach the client and SigningWorker separately. Each recipient opens only its own packages. The two large cartridges represent their resulting lane material.',
        label: 'Recipient boundaries',
        value: 'Client / SigningWorker',
        focus: 'client',
        press: 0,
        boundary:
          'Router sees public commitments, encrypted packages, and receipts. It cannot open the recipient material.',
      };
    case 2:
      return {
        title: 'Activate the signing lane',
        copy: 'The recipients check package bindings and public identity. SigningWorker verifies activation evidence before it persists its server material. Both holders are now ready.',
        label: 'Activation',
        value: 'Verify committed output',
        focus: 'worker',
        press: 0,
        boundary: ecdsa
          ? 'Activation consumes the committed derivation output. It performs zero new threshold-PRF derivations.'
          : 'Activation consumes the committed packages. It performs zero new Yao evaluations.',
      };
    case 3:
      if (lesson.scenario === 'denied') {
        return {
          title: 'The admission gate stays closed',
          copy: 'Gateway refuses the signing request because authorization fails. The protocol cannot use the presence of two holders as a substitute for an admitted operation.',
          label: 'Gateway admission',
          value: 'Refused',
          focus: 'gateway',
          press: 0,
          boundary: 'The press remains idle. No signature is delivered.',
        };
      }
      return {
        title: 'Authorize this exact request',
        copy: 'Gateway checks the Wallet Session, permissions, and allowance. Router verifies the admitted operation and coordinates its bound signing messages with SigningWorker.',
        label: 'Normal signing path',
        value: 'Client · Gateway · Router · Worker',
        focus: 'gateway',
        press: 0,
        boundary:
          'Deriver A, Deriver B, and the tenant-root control plane stay outside normal signing.',
      };
    case 4:
      if (lesson.scenario === 'worker-offline') {
        return {
          title: 'One holder cannot finish',
          copy: 'SigningWorker is unavailable before preparation. The client cannot complete this two-party signing operation alone. The activated lane still exists.',
          label: 'Available signing holders',
          value: '1 of 2 · stopped',
          focus: 'client',
          press: 0,
          boundary:
            'The Derivers do not replace an unavailable SigningWorker on the normal signing path.',
        };
      }
      return {
        title: ecdsa ? 'Reserve one presignature' : 'Prepare fresh round-one material',
        copy: ecdsa
          ? 'The client worker owns its opaque presignatures. Signing binds one client/server pair to this request. If the pool is empty, pool-fill prepares material first.'
          : 'The client and SigningWorker prepare commitments to fresh one-use random values, called nonces, when needed. These public commitments bind the following signing round.',
        label: ecdsa ? 'Illustrated pool entry P1' : 'Ed25519 signing protocol',
        value: ecdsa ? 'Reserved for this request' : 'FROST · two participants',
        focus: ecdsa ? 'pool' : 'client',
        press: 0,
        boundary: ecdsa
          ? 'The tray represents three example entries. Each entry has separately held client and server material.'
          : 'This step uses active lane shares. It performs zero Deriver calls and zero Yao evaluations.',
      };
    case 5:
      return {
        title: 'Both holders participate',
        copy: ecdsa
          ? 'The client and SigningWorker run the online signing protocol. The server atomically consumes its reserved presignature for this attempt. The press can now descend.'
          : 'Each holder computes its signing contribution using private lane material. Their contributions produce a standard Ed25519 signature. The press can now descend.',
        label: ecdsa ? 'Illustrated pool entry P1' : 'Participating signing holders',
        value: ecdsa ? 'Consumed · terminal' : '2 of 2',
        focus: 'press',
        press: 1,
        boundary:
          'The cartridges stay in separate housings. Press motion represents joint computation, with no complete private key assembled at Router.',
      };
    case 6:
      if (lesson.scenario === 'lost-response') {
        return {
          title: 'The response never arrives',
          copy: 'The response is lost after SigningWorker consumed the reserved presignature. The client has no confirmed signature result from this attempt.',
          label: 'Illustrated pool entry P1',
          value: 'Consumed · cannot be reused',
          focus: 'pool',
          press: 0,
          boundary:
            'Consumption remains terminal even when later delivery fails. Try the same presignature again below.',
        };
      }
      return {
        title: 'One ordinary signature',
        copy: ecdsa
          ? 'The client accepts the completed, verified ECDSA signature for the requested digest. The chain verifies it against the wallet public key.'
          : 'The client accepts the completed, verified Ed25519 signature. The chain verifies it against the wallet public key.',
        label: 'Delivered result',
        value: ecdsa ? '1 ECDSA signature' : '1 Ed25519 signature',
        focus: 'message',
        press: 0,
        boundary: ecdsa
          ? 'P1 stays consumed. A later signing operation uses another entry. Background replenishment can refill the pool.'
          : 'The signature has the standard format. The two-party process stays inside the wallet signing system.',
      };
    default:
      throw new Error('Unknown explanation step');
  }
}

function finalStep() {
  switch (lesson.scenario) {
    case 'denied':
      return 3;
    case 'worker-offline':
      return 4;
    case 'success':
    case 'lost-response':
      return 6;
    default:
      throw new Error('Unknown illustration scenario');
  }
}

function selectedGroup(group, focus) {
  return group === focus || (focus === 'derivers' && group.startsWith('deriver'));
}

function updateLesson() {
  const content = stepContent();
  const isEcdsa = lesson.curve === 'ecdsa';
  const end = lesson.step === finalStep();
  setText('step-title', content.title);
  setText('step-copy', content.copy);
  setText('fact-label', content.label);
  setText('fact-value', content.value);
  setText('boundary', content.boundary);
  setText('phase', lesson.step < 3 ? '01 / PROVISION THE LANE' : '02 / SIGN WITH THE ACTIVE LANE');
  setText('position', `${lesson.step + 1} / ${finalStep() + 1}`);
  setText('next', end ? 'Replay explanation ↺' : 'Next step →');
  setText('status', `${lesson.step + 1}. ${content.title}. ${content.value}.`);
  document.querySelector('[data-readout]').textContent =
    lesson.step < 3 ? 'Provisioning · A + B' : content.value;
  document.getElementById('previous').disabled = lesson.step === 0;
  document.getElementById('reuse').hidden = !(isEcdsa && lesson.step === 6);
  document.getElementById('reuse').disabled = lesson.view === 'replay-refused';
  document.querySelector('option[value="lost-response"]').disabled = !isEcdsa;
  for (const button of document.querySelectorAll('[data-curve]')) {
    button.setAttribute('aria-pressed', String(button.dataset.curve === lesson.curve));
  }
  for (const part of machineParts) {
    const group = part.element.dataset.group;
    part.element.dataset.active = String(selectedGroup(group, inspection || content.focus));
    part.element.dataset.muted = String(lesson.step >= 3 && group.startsWith('deriver'));
    if (group === 'pool') {
      part.element.style.visibility = isEcdsa ? 'visible' : 'hidden';
    }
    if (part.element.dataset.name === 'pool.token-0' && isEcdsa) {
      part.element.style.visibility = lesson.step >= 5 ? 'hidden' : 'visible';
    }
  }
  document
    .getElementById('signature-seal')
    .setAttribute('opacity', String(lesson.step === 6 && lesson.scenario === 'success' ? 1 : 0));
  pressTarget = content.press;
  startMotion();
}

function comparePartKeys(left, right) {
  return left.currentKey - right.currentKey;
}

function paintPress() {
  for (const part of machineParts) {
    const offset = part.move.map(scaleMovement);
    part.element.setAttribute('transform', translateAlong(PROJECTION, offset));
    part.currentKey = part.key + depthOf(offset, PROJECTION);
    const clip = part.element.querySelector('[data-hold]');
    if (clip) {
      clip.setAttribute('transform', translateAlong(PROJECTION, offset.map(negate)));
    }
  }
  const ordered = [...machineParts].sort(comparePartKeys);
  for (let index = 0; index < ordered.length; index += 1) {
    if (machine.children[index] !== ordered[index].element) {
      machine.insertBefore(ordered[index].element, machine.children[index]);
    }
  }
}

function scaleMovement(value) {
  return value * pressPosition;
}

function negate(value) {
  return -value;
}

function animatePress(now) {
  animationFrame = 0;
  if (!onScreen) return;
  const elapsed = previousTime ? Math.min((now - previousTime) / 1000, 0.05) : 1 / 60;
  previousTime = now;
  pressPosition += (pressTarget - pressPosition) * (1 - Math.exp(-elapsed / 0.18));
  if (Math.abs(pressTarget - pressPosition) < 0.001) pressPosition = pressTarget;
  paintPress();
  if (pressPosition !== pressTarget) animationFrame = requestAnimationFrame(animatePress);
}

function startMotion() {
  if (reducedMotion.matches) {
    cancelAnimationFrame(animationFrame);
    animationFrame = 0;
    pressPosition = pressTarget;
    paintPress();
  } else if (!animationFrame && onScreen) {
    previousTime = 0;
    animationFrame = requestAnimationFrame(animatePress);
  }
}

function stopTour() {
  clearTimeout(tourTimer);
  tourRunning = false;
  setText('play', 'Play tour');
  document.getElementById('play').setAttribute('aria-pressed', 'false');
}

function advanceLesson() {
  lesson.step = lesson.step === finalStep() ? 0 : lesson.step + 1;
  lesson.view = 'walkthrough';
  inspection = '';
  updateLesson();
}

function tourStep() {
  if (!tourRunning || !onScreen || reducedMotion.matches) return;
  advanceLesson();
  tourTimer = setTimeout(tourStep, 4600);
}

function handleNext() {
  stopTour();
  advanceLesson();
}

function handlePrevious() {
  stopTour();
  lesson.step = Math.max(0, lesson.step - 1);
  lesson.view = 'walkthrough';
  inspection = '';
  updateLesson();
}

function handleCurve(event) {
  stopTour();
  lesson.curve = event.currentTarget.dataset.curve;
  lesson.scenario = 'success';
  lesson.step = 0;
  lesson.view = 'walkthrough';
  inspection = '';
  document.getElementById('scenario').value = 'success';
  updateLesson();
}

function handleScenario(event) {
  stopTour();
  lesson.scenario = event.target.value;
  lesson.step = 3;
  lesson.view = 'walkthrough';
  inspection = '';
  updateLesson();
}

function handleReuse() {
  stopTour();
  lesson.view = 'replay-refused';
  inspection = '';
  updateLesson();
}

function handleInspection(event) {
  stopTour();
  const group = event.currentTarget.dataset.inspect;
  inspection = inspection === group ? '' : group;
  updateLesson();
  const details = {
    derivers:
      'Rear pair: Deriver A and Deriver B provision lanes. Their tenant-root shares stay role-local.',
    client:
      'Left holder: the client cryptographic runtime holds client lane material and computes its signing contribution.',
    worker:
      'Right holder: SigningWorker holds activated server lane material and computes its signing contribution.',
    gateway:
      'Front gate: Gateway checks authorization and allowance. Router coordinates admitted protocol messages.',
  };
  if (inspection) setText('status', details[inspection]);
}

function handlePlay() {
  if (tourRunning) {
    stopTour();
    return;
  }
  if (reducedMotion.matches) {
    advanceLesson();
    return;
  }
  tourRunning = true;
  setText('play', 'Pause tour');
  document.getElementById('play').setAttribute('aria-pressed', 'true');
  tourTimer = setTimeout(tourStep, 4600);
}

function handleTheme() {
  document.body.dataset.theme = document.body.dataset.theme === 'light' ? 'dark' : 'light';
  setText('theme', document.body.dataset.theme === 'light' ? 'Dark theme' : 'Light theme');
}

function handleVisibility(entries) {
  onScreen = entries[0].isIntersecting;
  if (onScreen) startMotion();
  else stopTour();
}

function handleMotionPreference() {
  stopTour();
  startMotion();
}

document.getElementById('next').addEventListener('click', handleNext);
document.getElementById('previous').addEventListener('click', handlePrevious);
document.getElementById('scenario').addEventListener('change', handleScenario);
document.getElementById('reuse').addEventListener('click', handleReuse);
document.getElementById('play').addEventListener('click', handlePlay);
document.getElementById('theme').addEventListener('click', handleTheme);
for (const button of document.querySelectorAll('[data-curve]'))
  button.addEventListener('click', handleCurve);
for (const button of document.querySelectorAll('[data-inspect]'))
  button.addEventListener('click', handleInspection);
document.querySelector('.iso-stage').addEventListener('pointerenter', stopTour);
document.querySelector('.iso-stage').addEventListener('pointerdown', stopTour);
document.querySelector('.explanation').addEventListener('focusin', stopTour);
reducedMotion.addEventListener('change', handleMotionPreference);
new IntersectionObserver(handleVisibility).observe(machine);
setText('theme', document.body.dataset.theme === 'light' ? 'Dark theme' : 'Light theme');
updateLesson();
if (!reducedMotion.matches) handlePlay();
