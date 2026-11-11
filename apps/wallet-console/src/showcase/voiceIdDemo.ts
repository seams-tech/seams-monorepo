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
import { VoicePrompt } from '@seams/voice-capture/card';
import { showcaseAppearance, showcasePreset } from './showcaseTheme';
import { schedulePlayback } from './playbackClock';
import { playReceiptLifecycle } from './receiptLifecycle';
import { transitionReceiptView } from './receiptTransition';
import { sendExplorerLinksHome } from './sampleExplorer';
import { configureModalBackdrop } from './modalBackdrop';

configureModalBackdrop();

type DemoState =
  | { readonly kind: 'review' }
  | { readonly kind: 'voice'; readonly prompt: VoicePrompt; readonly playback: VoicePlayback }
  | { readonly kind: 'receipt'; readonly prompt: VoicePrompt };

const trade = {
  sellAmount: '10',
  sellAsset: 'NEAR',
  receiveAsset: 'USDC',
  minimumReceived: '28.40',
  slippage: '0.5%',
  fee: '0.00005',
  signer: 'alex.near',
};
const transaction: TxDisplayModel = {
  chain: 'near',
  signerAccount: trade.signer,
  operations: [
    {
      id: 'swap',
      kind: 'near.action',
      actionType: 'functionCall',
      label: t('voiceTradeAction')
        .replaceAll('{asset}', trade.sellAsset)
        .replaceAll('{receiveAsset}', trade.receiveAsset),
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
const explorer = 'https://nearblocks.io/';

/**
 * A VoiceID unlock opens a signing session, and the session signs without a
 * voice check per transaction. This demo starts with a session that has run
 * out, so Confirm with VoiceID steps the session up inside the confirm card:
 * the capture replaces the review, and the receipt then takes over the card.
 * The page simulates the capture and the signature without microphone or API
 * requests.
 */
export class VoiceIdDemo {
  private readonly stage: HTMLElement;
  private handle: ConfirmationSurfaceHandle | null = null;
  private state: DemoState = { kind: 'review' };
  private receipt: TransactionReceiptState = { kind: 'signing' };
  private view: TransactionReceiptView = 'expanded';
  private stopLifecycle: () => void = noPlayback;

  constructor() {
    const stage = document.getElementById('root');
    if (!stage) throw new Error('The VoiceID demo root is unavailable.');
    this.stage = stage;
    sendExplorerLinksHome(this.stage, explorer);
    this.start();
  }

  private model(capture: HTMLElement | null): ConfirmSurfaceModel {
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
        body: { kind: 'empty' },
        prompt: { kind: 'session' },
        transaction: {
          tree: null,
          theme: showcasePreset.mode,
          explorers: { near: explorer },
          decision: { kind: 'ready', onConfirm: this.confirm },
          confirmText: t('confirmWithVoiceId'),
          cancelText: t('cancel'),
          onCancel: this.start,
        },
      },
    };
  }

  /** Every run starts at the trade review. */
  private start = (): void => {
    this.stopLifecycle();
    this.stopLifecycle = noPlayback;
    if (this.state.kind === 'voice') this.state.playback.stop();
    if (this.state.kind !== 'review') this.state.prompt.dispose();
    this.state = { kind: 'review' };
    this.view = 'expanded';
    this.handle?.dispose();
    this.handle = mountConfirmationSurface({
      parent: this.stage,
      presentation: { variant: 'modal', context: 'wallet-iframe' },
      model: this.model(null),
      onClosed: noPlayback,
    });
  };

  private confirm = (): void => {
    if (this.state.kind !== 'review') return;
    const prompt = new VoicePrompt(
      document,
      t('confirmWithVoiceId'),
      'the market is open',
      'segments',
    );
    // The confirm card's toolbar closes the step-up, as in the SDK.
    prompt.record.hidden = true;
    prompt.cancel.hidden = true;
    this.state = { kind: 'voice', prompt, playback: new VoicePlayback(prompt, this.sign) };
    this.handle?.update(this.model(prompt.element));
  };

  /** The voice check renewed the session, so the wallet signs and the receipt follows. */
  private sign = (): void => {
    if (this.state.kind !== 'voice') return;
    this.state = { kind: 'receipt', prompt: this.state.prompt };
    this.stopLifecycle = playReceiptLifecycle(
      this.showReceipt,
      '4wBqpZM9xaSheZzJSMawUKKwhdpChKbZ5eu5ky4Vigw',
    );
  };

  private showReceipt = (state: TransactionReceiptState): void => {
    this.receipt = state;
    this.handle?.showReceipt({
      subject: 'transaction',
      state,
      view: this.view,
      onView: this.changeView,
      onDismiss: this.start,
    });
  };

  private changeView = (next: TransactionReceiptView): void => {
    if (!this.handle || next === this.view) return;
    this.view = next;
    transitionReceiptView(this.handle.element, next, this.showReceipt.bind(null, this.receipt));
  };
}

type VoicePlaybackState = 'listening' | 'checking' | 'settled' | 'cancelled';

/** The canvas clock controls the simulated speech and speaker check. */
class VoicePlayback {
  private state: VoicePlaybackState = 'listening';
  private stopDelay: () => void = noPlayback;
  private stopActivity: () => void = noPlayback;
  private tick = 0;

  constructor(
    private readonly prompt: VoicePrompt,
    private readonly verified: () => void,
  ) {
    prompt.element.dataset.tradeStage = this.state;
    prompt.title.textContent = t('voiceReadAloud');
    prompt.capture({ kind: 'listening' });
    prompt.status.textContent = t('voiceListening');
    this.activity();
    this.stopDelay = schedulePlayback(this.check, 3000);
  }

  stop = (): void => {
    this.state = 'cancelled';
    this.stopDelay();
    this.stopActivity();
  };

  private check = (): void => {
    if (this.state !== 'listening') return;
    this.state = 'checking';
    this.stopActivity();
    this.prompt.capture({ kind: 'activity', rms: 0, speech: false });
    this.prompt.capture({ kind: 'processing' });
    this.prompt.element.dataset.tradeStage = this.state;
    this.prompt.status.textContent = t('voiceChecking');
    this.stopDelay = schedulePlayback(this.finish, 1500);
  };

  private finish = (): void => {
    if (this.state !== 'checking') return;
    this.state = 'settled';
    this.verified();
  };

  private activity = (): void => {
    if (this.state !== 'listening') return;
    this.tick += 1;
    const syllable = Math.sin(this.tick * 0.45) ** 2;
    const contour = 0.7 + 0.3 * Math.sin(this.tick * 0.13);
    this.prompt.capture({ kind: 'activity', rms: 0.05 + syllable * contour * 0.13, speech: true });
    this.stopActivity = schedulePlayback(this.activity, 32);
  };
}

function noPlayback(): void {}
