import React from 'react';
import { t } from '@core/i18n';
import { BookOpen } from 'lucide-react';
import { getActiveFrontendDeployment } from '@core/runtime';
import { useSiteRouter } from '@core/router/useSiteRouter';
import { DashboardAuthCard, type DashboardAuthProvider } from '@core/auth/DashboardAuthCard';
import SeamsWordmark from '@core/components/SeamsWordmark';
import { fetchGoogleAuthOptions } from '@core/auth/googleIdentity';
import {
  rememberStepUpEnrollmentProof,
  takeStepUpEnrollmentReturn,
} from '@core/auth/stepUpEnrollmentProof';
import {
  beginGithubOAuth,
  consumeGithubOAuthCallback,
  fetchGithubOAuthOptions,
  finishGithubOAuthPopup,
  isGithubOAuthPopup,
  onGithubOAuthPopupSignIn,
  openGithubOAuthPopup,
  type GithubOAuthOptions,
} from '@core/auth/githubOAuth';
import {
  canDashboardManageBilling,
  readDashboardConsoleSignOut,
  clearDashboardConsoleSignOut,
  fetchDashboardConsoleSession,
} from '../consoleSession';
import { readUnscopedConsoleSession } from '../routes/onboarding/initialOrganizationApi';
import { listDashboardAccountOrganizations } from '../routes/account-settings/consoleAccountApi';
import {
  consoleSignInHref,
  rememberConsoleContext,
  readConsoleSignInContext,
  walletConsoleHref,
} from '../consoleNavigation';
import { readPendingDashboardInvitation } from '../routes/invitations/invitation';
import { getDashboardBillingPlan, startDashboardCardSetup } from '../routes/billing/freePlanApi';
import {
  captureDashboardPlanIntentLink,
  clearPendingDashboardPlanIntent,
  prepareDashboardAccountForPlan,
  readDashboardOverviewHref,
  readPendingDashboardPlanIntent,
  selectDashboardPlanContext,
  dashboardPlanAttribution,
  recordDashboardLoginView,
  recordDashboardFunnelStep,
  type DashboardPlanChoice,
} from '../routes/billing/planIntent';
import { isEmbeddedSignIn, postToWalletSite } from './embeddedSignIn';
import '../styles.css';
import './embeddedSignIn.css';

function normalizeBaseUrl(input: unknown): string {
  return String(input || '')
    .trim()
    .replace(/\/+$/, '');
}

function loginDestination(pathname: '/dashboard' | '/dashboard/onboarding'): string {
  if (import.meta.env.MODE === 'platform' && readPendingDashboardInvitation()) {
    return consoleSignInHref('/dashboard/invitations/accept');
  }
  return consoleSignInHref(pathname);
}

/* The page in a whole tab, in the pricing page's sign-in dialog, or in the GitHub popup
   that the dialog opens. */
type LoginPresentation = 'page' | 'embedded' | 'github_popup';

function readLoginPresentation(): LoginPresentation {
  if (isEmbeddedSignIn()) return 'embedded';
  return isGithubOAuthPopup() ? 'github_popup' : 'page';
}

/* A plan picked on the pricing page ends in Wallet Console: Stripe returns to its
   dashboard, where this session is. Platform Console keeps its plan page. */
const PLAN_RETURN_PAGE = import.meta.env.MODE === 'wallet' ? 'dashboard' : 'plan_page';

/** The login text for a visitor who picked a plan on the pricing page. */
const PLAN_LOGIN_TEXT: Record<DashboardPlanChoice, { title: string; description: string }> = {
  free: {
    title: t('loginPlanFreeTitle'),
    description: t('loginPlanFreeDescription'),
  },
  growth: {
    title: t('loginPlanGrowthTitle'),
    description: t('loginPlanGrowthDescription'),
  },
  pro: {
    title: t('loginPlanProTitle'),
    description: t('loginPlanProDescription'),
  },
};

type DashboardLoginExchangeResponse =
  | {
      readonly ok: true;
      readonly kind: 'console_identity_v1' | 'console_session_v1';
      readonly enrollmentProof: string;
    }
  | { readonly ok: false; readonly message: string };

function dashboardLoginPlainObject(raw: unknown): object | null {
  return raw !== null && typeof raw === 'object' && !Array.isArray(raw) ? raw : null;
}

function dashboardLoginOwnValue(raw: object, field: string): unknown {
  return Reflect.get(raw, field);
}

