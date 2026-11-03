import { useLayoutEffect } from 'react';
import type { TransactionReview, TransactionReviewControls } from '@seams/wallet/react';
import './directWalletReview.css';

/* VoiceID signs only reviewed calls. The demo has no review step of its own, so
   this review opens the wallet confirmation at once and keeps the SDK's request
   binding and deadline. */
export function directWalletReview(title: string): TransactionReview {
  return {
    title,
    validity: { kind: 'expires_at', atMs: Date.now() + 120_000 },
    render: renderDirectWalletReview,
    className: 'demo-direct-wallet-review',
  };
}

function renderDirectWalletReview(controls: TransactionReviewControls): React.ReactNode {
  return <DirectWalletReview controls={controls} />;
}

function DirectWalletReview({ controls }: { controls: TransactionReviewControls }): null {
  const { continueToWallet } = controls;
  useLayoutEffect(() => continueToWallet(), [continueToWallet]);
  return null;
}
