import { locale, t } from '@/marketing/i18n/browser';
import './embeddedFocus';
import '@wallet-ui/sdk/wallet-ui.css';
import './showcase.css';
import {
  createCspStylesheetManager,
  getDefaultCspNonce,
} from '@wallet-ui/core/browser/walletIframe/csp-stylesheet';
import { appearanceTokenCssRule } from '@wallet-ui/core/signingEngine/uiConfirm/ui/appearance-token-vars';
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

const UNLOCK_CARD_ID = 'showcase-voiceid-unlock';
// The unlocked card holds its success briefly before the trade review replaces it.
const UNLOCKED_HOLD_MS = 1300;

createCspStylesheetManager({
  doc: document,
  baseCss: appearanceTokenCssRule(UNLOCK_CARD_ID, showcaseAppearance(locale)),
  nonce: getDefaultCspNonce,
}).ensureBase();

type DemoState =
  | { readonly kind: 'closed' }
  | { readonly kind: 'unlock'; readonly card: UnlockCard; readonly playback: VoicePlayback }
  | { readonly kind: 'cancelled'; readonly card: UnlockCard }
  | { readonly kind: 'unlocked'; readonly card: UnlockCard; readonly stopHold: () => void }
  | { readonly kind: 'review' }
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

/**
 * A VoiceID unlock opens a signing session, so the trade then signs with the
 * ordinary confirm and no further voice check. The page simulates the capture
 * and the signature without microphone or API requests.
 */
export class VoiceIdDemo {
  private readonly stage: HTMLElement;
  private handle: ConfirmationSurfaceHandle | null = null;
  private state: DemoState = { kind: 'closed' };
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

  private model(): ConfirmSurfaceModel {
    return {
      appearance: showcaseAppearance(locale),
      content: {
        kind: 'transaction',
        capture: null,
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
          confirmText: t('confirmTrade'),
          cancelText: t('cancel'),
          onCancel: this.lock,
        },
      },
    };
  }

  private closeUnlock(): void {
    switch (this.state.kind) {
      case 'unlock':
        this.state.playback.stop();
        this.state.card.dispose();
        return;
      case 'cancelled':
        this.state.card.dispose();
        return;
      case 'unlocked':
        this.state.stopHold();
        this.state.card.dispose();
        return;
      case 'closed':
      case 'review':
      case 'receipt':
        return;
      default:
        return assertNever(this.state);
    }
  }

  /** Every run starts from a locked wallet. */
  private start = (): void => {
    this.stopLifecycle();
    this.closeUnlock();
    this.state = { kind: 'closed' };
    this.handle?.dispose();
    this.handle = null;
    this.view = 'expanded';
    this.unlock();
  };

  private lock = (): void => {
    if (this.state.kind === 'review') this.start();
  };

  private unlock = (): void => {
    this.closeUnlock();
    const card = new UnlockCard(this.stage, this.cancelUnlock);
    this.state = { kind: 'unlock', card, playback: new VoicePlayback(card.prompt, this.unlocked) };
  };

  private cancelUnlock = (): void => {
    if (this.state.kind !== 'unlock') return;
    const { card, playback } = this.state;
    playback.stop();
    this.state = { kind: 'cancelled', card };
    card.prompt.ready('');
    card.prompt.record.textContent = t('tryAgain');
    card.prompt.record.onclick = this.unlock;
  };

  private unlocked = (): void => {
    if (this.state.kind !== 'unlock') return;
    const { card } = this.state;
    const state: DemoState = { kind: 'unlocked', card, stopHold: noPlayback };
    this.state = state;
    void card.prompt.succeed(t('signedIn'), t('walletUnlocked')).then(() => {
      if (this.state !== state) return;
      this.state = { ...state, stopHold: schedulePlayback(this.review, UNLOCKED_HOLD_MS) };
    });
  };

  private review = (): void => {
    if (this.state.kind !== 'unlocked') return;
    this.closeUnlock();
    this.state = { kind: 'review' };
    this.handle = mountConfirmationSurface({
      parent: this.stage,
      presentation: { variant: 'modal', context: 'wallet-iframe' },
      model: this.model(),
      onClosed: noPlayback,
    });
  };

  private confirm = (): void => {
    if (this.state.kind !== 'review') return;
    this.state = { kind: 'receipt' };
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

/** The wallet's VoiceID unlock card: it starts listening at once, like a menu unlock. */
class UnlockCard {
  readonly prompt: VoicePrompt;
  private readonly element: HTMLElement;

  constructor(stage: HTMLElement, onCancel: () => void) {
    this.element = document.createElement('section');
    this.element.id = UNLOCK_CARD_ID;
    this.element.className =
      'seams-wallet-ui seams-auth-method-activation-surface seams-voiceid-activation-surface';
    this.element.setAttribute('role', 'dialog');
    this.element.setAttribute('aria-label', t('unlockWithVoiceId'));
    this.prompt = new VoicePrompt(document, t('unlockWithVoiceId'), 'the market is open');
    this.prompt.title.textContent = t('voiceId');
    this.prompt.record.hidden = true;
    this.prompt.cancel.onclick = onCancel;
    this.element.append(this.prompt.element);
    stage.append(this.element);
  }

  dispose(): void {
    this.prompt.dispose();
    this.element.remove();
  }
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