function dashboardLoginExactObject(raw: unknown, expectedFields: readonly string[]): object | null {
  const object = dashboardLoginPlainObject(raw);
  if (!object) return null;
  const actualFields = Object.keys(object);
  if (actualFields.length !== expectedFields.length) return null;
  return actualFields.every((field) => expectedFields.includes(field)) ? object : null;
}

function parseDashboardLoginExchangeResponse(raw: unknown): DashboardLoginExchangeResponse | null {
  const object = dashboardLoginPlainObject(raw);
  if (!object) return null;
  const ok = dashboardLoginOwnValue(object, 'ok');
  if (ok === true) {
    const response = dashboardLoginExactObject(raw, ['ok', 'session', 'enrollmentProof']);
    const session =
      response && dashboardLoginExactObject(dashboardLoginOwnValue(response, 'session'), ['kind']);
    const kind = session && dashboardLoginOwnValue(session, 'kind');
    const enrollmentProof = response && dashboardLoginOwnValue(response, 'enrollmentProof');
    if (kind !== 'console_identity_v1' && kind !== 'console_session_v1') return null;
    if (typeof enrollmentProof !== 'string' || !enrollmentProof) return null;
    return { ok: true, kind, enrollmentProof };
  }
  if (ok !== false) return null;
  const response = dashboardLoginExactObject(raw, ['ok', 'code', 'message']);
  if (!response) return null;
  const message = dashboardLoginOwnValue(response, 'message');
  return typeof message === 'string' ? { ok: false, message: message.trim() } : null;
}

async function parseDashboardLoginExchangeBody(
  response: Response,
): Promise<DashboardLoginExchangeResponse | null> {
  const value: unknown = await response.json().catch(() => null);
  return parseDashboardLoginExchangeResponse(value);
}

type DashboardLoginCommand =
  | { readonly kind: 'google'; readonly idToken: string }
  | { readonly kind: 'github'; readonly code: string };

function assertNeverDashboardLogin(command: never): never {
  throw new Error(`Unsupported dashboard login command: ${String(command)}`);
}

async function exchangeDashboardSession(
  relayerBaseUrl: string,
  command: DashboardLoginCommand,
): Promise<'console_identity_v1' | 'console_session_v1'> {
  let path: string;
  let body: { readonly idToken: string } | { readonly code: string };
  let providerLabel: string;
  switch (command.kind) {
    case 'google':
      path = '/console/auth/google';
      body = { idToken: command.idToken };
      providerLabel = 'Google';
      break;
    case 'github':
      path = '/console/auth/github';
      body = { code: command.code };
      providerLabel = 'GitHub';
      break;
    default:
      return assertNeverDashboardLogin(command);
  }
  const response = await fetch(`${relayerBaseUrl}${path}`, {
    method: 'POST',
    credentials: 'include',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify(loginBodyWithIntent(body)),
  });
  const responseBody = await parseDashboardLoginExchangeBody(response);
  if (!response.ok || responseBody?.ok !== true) {
    const message = responseBody?.ok === false ? responseBody.message : '';
    if (command.kind === 'google' && (response.status === 400 || response.status === 401)) {
      console.debug('[Console sign-in] Google verification failed', {
        status: response.status,
        message,
      });
      throw new Error(t('loginGoogleNotVerified'));
    }
    throw new Error(message || `${providerLabel} session exchange failed (${response.status})`);
  }
  rememberStepUpEnrollmentProof(responseBody.enrollmentProof);
  clearDashboardConsoleSignOut();
  return responseBody.kind;
}

function loginBodyWithIntent(
  body: { readonly idToken: string } | { readonly code: string },
): object {
  const intent = readPendingDashboardInvitation() ? null : readPendingDashboardPlanIntent();
  return intent ? { ...body, planIntent: dashboardPlanAttribution(intent) } : body;
}

function authConfigurationNote(input: {
  googleConfigured: boolean;
  githubConfigured: boolean;
}): string {
  if (input.googleConfigured && input.githubConfigured) return '';
  if (!input.googleConfigured && !input.githubConfigured) {
    return t('loginConfigureBoth');
  }
  return input.googleConfigured ? t('loginConfigureGithub') : t('loginConfigureGoogle');
}

