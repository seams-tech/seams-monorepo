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

type DemoOrder = 'review-first' | 'voice-first';
type DemoState =
  | { readonly kind: 'closed' }
  | { readonly kind: 'review'; readonly next: 'voice' | 'sign' }
  | { readonly kind: 'voice'; readonly prompt: VoicePrompt; readonly playback: VoicePlayback }
  | { readonly kind: 'cancelled'; readonly prompt: VoicePrompt }
  | { readonly kind: 'receipt' };

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

/** Both pages simulate capture and signing without microphone or API requests. */
export class VoiceIdDemo {
  private readonly stage: HTMLElement;
  private handle: ConfirmationSurfaceHandle | null = null;
  private state: DemoState = { kind: 'closed' };
  private receipt: TransactionReceiptState = { kind: 'signing' };
  private view: TransactionReceiptView = 'expanded';
  private stopLifecycle: () => void = noPlayback;

  constructor(private readonly order: DemoOrder) {
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
          confirmText: this.order === 'voice-first' ? t('confirmTrade') : t('confirmVoiceId'),
          cancelText: t('cancel'),
          onCancel: this.cancel,
        },
      },
    };
  }

  private render(capture: HTMLElement | null): void {
    if (this.handle) {
      this.handle.update(this.model(capture));
      return;
    }
    this.handle = mountConfirmationSurface({
      parent: this.stage,
      presentation: { variant: 'modal', context: 'wallet-iframe' },
      model: this.model(capture),
      onClosed: noPlayback,
    });
  }

  private stopVoice(): void {
    switch (this.state.kind) {
      case 'voice':
        this.state.playback.stop();
        this.state.prompt.dispose();
        return;
      case 'cancelled':
        this.state.prompt.dispose();
        return;
      case 'closed':
      case 'review':
      case 'receipt':
        return;
      default:
        return assertNever(this.state);
    }
  }

  private start = (): void => {
    this.stopLifecycle();
    this.stopVoice();
    this.state = { kind: 'closed' };
    this.handle?.dispose();
    this.handle = null;
    this.view = 'expanded';
    if (this.order === 'voice-first') this.listen();
    else this.review('voice');
  };

  private review(next: 'voice' | 'sign'): void {
    this.stopVoice();
    this.state = { kind: 'review', next };
    this.render(null);
  }

  private confirm = (): void => {
    if (this.state.kind !== 'review') return;
    switch (this.state.next) {
      case 'voice':
        this.listen();
        return;
      case 'sign':
        this.sign();
        return;
      default:
        return assertNever(this.state.next);
    }
  };

  private listen = (): void => {
    this.stopVoice();
    const prompt = new VoicePrompt(
      document,
      t('approveTradeVoiceId'),
      'approve this transfer at once',
      'segments',
    );
    prompt.record.hidden = true;
    prompt.cancel.hidden = true;
    const phrase = this.order === 'voice-first' ? 'Swap ten NEAR for USDC' : 'Swap ten NEAR';
    prompt.title.textContent = t('voiceReadAloud');
    prompt.phrase.textContent = `${phrase}.`;
    prompt.phrase.dataset.voiceidPhrase = phrase.toLowerCase();
    const playback = new VoicePlayback(prompt, this.verified);
    this.state = { kind: 'voice', prompt, playback };
    this.render(prompt.element);
  };

  private verified = (): void => {
    if (this.state.kind !== 'voice') return;
    if (this.order === 'voice-first') this.review('sign');
    else this.sign();
  };

  private cancel = (): void => {
    if (this.order === 'review-first') {
      this.start();
      return;
    }
    if (this.state.kind === 'voice') {
      const { prompt, playback } = this.state;
      playback.stop();
      this.state = { kind: 'cancelled', prompt };
      prompt.ready('');
      prompt.record.textContent = t('tryAgain');
      prompt.record.onclick = this.listen;
    } else if (this.state.kind === 'review') {
      this.listen();
    }
  };

  private sign(): void {
    this.stopVoice();
    this.state = { kind: 'receipt' };
    this.stopLifecycle = playReceiptLifecycle(
      this.showReceipt,
      '4wBqpZM9xaSheZzJSMawUKKwhdpChKbZ5eu5ky4Vigw',
    );
  }

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

function assertNever(value: never): never {
  throw new Error(`Unexpected VoiceID demo state: ${String(value)}`);
}
