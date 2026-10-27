import { locale, t } from '@/marketing/i18n/browser';
import './embeddedFocus';
import '@wallet-ui/sdk/wallet-ui.css';
import './showcase.css';
import {
  mountConfirmationSurface,
  type ConfirmationSurfaceHandle,
  type ConfirmSurfaceModel,
} from '@wallet-ui/core/signingEngine/uiConfirm/ui/preact/mountConfirmationSurface';
import { buildDisplayTreeFromModel } from '@wallet-ui/core/signingEngine/uiConfirm/ui/transaction-display/tree';
import type {
  TransactionReceiptState,
  TransactionReceiptView,
} from '@wallet-ui/core/signingEngine/uiConfirm/ui/transaction-receipt';
import type { TxDisplayModel } from '@wallet-ui/core/signingEngine/interfaces/display';
import { VoicePrompt } from '@voiceid-ui/capture/prompt';
import type { SpokenPhrase } from '@voiceid-ui/browser/phrase';
import { showcaseAppearance, showcasePreset } from './showcaseTheme';
import { schedulePlayback } from './playbackClock';
import { playReceiptLifecycle, shortenReceiptMinimization } from './receiptLifecycle';
import { sendExplorerLinksHome } from './sampleExplorer';
import { configureModalBackdrop } from './modalBackdrop';

configureModalBackdrop();

/* The SDK's transaction confirmer with its VoiceID card on sample data. A
   simulated voice reads the phrase; the card checks it and hands its progress
   segments to the receipt. No microphone opens and nothing is signed or sent. */

const transfer: TxDisplayModel = {
  chain: 'near',
  signerAccount: 'alex.near',
  operations: [
    {
      id: 'transfer',
      kind: 'generic.contractCall',
      label: t('transferNear'),
      to: 'shop.near',
    },
  ],
  totals: { nativeValue: '2.5', nativeSymbol: 'NEAR', estimatedFee: '0.00005', feeSymbol: 'NEAR' },
};

const phrases: readonly SpokenPhrase[] = [
  'no crying in the casino',
  "i'm here for the tech",
  'if you panic panic early',
  'exit liquidity for all passengers',
  'dump on them slowly',
  'approve this transfer at once',
];
let phraseIndex = Math.floor(Math.random() * phrases.length);
// When the simulated voice starts and stops, when the card checks it, and
// when the signed receipt takes the card over.
const SPEECH_START_MS = 700;
const SPEECH_END_MS = 3100;
const CHECK_MS = 3500;
const SIGNED_MS = 5000;
const ACTIVITY_INTERVAL_MS = 32;

const explorer = 'https://nearblocks.io/';
const stage = document.getElementById('root') as HTMLElement;
sendExplorerLinksHome(stage, explorer);
let handle: ConfirmationSurfaceHandle | null = null;
let voice: VoicePrompt | null = null;
let receipt: TransactionReceiptState = { kind: 'signing' };
let view: TransactionReceiptView = 'expanded';
let stopVoice = (): void => {};
let stopLifecycle = (): void => {};

function model(capture: HTMLElement | null): ConfirmSurfaceModel {
  return {
    appearance: showcaseAppearance(locale),
    content: {
      kind: 'transaction',
      capture,
      review: {
        model: transfer,
        tree: buildDisplayTreeFromModel(transfer),
        detailsInitiallyOpen: false,
      },
      header: {
        heading: t('reviewTransfer'),
        website: { kind: 'ready', text: 'shop.example.com' },
        chainDetails: { kind: 'ready', text: 'NEAR' },
      },
      body: { kind: 'empty' },
      // An unlocked VoiceID session confirms without a passkey, so the button has no fingerprint.
      prompt: { kind: 'session' },
      transaction: {
        tree: null,
        theme: showcasePreset.mode,
        explorers: { near: explorer },
        decision: { kind: 'ready', onConfirm: confirm },
        confirmText: t('confirmVoiceId'),
        cancelText: t('cancel'),
        onCancel: review,
      },
    },
  };
}

function review(): void {
  stopLifecycle();
  stopVoice();
  voice?.dispose();
  voice = null;
  handle?.dispose();
  view = 'expanded';
  handle = mountConfirmationSurface({
    parent: stage,
    presentation: { variant: 'modal', context: 'wallet-iframe' },
    model: model(null),
    onClosed: () => {},
  });
}

function confirm(): void {
  const phrase = phrases[phraseIndex];
  // A random forward step keeps consecutive approvals from repeating a phrase.
  const step = 1 + Math.floor(Math.random() * (phrases.length - 1));
  phraseIndex = (phraseIndex + step) % phrases.length;
  voice = new VoicePrompt(document, t('approveVoiceId'), phrase, 'segments');
  // The confirmer's toolbar closes the review, as for the SDK's own VoiceID approval.
  voice.record.hidden = true;
  voice.cancel.hidden = true;
  handle?.update(model(voice.element));
  stopVoice = speak(voice);
}

/** Plays the microphone's part: a spoken phrase, a pause, then the check. */
function speak(prompt: VoicePrompt): () => void {
  const speech = new SimulatedSpeech(prompt);
  prompt.capture({ kind: 'listening' });
  const cancels = [
    schedulePlayback(speech.start, SPEECH_START_MS),
    schedulePlayback(speech.stop, SPEECH_END_MS),
    schedulePlayback(() => prompt.capture({ kind: 'processing' }), CHECK_MS),
    schedulePlayback(signed, SIGNED_MS),
  ];
  return () => {
    speech.stop();
    for (const cancel of cancels) cancel();
  };
}

/** Recorder activity for a voice reading the phrase at a natural pace. */
class SimulatedSpeech {
  private timer: number | null = null;
  private tick = 0;

  constructor(private readonly prompt: VoicePrompt) {}

  start = (): void => {
    this.timer = window.setInterval(this.speak, ACTIVITY_INTERVAL_MS);
  };

  stop = (): void => {
    if (this.timer === null) return;
    window.clearInterval(this.timer);
    this.timer = null;
    this.prompt.capture({ kind: 'activity', rms: 0, speech: false });
  };

  // Syllables ride on a slower phrase contour, as a spoken sentence does.
  private speak = (): void => {
    this.tick += 1;
    const syllable = Math.sin(this.tick * 0.45) ** 2;
    const contour = 0.7 + 0.3 * Math.sin(this.tick * 0.13);
    this.prompt.capture({ kind: 'activity', rms: 0.05 + syllable * contour * 0.13, speech: true });
  };
}

function signed(): void {
  stopLifecycle = playReceiptLifecycle(showReceipt, '4wBqpZM9xaSheZzJSMawUKKwhdpChKbZ5eu5ky4Vigw');
}

function showReceipt(state: TransactionReceiptState): void {
  receipt = state;
  handle?.showReceipt({
    subject: 'transaction',
    state: receipt,
    view,
    onView: changeView,
    onDismiss: review,
  });
}

function changeView(next: TransactionReceiptView): void {
  view = next;
  showReceipt(receipt);
  if (next === 'toast' && handle) shortenReceiptMinimization(handle.element);
}

review();
