// Loaded into the checkout sample by its E2E scenario. All dimensions use CSS pixels.
let motionStartedAt = 0;
let approvalFrame = null;

function startTransactionDetailsMotion() {
  approvalFrame = document.querySelector('iframe.seams-wallet-overlay-iframe');
  window.transactionDetailsMotion.samples = [];
  window.transactionDetailsMotion.finished = false;
  motionStartedAt = performance.now();
  sampleTransactionDetailsMotion();
}

function sampleTransactionDetailsMotion() {
  const doc = approvalFrame.contentDocument;
  const card = doc.querySelector('.modal-container-root');
  const button = doc.querySelector('button.confirm');
  const details = doc.querySelector('.seams-review-technical');
  const tree = details.querySelector(':scope > div > .seams-review-detail');
  window.transactionDetailsMotion.samples.push({
    elapsedMs: performance.now() - motionStartedAt,
    availableHeight: approvalFrame.contentWindow.innerHeight,
    cardHeight: card.getBoundingClientRect().height,
    buttonBottom: button.getBoundingClientRect().bottom,
    detailsOpen: details.open,
    rawOpen: details.querySelector('.seams-review-raw')?.open ?? false,
    treeHeight: tree.clientHeight,
    treeScrollHeight: tree.scrollHeight,
  });
  if (performance.now() - motionStartedAt < 900) {
    requestAnimationFrame(sampleTransactionDetailsMotion);
  } else {
    window.transactionDetailsMotion.finished = true;
  }
}

window.transactionDetailsMotion = {
  start: startTransactionDetailsMotion,
  samples: [],
  finished: false,
};
