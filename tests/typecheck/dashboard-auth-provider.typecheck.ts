import type { DashboardAuthProvider } from '../../apps/wallet-console/src/core/auth/DashboardAuthCard';

declare const google: Extract<DashboardAuthProvider, { id: 'google' }>;
declare const github: Extract<DashboardAuthProvider, { id: 'github' }>;

// @ts-expect-error Google credentials must use the credential callback.
const googleWithCustomButton: DashboardAuthProvider = { ...google, onContinue: github.onContinue };
void googleWithCustomButton;

// @ts-expect-error A GitHub button cannot accept Google identity configuration through a spread.
const mixedProvider: DashboardAuthProvider = { ...google, ...github };
void mixedProvider;

// @ts-expect-error The Google flow requires its credential and error handlers.
const missingGoogleHandlers: DashboardAuthProvider = {
  id: 'google',
  clientId: 'client',
  oneTap: 'enabled',
  label: 'Continue with Google',
  disabled: false,
};
void missingGoogleHandlers;
