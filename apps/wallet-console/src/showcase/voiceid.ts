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
import { VoicePrompt } from '@wallet-ui/plugins/voiceid/capture/prompt';
import type { SpokenPhrase } from '@wallet-ui/plugins/voiceid/browser/phrase';
import { paperIframeAppearance } from '@/context/app-themes';
import { schedulePlayback } from './playbackClock';
import { playReceiptLifecycle } from './receiptLifecycle';
import { sendExplorerLinksHome } from './sampleExplorer';
import { configureModalBackdrop } from './modalBackdrop';

configureModalBackdrop();

/* The SDK's transaction confirmer with its VoiceID card on sample data. A
   simulated voice reads the phrase; the card checks it and hands its progress
   segments to the receipt. No microphone opens and nothing is signed or sent. */

const transfer: TxDisplayModel = {
  chain: 'evm',
  chainId: 8453,
  signerAccount: `0x4201${'0'.repeat(32)}891c`,
  operations: [
    {
      id: 'transfer',
      kind: 'generic.contractCall',
      label: t('transferEth'),
      to: `0x2F01${'0'.repeat(32)}4EC9`,
    },
  ],
  totals: { nativeValue: '0.025', nativeSymbol: 'ETH', estimatedFee: '0.000001', feeSymbol: 'ETH' },
};

const phrase: SpokenPhrase = 'i am ready to open my wallet';
// When the simulated voice starts and stops, when the card checks it, and
// when the signed receipt takes the card over.
const SPEECH_START_MS = 700;
const SPEECH_END_MS = 3100;
const CHECK_MS = 3500;
const SIGNED_MS = 4600;
const ACTIVITY_INTERVAL_MS = 32;

const explorer = 'https://basescan.org/';
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
    appearance: paperIframeAppearance(locale),
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
        chainDetails: { kind: 'ready', text: 'Base' },
      },
      body: { kind: 'empty' },
      // An unlocked VoiceID session confirms without a passkey, so the button has no fingerprint.
      prompt: { kind: 'session' },
      transaction: {
        tree: null,
        theme: 'light',
        explorers: { near: 'https://nearblocks.io', evm: explorer },
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
  voice = new VoicePrompt(document, t('approveVoiceId'), phrase, 'segments');
  voice.record.hidden = true;
  voice.cancel.addEventListener('click', review);
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
  stopLifecycle = playReceiptLifecycle((state) => {
    receipt = state;
    showReceipt();
  });
}

function showReceipt(): void {
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
  showReceipt();
}

review();