export function DashboardLoginPage(): React.JSX.Element {
  const { go, linkProps } = useSiteRouter();
  const homeProps = linkProps('https://seams.sh/');
  const docsProps = linkProps('/docs');
  const contactProps = linkProps('https://seams.sh/#contact');
  const relayerBaseUrl = React.useMemo(() => {
    const deployment = getActiveFrontendDeployment();
    return normalizeBaseUrl(deployment.consoleBaseUrl || deployment.relayerUrl);
  }, []);
  const githubLogin = React.useRef<ReturnType<typeof exchangeDashboardSession> | null>(null);
  const googleLogin = React.useRef<ReturnType<typeof exchangeDashboardSession> | null>(null);
  const [googleClientId, setGoogleClientId] = React.useState<string>('');
  const [githubOptions, setGithubOptions] = React.useState<GithubOAuthOptions>({
    configured: false,
  });
  const [initializing, setInitializing] = React.useState<boolean>(true);
  const [providerOptionsLoaded, setProviderOptionsLoaded] = React.useState(false);
  const [loadingProvider, setLoadingProvider] = React.useState<'google' | 'github' | null>(null);
  const [errorMessage, setErrorMessage] = React.useState<string>('');
  const [googleConfigured, setGoogleConfigured] = React.useState<boolean>(false);
  const [signedOut, setSignedOut] = React.useState<boolean>(false);
  const [presentation] = React.useState(readLoginPresentation);
  const [githubPopupSignedIn, setGithubPopupSignedIn] = React.useState(false);
  const embeddedRef = React.useRef<HTMLElement | null>(null);
  const githubPopupStarted = React.useRef(false);
  // A pending invitation wins over a plan picked on the pricing page.
  const [planIntent] = React.useState(() =>
    presentation === 'github_popup' ? null : captureDashboardPlanIntentLink(),
  );
  const [preparingPlan, setPreparingPlan] = React.useState<'setup' | 'stripe' | 'dashboard' | null>(
    null,
  );

  React.useEffect(rememberConsoleContext, []);
  React.useEffect(recordDashboardLoginView, []);

  /* In the dialog, the company site opens the next page in the whole tab. */
  const openPage = React.useCallback(
    (href: string) => {
      const url = new URL(href, window.location.origin);
      if (presentation === 'embedded') postToWalletSite({ kind: 'navigate', url: url.href });
      else if (url.origin === window.location.origin) go(`${url.pathname}${url.search}${url.hash}`);
      else window.location.assign(url.href);
    },
    [go, presentation],
  );

  /* After sign-in, a visitor with a plan intent gets an organization and a first project
     with default names. A Growth or Pro intent on a Free organization without a card goes
     straight to Stripe. A saved card opens the plan page for confirmation. Free opens
     the Wallet overview. Multiple organizations require a selection first. */
  const continueSignedIn = React.useCallback(
    async (pathname: '/dashboard' | '/dashboard/onboarding') => {
      const enrollmentReturn = takeStepUpEnrollmentReturn();
      if (pathname === '/dashboard' && enrollmentReturn) {
        openPage(enrollmentReturn);
        return;
      }
      const intent = readPendingDashboardPlanIntent();
      if (readPendingDashboardInvitation()) clearPendingDashboardPlanIntent();
      else if (intent) {
        setPreparingPlan('setup');
        try {
          const organizations = await listDashboardAccountOrganizations();
          if (organizations.length > 1) {
            openPage('/dashboard/billing/plan?choose_org=1');
            return;
          }
          await prepareDashboardAccountForPlan(intent, relayerBaseUrl);
          await recordDashboardFunnelStep('plan_ready', intent);
          const claims = await fetchDashboardConsoleSession();
          if (intent.plan !== 'free' && canDashboardManageBilling(claims)) {
            const plan = await getDashboardBillingPlan();
            if (plan?.plan === 'free' && plan.card.kind !== 'usable') {
              setPreparingPlan('stripe');
              const checkoutUrl = await startDashboardCardSetup(intent.plan, PLAN_RETURN_PAGE);
              // Only the plan page reads the intent after Stripe.
              if (PLAN_RETURN_PAGE === 'dashboard') {
                await selectDashboardPlanContext();
              }
              openPage(checkoutUrl);
              return;
            }
          }
          if (PLAN_RETURN_PAGE === 'dashboard' && intent.plan === 'free') {
            setPreparingPlan('dashboard');
            clearPendingDashboardPlanIntent();
            openPage((await readDashboardOverviewHref()) ?? walletConsoleHref('/dashboard'));
            return;
          }
          openPage('/dashboard/billing/plan');
        } catch (error: unknown) {
          const message = error instanceof Error ? error.message : String(error);
          setErrorMessage(`Account setup failed: ${message}. Reload the page to try again.`);
          // The plan page retains the intent and offers retry or Continue on Free.
          if (
            await fetchDashboardConsoleSession().then(
              () => true,
              () => false,
            )
          ) {
            openPage('/dashboard/billing/plan?setup_failed=1');
          }
        }
        setPreparingPlan(null);
        return;
      }
      openPage(loginDestination(pathname));
    },
    [openPage, relayerBaseUrl],
  );

  /* Continue an existing workspace or resume organization setup on this origin. */
  const resumeSignedInSession = React.useCallback(
    async (isCancelled: () => boolean): Promise<void> => {
      const scoped = await fetchDashboardConsoleSession().then(
        () => true,
        () => false,
      );
      if (isCancelled()) return;
      if (scoped) return await continueSignedIn('/dashboard');
      const unscoped = await readUnscopedConsoleSession(relayerBaseUrl).catch(() => false);
      const requested = readConsoleSignInContext();
      if (unscoped && !isCancelled() && !requested.organization && !requested.project) {
        await continueSignedIn('/dashboard/onboarding');
      }
    },
    [continueSignedIn, relayerBaseUrl],
  );

  React.useEffect(() => {
    let cancelled = false;
    /* Arriving here from an explicit sign-out: never auto-resume, even if the
       session still validates (a revoke can fail server-side). Otherwise the
       user is thrown straight back into the console they just left. */
    if (readDashboardConsoleSignOut()) {
      setSignedOut(true);
      setInitializing(false);
      return () => {
        cancelled = true;
      };
    }
    // The GitHub popup only signs in; the dialog that opened it continues.
    if (presentation === 'github_popup') {
      setInitializing(false);
      return () => {
        cancelled = true;
      };
    }
    void resumeSignedInSession(() => cancelled).finally(() => {
      if (!cancelled) setInitializing(false);
    });
    return () => {
      cancelled = true;
    };
  }, [presentation, resumeSignedInSession]);

  React.useEffect(() => {
    if (presentation !== 'embedded') return;
    let cancelled = false;
    const stop = onGithubOAuthPopupSignIn(() => {
      setLoadingProvider('github');
      void resumeSignedInSession(() => cancelled).finally(() => {
        if (!cancelled) setLoadingProvider(null);
      });
    });
    return () => {
      cancelled = true;
      stop();
    };
  }, [presentation, resumeSignedInSession]);

  /* The dialog sizes its frame to this page. */
  React.useEffect(() => {
    const element = embeddedRef.current;
    if (presentation !== 'embedded' || !element) return;
    const report = () =>
      postToWalletSite({ kind: 'height', height: Math.ceil(element.scrollHeight) });
    report();
    const observer = new ResizeObserver(report);
    observer.observe(element);
    return () => observer.disconnect();
  }, [presentation]);

  React.useEffect(() => {
    let cancelled = false;
    const run = async () => {
      if (!relayerBaseUrl) {
        if (!cancelled) {
          setGoogleConfigured(false);
          setGithubOptions({ configured: false });
          setProviderOptionsLoaded(true);
        }
        return;
      }
      const [googleResult, githubResult] = await Promise.allSettled([
        fetchGoogleAuthOptions(relayerBaseUrl),
        fetchGithubOAuthOptions(relayerBaseUrl),
      ]);
      if (cancelled) return;
      if (googleResult.status === 'fulfilled') {
        setGoogleClientId(googleResult.value.clientId || '');
        setGoogleConfigured(googleResult.value.configured);
      }
      if (githubResult.status === 'fulfilled') {
        setGithubOptions(githubResult.value);
      }
      setProviderOptionsLoaded(true);
    };
    void run();
    window.addEventListener('focus', run);
    window.addEventListener('online', run);
    return () => {
      cancelled = true;
      window.removeEventListener('focus', run);
      window.removeEventListener('online', run);
    };
  }, [relayerBaseUrl]);

  React.useEffect(() => {
    if (!relayerBaseUrl) {
      return;
    }
    if (githubLogin.current === null) {
      const callback = consumeGithubOAuthCallback();
      if (callback.kind === 'none') return;
      if (callback.kind === 'error') {
        setErrorMessage(callback.message);
        return;
      }
      // OAuth codes are single-use; effect replay must observe the same exchange.
      githubLogin.current = exchangeDashboardSession(relayerBaseUrl, {
        kind: 'github',
        code: callback.code,
      });
    }
    let cancelled = false;
    setLoadingProvider('github');
    setErrorMessage('');
    githubLogin.current
      .then(async (kind) => {
        if (cancelled) return;
        if (presentation === 'github_popup') {
          setGithubPopupSignedIn(true);
          finishGithubOAuthPopup();
          return;
        }
        if (kind === 'console_identity_v1') {
          await continueSignedIn('/dashboard/onboarding');
          return;
        }
        await fetchDashboardConsoleSession();
        if (!cancelled) await continueSignedIn('/dashboard');
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setErrorMessage(error instanceof Error ? error.message : String(error));
        }
      })
      .finally(() => {
        if (!cancelled) setLoadingProvider(null);
      });
    return () => {
      cancelled = true;
    };
  }, [continueSignedIn, presentation, relayerBaseUrl]);

  /* The popup goes on to GitHub at once; GitHub returns to it without `github_popup`. */
  React.useEffect(() => {
    if (presentation !== 'github_popup' || githubPopupStarted.current) return;
    if (!githubOptions.configured) return;
    if (!new URLSearchParams(window.location.search).has('github_popup')) return;
    githubPopupStarted.current = true;
    beginGithubOAuth(githubOptions);
  }, [githubOptions, presentation]);

  const onGoogleCredential = React.useCallback(
    async (idToken: string) => {
      if (googleLogin.current || loadingProvider) return;
      setLoadingProvider('google');
      setErrorMessage('');
      try {
        if (!relayerBaseUrl) {
          throw new Error('Relayer base URL is not configured');
        }
        if (!googleClientId) {
          throw new Error('Google client ID is not configured on the Router API server');
        }
        if (!googleConfigured) {
          throw new Error('Google OIDC is not configured on the Router API server');
        }

        rememberConsoleContext();
        googleLogin.current = exchangeDashboardSession(relayerBaseUrl, { kind: 'google', idToken });
        const kind = await googleLogin.current;
        if (kind === 'console_identity_v1') {
          await continueSignedIn('/dashboard/onboarding');
          return;
        }

        await fetchDashboardConsoleSession();
        await continueSignedIn('/dashboard');
      } catch (error: unknown) {
        setErrorMessage(error instanceof Error ? error.message : String(error));
      } finally {
        googleLogin.current = null;
        setLoadingProvider(null);
      }
    },
    [continueSignedIn, googleClientId, googleConfigured, loadingProvider, relayerBaseUrl],
  );

  const googleLabel = initializing
    ? t('loginGoogleCheckingSession')
    : loadingProvider === 'google'
      ? t('loginGoogleSigningIn')
      : !googleClientId
        ? t('loginGoogleUnavailable')
        : !googleConfigured
          ? t('loginGoogleNotConfigured')
          : t('loginGoogleContinue');

  const onGithubSignIn = React.useCallback(() => {
    if (loadingProvider || !githubOptions.configured) return;
    setErrorMessage('');
    rememberConsoleContext();
    if (presentation !== 'embedded') {
      beginGithubOAuth(githubOptions);
      return;
    }
    const popup = openGithubOAuthPopup();
    if (!popup) {
      setErrorMessage(t('loginGithubPopupBlocked'));
      return;
    }
    setLoadingProvider('github');
    const watch = window.setInterval(() => {
      if (!popup.closed) return;
      window.clearInterval(watch);
      setLoadingProvider((current) => (current === 'github' ? null : current));
    }, 500);
  }, [githubOptions, loadingProvider, presentation]);

  const githubLabel =
    loadingProvider === 'github'
      ? t('loginGithubSigningIn')
      : githubOptions.configured
        ? t('loginGithubContinue')
        : t('loginGithubUnavailable');
  const authBusy = initializing || preparingPlan !== null || loadingProvider !== null;
  const providers: readonly DashboardAuthProvider[] = [
    {
      id: 'google',
      label: googleLabel,
      disabled: authBusy || !googleConfigured,
      clientId: googleClientId,
      oneTap: signedOut ? 'disabled' : 'enabled',
      onCredential: onGoogleCredential,
      onError: setErrorMessage,
    },
    {
      id: 'github',
      label: githubLabel,
      disabled: authBusy || !githubOptions.configured,
      onContinue: onGithubSignIn,
    },
  ];
  const footerNote = authConfigurationNote({
    googleConfigured,
    githubConfigured: githubOptions.configured,
  });
  /* The dialog shows one card of one size: the plan title stays, and the buttons
     show only after the session check and the provider options and before the
     account setup, so a signed-in visitor never sees them. Only the status line
     changes. */
  const embedded = presentation === 'embedded';
  const embeddedBusy = embedded && preparingPlan !== null;
  const embeddedProvidersHidden =
    embeddedBusy || (embedded && (initializing || !providerOptionsLoaded));
  const authCard = (
    <DashboardAuthCard
      classNames={{
        root: 'dashboard-login__form',
        header: 'dashboard-login__form-header',
        heading: 'dashboard-login__form-heading',
        copy: 'dashboard-login__form-copy',
        ctaGroup: embeddedProvidersHidden
          ? 'dashboard-login__provider-buttons dashboard-login__provider-buttons--hidden'
          : 'dashboard-login__provider-buttons',
        ctaButton: 'dashboard-login__auth-button',
        ctaIcon: 'dashboard-login__auth-button-icon',
        note: 'dashboard-login__form-note',
        error: 'dashboard-login__form-error',
      }}
      titleId="dashboard-login-title"
      title={
        presentation === 'github_popup'
          ? githubPopupSignedIn
            ? t('loginTitleGithubSignedIn')
            : t('loginGithubContinue')
          : preparingPlan && !embedded
            ? t('loginTitleSettingUp')
            : signedOut
              ? t('loginTitleSignedOut')
              : planIntent
                ? PLAN_LOGIN_TEXT[planIntent.plan].title
                : t('loginTitleWelcomeBack')
      }
      description={
        presentation === 'github_popup'
          ? githubPopupSignedIn
            ? t('loginDescriptionCloseWindow')
            : t('loginDescriptionOpeningGithub')
          : preparingPlan === 'stripe'
            ? t('loginDescriptionOpeningStripe')
            : preparingPlan === 'dashboard'
              ? t('loginDescriptionOpeningDashboard')
              : preparingPlan === 'setup'
                ? t('loginDescriptionCreatingProject')
                : signedOut
                  ? t('loginDescriptionSignedOut')
                  : planIntent
                    ? PLAN_LOGIN_TEXT[planIntent.plan].description
                    : t('loginDescriptionSignIn')
      }
      providers={presentation === 'github_popup' ? [] : providers}
      note={
        (presentation === 'github_popup' && githubOptions.configured) || embeddedProvidersHidden
          ? ''
          : footerNote
      }
      errorMessage={errorMessage}
    />
  );

  if (presentation !== 'page') {
    return (
      <main
        ref={embeddedRef}
        className={
          presentation === 'github_popup'
            ? 'dashboard-login-embedded dashboard-login-embedded--popup'
            : 'dashboard-login-embedded'
        }
        aria-label={t('loginAriaSignIn')}
      >
        {/* The card fades in once; later states change only the status line. */}
        <div className="dashboard-login-embedded__state">{authCard}</div>
      </main>
    );
  }

  return (
    <main className="dashboard-login" aria-label={t('loginAriaPage')}>
      {/* Split layout: the sign-in column carries the whole flow, the aside is
          static product framing that collapses away under 900px. */}
      <section className="dashboard-login__panel">
        <a
          className="dashboard-login__brand"
          href={homeProps.href}
          onClick={homeProps.onClick}
          aria-label={t('loginAriaHome')}
        >
          <SeamsWordmark height={24} />
          <span className="dashboard-login__brand-label">{t('loginBrandLabel')}</span>
        </a>
        <div className="dashboard-login__body">{authCard}</div>
        <p className="dashboard-login__legal">
          {t('loginNoAccess')}{' '}
          <a href={contactProps.href} onClick={contactProps.onClick}>
            {t('loginContactSales')}
          </a>
          .
        </p>
      </section>
      <aside className="dashboard-login__aside" aria-label={t('loginAriaAbout')}>
        <a
          className="dashboard-login__aside-link"
          href={docsProps.href}
          onClick={docsProps.onClick}
        >
          <BookOpen size={16} aria-hidden />
          <span>{t('loginDocumentation')}</span>
        </a>
        <div className="dashboard-login__aside-body">
          <p className="dashboard-login__statement">{t('loginStatement')}</p>
          <p className="dashboard-login__statement-sub">{t('loginStatementSub')}</p>
          <span className="dashboard-login__aside-mark">
            <SeamsWordmark height={20} />
          </span>
        </div>
      </aside>
    </main>
  );
}

export default DashboardLoginPage;
