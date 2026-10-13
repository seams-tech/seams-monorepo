import type {
  AuthenticateConsoleApiKeySuccess,
  AuthenticateConsolePublishableKeySuccess,
  ConsoleApiKey,
} from '../../packages/wallet-console-server-ts/src/apiKeys/types';

declare const credential: ConsoleApiKey;
declare const credentialOnlySuccess: { readonly ok: true; readonly apiKey: ConsoleApiKey };

// @ts-expect-error Authentication success requires the admitted Wallet project.
const missingProject: AuthenticateConsoleApiKeySuccess = { ok: true, apiKey: credential };
void missingProject;

// @ts-expect-error A broad spread cannot turn a credential into Wallet admission.
const spreadCredential: AuthenticateConsolePublishableKeySuccess = { ...credentialOnlySuccess };
void spreadCredential;

const nullProject: AuthenticateConsoleApiKeySuccess = {
  ok: true,
  apiKey: credential,
  // @ts-expect-error A successful Wallet admission cannot carry a null project.
  projectId: null,
};
void nullProject;
