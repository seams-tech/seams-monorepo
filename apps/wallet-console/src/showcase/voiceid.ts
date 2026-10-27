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
import { showcaseAppearance, showcasePreset } from './showcaseTheme';
import { schedulePlayback } from './playbackClock';
import { playReceiptLifecycle } from './receiptLifecycle';
import { transitionReceiptView } from './receiptTransition';
import { sendExplorerLinksHome } from './sampleExplorer';
import { configureModalBackdrop } from './modalBackdrop';

configureModalBackdrop();

/* A concept preview of a prepared trade becoming a short voice confirmation.
   The application supplies the intent. Capture, phrase preparation and the
   transaction lifecycle are simulated without microphone or network requests. */

const trade = {
  sellAmount: '10',
  spokenAmount: 'ten',
  sellAsset: 'NEAR',
  receiveAsset: 'USDC',
  minimumReceived: '28.40',
  slippage: '0.5%',
  fee: '0.00005',
  signer: 'alex.near',
};

function tradeCopy(template: string): string {
  return template
    .replaceAll('{amount}', trade.sellAmount)
    .replaceAll('{spokenAmount}', trade.spokenAmount)
    .replaceAll('{asset}', trade.sellAsset)
    .replaceAll('{receiveAsset}', trade.receiveAsset)
    .replaceAll('{minimumReceived}', trade.minimumReceived)
    .replaceAll('{slippage}', trade.slippage);
}

const transaction: TxDisplayModel = {
  chain: 'near',
  signerAccount: trade.signer,
  operations: [
    {
      id: 'swap',
      kind: 'near.action',
      actionType: 'functionCall',
      label: tradeCopy(t('voiceTradeAction')),
      fields: [
        { label: t('minimumReceived'), value: `${trade.minimumReceived} ${trade.receiveAsset}` },
        { label: t('slippageLimit'), value: trade.slippage },
        { label: t('receivingAccount'), value: trade.signer },
        { label: t('quoteValidity'), value: t('exampleQuoteValidity') },
      ],
    },
  ],
  totals: {
    nativeValue: trade.sellAmount,
    nativeSymbol: trade.sellAsset,
    estimatedFee: trade.fee,
    feeSymbol: trade.sellAsset,
  },
};

const PREPARATION_MS = 1400;
const SPEECH_MS = 3000;
const CHECK_MS = 1500;
const ACTIVITY_INTERVAL_MS = 32;

const explorer = 'https://nearblocks.io/';
const stage = document.getElementById('root') as HTMLElement;
sendExplorerLinksHome(stage, explorer);
let handle: ConfirmationSurfaceHandle | null = null;
let voice: VoicePrompt | null = null;
let playback: VoiceTradePlayback | null = null;
let receipt: TransactionReceiptState = { kind: 'signing' };
let view: TransactionReceiptView = 'expanded';
let stopLifecycle: () => void = noPlayback;

function model(capture: HTMLElement | null): ConfirmSurfaceModel {
  return {
    appearance: showcaseAppearance(locale),
    content: {
      kind: 'transaction',
      capture,
      review: {
        model: transaction,
        tree: buildDisplayTreeFromModel(transaction),
        detailsInitiallyOpen: false,
      },
      header: {
        heading: t('reviewTrade'),
        website: { kind: 'ready', text: 'shop.example.com' },
        chainDetails: { kind: 'ready', text: 'NEAR' },
      },
      body: { kind: 'text', text: tradeCopy(t('voiceTradeQuote')) },
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
  playback?.stop();
  playback = null;
  voice?.dispose();
  voice = null;
  handle?.dispose();
  view = 'expanded';
  handle = mountConfirmationSurface({
    parent: stage,
    presentation: { variant: 'modal', context: 'wallet-iframe' },
    model: model(null),
    onClosed: noPlayback,
  });
}

function confirm(): void {
  if (playback) return;
  // The released SDK supplies the visual shell. Its phrase recognizer is not
  // invoked by this preview of the planned transaction-specific confirmation.
  voice = new VoicePrompt(
    document,
    t('approveTradeVoiceId'),
    'approve this transfer at once',
    'segments',
  );
  // The confirmer's toolbar closes the review, as for the SDK's own VoiceID approval.
  voice.record.hidden = true;
  voice.cancel.hidden = true;
  playback = new VoiceTradePlayback(voice);
  handle?.update(model(voice.element));
}

type VoicePlaybackState =
  | { kind: 'preparing' }
  | { kind: 'listening' }
  | { kind: 'checking' }
  | { kind: 'settled' }
  | { kind: 'cancelled' };

/** The canvas clock controls every stage, including the simulated waveform. */
class VoiceTradePlayback {
  private state: VoicePlaybackState = { kind: 'preparing' };
  private stopDelay: () => void = noPlayback;
  private stopActivity: () => void = noPlayback;
  private tick = 0;

  constructor(private readonly prompt: VoicePrompt) {
    prompt.element.dataset.tradeStage = this.state.kind;
    prompt.title.textContent = t('voiceTradePreview');
    prompt.phrase.textContent = tradeCopy(t('voiceTradeIntent'));
    delete prompt.phrase.dataset.voiceidPhrase;
    prompt.status.textContent = t('preparingVoiceConfirmation');
    this.stopDelay = schedulePlayback(this.listen, PREPARATION_MS);
  }

  stop = (): void => {
    this.state = { kind: 'cancelled' };
    this.stopDelay();
    this.stopActivity();
  };

  private listen = (): void => {
    if (this.state.kind !== 'preparing') return;
    this.state = { kind: 'listening' };
    this.prompt.element.dataset.tradeStage = this.state.kind;
    this.prompt.title.textContent = t('voiceReadAloud');
    const phrase = tradeCopy('Sell {spokenAmount} {asset}');
    this.prompt.phrase.textContent = `${phrase}.`;
    this.prompt.phrase.dataset.voiceidPhrase = phrase.toLowerCase();
    this.prompt.capture({ kind: 'listening' });
    this.prompt.status.textContent = t('voiceListening');
    this.activity();
    this.stopDelay = schedulePlayback(this.check, SPEECH_MS);
  };

  private check = (): void => {
    if (this.state.kind !== 'listening') return;
    this.state = { kind: 'checking' };
    this.stopActivity();
    this.prompt.capture({ kind: 'activity', rms: 0, speech: false });
    this.prompt.capture({ kind: 'processing' });
    this.prompt.element.dataset.tradeStage = this.state.kind;
    this.prompt.status.textContent = t('voiceChecking');
    this.stopDelay = schedulePlayback(this.finish, CHECK_MS);
  };

  private finish = (): void => {
    if (this.state.kind !== 'checking') return;
    this.state = { kind: 'settled' };
    signed();
  };

  private activity = (): void => {
    if (this.state.kind !== 'listening') return;
    this.tick += 1;
    const syllable = Math.sin(this.tick * 0.45) ** 2;
    const contour = 0.7 + 0.3 * Math.sin(this.tick * 0.13);
    this.prompt.capture({ kind: 'activity', rms: 0.05 + syllable * contour * 0.13, speech: true });
    this.stopActivity = schedulePlayback(this.activity, ACTIVITY_INTERVAL_MS);
  };
}

function noPlayback(): void {}

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
  if (!handle || next === view) return;
  view = next;
  transitionReceiptView(handle.element, next, showReceipt.bind(null, receipt));
}

review();
