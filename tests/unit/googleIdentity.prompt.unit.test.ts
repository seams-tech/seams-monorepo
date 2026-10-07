import { expect, test } from '@playwright/test';

const IMPORT_PATHS = {
  googleIdentity: '/src/shared/auth/googleIdentity.ts',
} as const;

test.describe('Google Identity prompt handling', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
  });

  test('reuses the initialized Google client for repeated requests', async ({ page }) => {
    const result = await page.evaluate(
      async ({ paths }) => {
        let initializedConfig: Record<string, unknown> | null = null;
        let initializeCount = 0;
        let promptCount = 0;
        const nativeSetTimeout = window.setTimeout.bind(window);
        const nativeClearTimeout = window.clearTimeout.bind(window);
        window.setTimeout = ((handler: TimerHandler, timeout?: number, ...args: unknown[]) =>
          nativeSetTimeout(
            handler,
            timeout === 60_000 ? 1_000 : timeout,
            ...args,
          )) as typeof window.setTimeout;
        window.clearTimeout = ((handle?: number) =>
          nativeClearTimeout(handle)) as typeof window.clearTimeout;

        (window as any).google = {
          accounts: {
            id: {
              initialize(config: Record<string, unknown>) {
                initializeCount += 1;
                initializedConfig = config;
              },
              prompt() {
                promptCount += 1;
                const credential = `google-id-token-${promptCount}`;
                nativeSetTimeout(() => {
                  const callback = initializedConfig?.callback as
                    | ((response: { credential: string }) => void)
                    | undefined;
                  callback?.({ credential });
                }, 20);
              },
              cancel() {},
            },
          },
        };

        try {
          const { requestGoogleIdToken } = await import(paths.googleIdentity);
          const firstToken = await requestGoogleIdToken('google-client-id');
          const secondToken = await requestGoogleIdToken('google-client-id');
          return { ok: true, firstToken, secondToken, initializeCount, promptCount, message: '' };
        } catch (error) {
          return {
            ok: false,
            firstToken: '',
            secondToken: '',
            initializeCount,
            promptCount,
            message: error instanceof Error ? error.message : String(error),
          };
        } finally {
          window.setTimeout = nativeSetTimeout as typeof window.setTimeout;
          window.clearTimeout = nativeClearTimeout as typeof window.clearTimeout;
          delete (window as any).google;
        }
      },
      { paths: IMPORT_PATHS },
    );

    expect(result).toEqual({
      ok: true,
      firstToken: 'google-id-token-1',
      secondToken: 'google-id-token-2',
      initializeCount: 1,
      promptCount: 2,
      message: '',
    });
  });

  test('fails promptly when the Google prompt never returns a credential callback', async ({
    page,
  }) => {
    const result = await page.evaluate(
      async ({ paths }) => {
        let initializeCount = 0;
        let promptCount = 0;
        let cancelCount = 0;
        const nativeSetTimeout = window.setTimeout.bind(window);
        const nativeClearTimeout = window.clearTimeout.bind(window);
        window.setTimeout = ((handler: TimerHandler, timeout?: number, ...args: unknown[]) =>
          nativeSetTimeout(
            handler,
            timeout === 20_000 ? 10 : timeout,
            ...args,
          )) as typeof window.setTimeout;
        window.clearTimeout = ((handle?: number) =>
          nativeClearTimeout(handle)) as typeof window.clearTimeout;

        (window as any).google = {
          accounts: {
            id: {
              initialize() {
                initializeCount += 1;
              },
              prompt() {
                promptCount += 1;
              },
              cancel() {
                cancelCount += 1;
              },
            },
          },
        };

        try {
          const { requestGoogleIdToken } = await import(paths.googleIdentity);
          await requestGoogleIdToken('google-client-id');
          return { ok: true, initializeCount, promptCount, cancelCount, message: '' };
        } catch (error) {
          return {
            ok: false,
            initializeCount,
            promptCount,
            cancelCount,
            message: error instanceof Error ? error.message : String(error),
          };
        } finally {
          window.setTimeout = nativeSetTimeout as typeof window.setTimeout;
          window.clearTimeout = nativeClearTimeout as typeof window.clearTimeout;
          delete (window as any).google;
        }
      },
      { paths: IMPORT_PATHS },
    );

    expect(result).toEqual({
      ok: false,
      initializeCount: 1,
      promptCount: 1,
      cancelCount: 1,
      message:
        'Google One Tap did not open or return an id_token. Check FedCM permissions, disable blockers for this site, then retry.',
    });
  });

  test('reports a dismissed One Tap prompt without rendering a fallback dialog', async ({
    page,
  }) => {
    const result = await page.evaluate(
      async ({ paths }) => {
        let renderButtonCount = 0;
        (window as any).google = {
          accounts: {
            id: {
              initialize() {},
              prompt(listener?: (notification: Record<string, () => unknown>) => void) {
                listener?.({
                  isDismissedMoment: () => true,
                  getDismissedReason: () => 'credential_returned',
                });
              },
              renderButton() {
                renderButtonCount += 1;
              },
              cancel() {},
            },
          },
        };

        try {
          const { requestGoogleIdToken } = await import(paths.googleIdentity);
          await requestGoogleIdToken('dismissed-client-id');
          return {
            ok: true,
            renderButtonCount,
            dialogCount: document.querySelectorAll('[role="dialog"]').length,
            message: '',
          };
        } catch (error) {
          return {
            ok: false,
            renderButtonCount,
            dialogCount: document.querySelectorAll('[role="dialog"]').length,
            message: error instanceof Error ? error.message : String(error),
          };
        } finally {
          delete (window as any).google;
        }
      },
      { paths: IMPORT_PATHS },
    );

    expect(result).toEqual({
      ok: false,
      renderButtonCount: 0,
      dialogCount: 0,
      message: 'Google One Tap was dismissed (credential_returned)',
    });
  });

  test('cancels an abandoned One Tap request and allows the next request', async ({ page }) => {
    const result = await page.evaluate(
      async ({ paths }) => {
        let initializedConfig: Record<string, unknown> | null = null;
        let promptCount = 0;
        let cancelCount = 0;
        (window as any).google = {
          accounts: {
            id: {
              initialize(config: Record<string, unknown>) {
                initializedConfig = config;
              },
              prompt() {
                promptCount += 1;
                if (promptCount !== 2) return;
                const callback = initializedConfig?.callback as
                  | ((response: { credential: string }) => void)
                  | undefined;
                callback?.({ credential: 'replacement-id-token' });
              },
              cancel() {
                cancelCount += 1;
              },
            },
          },
        };

        try {
          const { cancelGoogleIdTokenRequest, requestGoogleIdToken } = await import(
            paths.googleIdentity
          );
          const abandoned = requestGoogleIdToken('google-client-id').catch((error: unknown) =>
            error instanceof Error ? error.message : String(error),
          );
          cancelGoogleIdTokenRequest();
          const cancelledMessage = await abandoned;
          const replacementToken = await requestGoogleIdToken('google-client-id');
          return { cancelledMessage, replacementToken, promptCount, cancelCount };
        } finally {
          delete (window as any).google;
        }
      },
      { paths: IMPORT_PATHS },
    );

    expect(result).toEqual({
      cancelledMessage: 'Google sign-in was cancelled',
      replacementToken: 'replacement-id-token',
      promptCount: 2,
      cancelCount: 2,
    });
  });
});
