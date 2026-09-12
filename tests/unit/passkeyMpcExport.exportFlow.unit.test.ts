import { expect, test } from '@playwright/test';
import { setupBasicPasskeyTest } from '../setup';

const WORKER_PATH = '/sdk/workers/passkey-mpc-export.worker.js';

test.describe('passkey MPC export flow worker', () => {
  test.beforeEach(async ({ page }) => {
    await setupBasicPasskeyTest(page);
  });

  test('returns cancelled when user cancels at final export display step', async ({ page }) => {
    const result = await page.evaluate(
      async ({ workerPath }) => {
        await import(workerPath);

        const originalPostMessage = (self as any).postMessage;
        const prompts: any[] = [];
        const responses: any[] = [];

        (self as any).postMessage = (message: any) => {
          if (message?.type === 'PROMPT_USER_CONFIRM_IN_JS_MAIN_THREAD') {
            prompts.push(message);
            const promptNumber = prompts.length;
            if (promptNumber === 1) {
              self.dispatchEvent(
                new MessageEvent('message', {
                  data: {
                    type: 'USER_PASSKEY_CONFIRM_RESPONSE',
                    requestId: message.requestId,
                    channelToken: message.channelToken,
                    data: {
                      requestId: message.data?.request?.requestId,
                      confirmed: true,
                      credential: {
                        id: 'export-passkey',
                        rawId: 'export-passkey',
                        type: 'public-key',
                        response: {},
                        clientExtensionResults: {},
                      },
                    },
                  },
                }),
              );
              return;
            }
            if (promptNumber === 2) {
              self.dispatchEvent(
                new MessageEvent('message', {
                  data: {
                    type: 'USER_PASSKEY_CONFIRM_RESPONSE',
                    requestId: message.requestId,
                    channelToken: message.channelToken,
                    data: {
                      requestId: message.data?.request?.requestId,
                      confirmed: true,
                    },
                  },
                }),
              );
              return;
            }

            self.dispatchEvent(
              new MessageEvent('message', {
                data: {
                  type: 'USER_PASSKEY_CONFIRM_RESPONSE',
                  requestId: message.requestId,
                  channelToken: message.channelToken,
                  data: {
                    requestId: message.data?.request?.requestId,
                    confirmed: false,
                    error: 'User cancelled export viewer',
                  },
                },
              }),
            );
            return;
          }
          responses.push(message);
        };

        try {
          (self as any).onmessage?.({
            data: {
              id: 'export-op-2',
              type: 'EXPORT_PRIVATE_KEYS_WITH_UI',
              payload: {
                walletId: 'frost-vermillion-k7p9m2',
                credentialIdB64u: 'export-passkey',
                artifactKind: 'ecdsa-derivation-secp256k1-export',
                publicKeyHex: '02' + '11'.repeat(32),
                privateKeyHex: '22'.repeat(32),
                ethereumAddress: '0x' + '33'.repeat(20),
                chainTarget: {
                  kind: 'evm',
                  namespace: 'eip155',
                  chainId: 5042002,
                  networkSlug: 'arc-testnet',
                },
                variant: 'drawer',
                theme: 'dark',
              },
            },
          });

          const workerResponse = await new Promise<any>((resolve, reject) => {
            const deadline = Date.now() + 10_000;
            const poll = () => {
              const found = responses.find((entry) => entry?.id === 'export-op-2');
              if (found) {
                resolve(found);
                return;
              }
              if (Date.now() >= deadline) {
                reject(new Error('Timed out waiting for export worker response'));
                return;
              }
              setTimeout(poll, 0);
            };
            poll();
          });

          return {
            promptCount: prompts.length,
            firstPromptType: prompts[0]?.data?.request?.type || '',
            secondPromptType: prompts[1]?.data?.request?.type || '',
            thirdPromptType: prompts[2]?.data?.request?.type || '',
            response: workerResponse,
          };
        } finally {
          (self as any).postMessage = originalPostMessage;
        }
      },
      { workerPath: WORKER_PATH },
    );

    expect(result.promptCount).toBe(3);
    expect(result.firstPromptType).toBe('authorizeKeyExport');
    expect(result.secondPromptType).toBe('showSecurePrivateKeyUi');
    expect(result.thirdPromptType).toBe('showSecurePrivateKeyUi');
    expect(result.response).toMatchObject({
      id: 'export-op-2',
      success: true,
      data: {
        kind: 'cancelled',
        accountId: 'frost-vermillion-k7p9m2',
        exportedSchemes: [],
      },
    });
    expect(String(result.response?.data?.error || '')).toContain('User cancelled export viewer');
  });

  test('treats abort-like final-step error as cancelled', async ({ page }) => {
    const result = await page.evaluate(
      async ({ workerPath }) => {
        await import(workerPath);

        const originalPostMessage = (self as any).postMessage;
        const prompts: any[] = [];
        const responses: any[] = [];

        (self as any).postMessage = (message: any) => {
          if (message?.type === 'PROMPT_USER_CONFIRM_IN_JS_MAIN_THREAD') {
            prompts.push(message);
            const promptNumber = prompts.length;
            if (promptNumber === 1) {
              self.dispatchEvent(
                new MessageEvent('message', {
                  data: {
                    type: 'USER_PASSKEY_CONFIRM_RESPONSE',
                    requestId: message.requestId,
                    channelToken: message.channelToken,
                    data: {
                      requestId: message.data?.request?.requestId,
                      confirmed: true,
                      credential: {
                        id: 'export-passkey',
                        rawId: 'export-passkey',
                        type: 'public-key',
                        response: {},
                        clientExtensionResults: {},
                      },
                    },
                  },
                }),
              );
              return;
            }
            if (promptNumber === 2) {
              self.dispatchEvent(
                new MessageEvent('message', {
                  data: {
                    type: 'USER_PASSKEY_CONFIRM_RESPONSE',
                    requestId: message.requestId,
                    channelToken: message.channelToken,
                    data: {
                      requestId: message.data?.request?.requestId,
                      confirmed: true,
                    },
                  },
                }),
              );
              return;
            }
            self.dispatchEvent(
              new MessageEvent('message', {
                data: {
                  type: 'USER_PASSKEY_CONFIRM_RESPONSE',
                  requestId: message.requestId,
                  channelToken: message.channelToken,
                  data: {
                    requestId: message.data?.request?.requestId,
                    confirmed: false,
                    error: 'AbortError: user aborted on export viewer',
                  },
                },
              }),
            );
            return;
          }
          responses.push(message);
        };

        try {
          (self as any).onmessage?.({
            data: {
              id: 'export-op-4',
              type: 'EXPORT_PRIVATE_KEYS_WITH_UI',
              payload: {
                walletId: 'frost-vermillion-k7p9m2',
                credentialIdB64u: 'export-passkey',
                artifactKind: 'ecdsa-derivation-secp256k1-export',
                publicKeyHex: '02' + '11'.repeat(32),
                privateKeyHex: '22'.repeat(32),
                ethereumAddress: '0x' + '33'.repeat(20),
                chainTarget: {
                  kind: 'evm',
                  namespace: 'eip155',
                  chainId: 5042002,
                  networkSlug: 'arc-testnet',
                },
                variant: 'drawer',
                theme: 'dark',
              },
            },
          });

          return await new Promise<any>((resolve, reject) => {
            const deadline = Date.now() + 10_000;
            const poll = () => {
              const found = responses.find((entry) => entry?.id === 'export-op-4');
              if (found) {
                resolve(found);
                return;
              }
              if (Date.now() >= deadline) {
                reject(new Error('Timed out waiting for export worker response'));
                return;
              }
              setTimeout(poll, 0);
            };
            poll();
          });
        } finally {
          (self as any).postMessage = originalPostMessage;
        }
      },
      { workerPath: WORKER_PATH },
    );

    expect(result).toMatchObject({
      id: 'export-op-4',
      success: true,
      data: {
        kind: 'cancelled',
        accountId: 'frost-vermillion-k7p9m2',
        exportedSchemes: [],
      },
    });
    expect(String(result?.data?.error || '')).toContain('AbortError');
  });

  test('rejects ECDSA export requests without an explicit artifact before prompting', async ({
    page,
  }) => {
    const result = await page.evaluate(
      async ({ workerPath }) => {
        await import(workerPath);

        const originalPostMessage = (self as any).postMessage;
        const prompts: any[] = [];
        const responses: any[] = [];

        (self as any).postMessage = (message: any) => {
          if (message?.type === 'PROMPT_USER_CONFIRM_IN_JS_MAIN_THREAD') {
            prompts.push(message);
            return;
          }
          responses.push(message);
        };

        try {
          (self as any).onmessage?.({
            data: {
              id: 'export-op-retired-ecdsa-derivation-kind',
              type: 'EXPORT_PRIVATE_KEYS_WITH_UI',
              payload: {
                walletId: 'frost-vermillion-k7p9m2',
                chainTarget: {
                  kind: 'evm',
                  namespace: 'eip155',
                  chainId: 5042002,
                  networkSlug: 'arc-testnet',
                },
                credentialIdB64u: 'export-passkey',
                theme: 'dark',
              },
            },
          });

          const workerResponse = await new Promise<any>((resolve, reject) => {
            const deadline = Date.now() + 3_000;
            const poll = () => {
              const found = responses.find(
                (entry) => entry?.id === 'export-op-retired-ecdsa-derivation-kind',
              );
              if (found) {
                resolve(found);
                return;
              }
              if (Date.now() >= deadline) {
                reject(new Error('Timed out waiting for export worker response'));
                return;
              }
              setTimeout(poll, 0);
            };
            poll();
          });

          return {
            promptCount: prompts.length,
            response: workerResponse,
          };
        } finally {
          (self as any).postMessage = originalPostMessage;
        }
      },
      { workerPath: WORKER_PATH },
    );

    expect(result.promptCount).toBe(0);
    expect(result.response).toMatchObject({
      id: 'export-op-retired-ecdsa-derivation-kind',
      success: false,
      error: 'Invalid EXPORT_PRIVATE_KEYS_WITH_UI payload',
    });
  });
});
