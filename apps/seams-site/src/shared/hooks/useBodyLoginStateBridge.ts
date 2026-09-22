import React from 'react';
import { useSeams } from '@seams/wallet/react';

// Reflects auth state to <body> dataset and emits a window event for external consumers.
export function useBodyLoginStateBridge() {
  const { loginState } = useSeams();
  React.useEffect(() => {
    try {
      const loggedIn = !!loginState?.isLoggedIn;
      const nearId = loginState?.nearAccountId || '';
      document.body.setAttribute('data-seams-logged-in', loggedIn ? 'true' : 'false');
      if (loggedIn && nearId) document.body.setAttribute('data-seams-near-account-id', nearId);
      else document.body.removeAttribute('data-seams-near-account-id');
      try {
        window.dispatchEvent(
          new CustomEvent('seams:login-state', { detail: { loggedIn, nearAccountId: nearId } }),
        );
      } catch {}
    } catch {}
  }, [loginState?.isLoggedIn, loginState?.nearAccountId]);
}
