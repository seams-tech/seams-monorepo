import { locale, t } from '@/marketing/i18n/browser';
import type { MessageKey } from '@/marketing/i18n/catalog';
import React from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Theme, useSeams, type HostedAuthMenuMode } from '@seams/wallet/react';
import { FrontendRuntimeProvider, FrontendSdkProvider } from '@/context/frontendRuntime';
import { SITE_APPEARANCE, SITE_THEME_TOKEN_OVERRIDES } from '@/context/siteThemeOverrides';
import { useSiteTheme } from '@/shared/hooks/useSiteTheme';
import {
  DEMO_THEME_PRESETS,
  demoIframeAppearance,
  demoReactTokens,
  demoThemePreset,
  type DemoThemeId,
} from '@/context/app-themes';
import { useDemoTheme } from '@/context/demoTheme';
import { HeroDemoCell } from './WalletDemoSlot';

function loadDemoPasskeyColumn() {
  return import('@/components/DemoPasskeyColumn').then(selectDemoPasskeyColumn);
}
function selectDemoPasskeyColumn(module: typeof import('@/components/DemoPasskeyColumn')) {
  return { default: module.DemoPasskeyColumn };
}
const DemoPasskeyColumnLazy = React.lazy(loadDemoPasskeyColumn);
const demoAppearance = { ...SITE_APPEARANCE, locale };
const demoPageNames = [t('login'), t('transactions'), t('accountRecovery')];
const demoThemeLabels: Record<DemoThemeId, MessageKey> = {
  paper: 'themePaper',
  carbon: 'themeCarbon',
  pastel: 'themePastel',
  'pastel-dark': 'themePastelDark',
};
type WalletDemoProps = { authDefaultModeWhenNoDetectedAccount?: HostedAuthMenuMode };

/* Grab-and-drag horizontal scrolling for a single-line chip row. Dragging only
   engages past a small threshold, so a plain click still selects a chip; the
   click that trails a real drag is swallowed on the way up. */
function useDragScroll<T extends HTMLElement>(): React.RefObject<T | null> {
  const ref = React.useRef<T>(null);

  React.useEffect(() => {
    const el = ref.current;
    if (!el) return;

    let startX = 0;
    let startScroll = 0;
    let down = false;
    let dragging = false;

    const onPointerDown = (event: PointerEvent) => {
      if (event.button !== 0) return;
      down = true;
      dragging = false;
      startX = event.clientX;
      startScroll = el.scrollLeft;
    };

    const onPointerMove = (event: PointerEvent) => {
      if (!down) return;
      const dx = event.clientX - startX;
      if (!dragging) {
        if (Math.abs(dx) < 4) return;
        dragging = true;
        el.classList.add('is-dragging');
        el.setPointerCapture(event.pointerId);
      }
      el.scrollLeft = startScroll - dx;
    };

    const onPointerEnd = (event: PointerEvent) => {
      if (dragging) {
        const swallowClick = (click: MouseEvent) => {
          click.stopPropagation();
          click.preventDefault();
        };
        el.addEventListener('click', swallowClick, true);
        window.setTimeout(() => el.removeEventListener('click', swallowClick, true), 0);
      }
      if (el.hasPointerCapture(event.pointerId)) el.releasePointerCapture(event.pointerId);
      down = false;
      dragging = false;
      el.classList.remove('is-dragging');
    };

    el.addEventListener('pointerdown', onPointerDown);
    el.addEventListener('pointermove', onPointerMove);
    el.addEventListener('pointerup', onPointerEnd);
    el.addEventListener('pointercancel', onPointerEnd);
    return () => {
      el.removeEventListener('pointerdown', onPointerDown);
      el.removeEventListener('pointermove', onPointerMove);
      el.removeEventListener('pointerup', onPointerEnd);
      el.removeEventListener('pointercancel', onPointerEnd);
    };
  }, []);

  return ref;
}

function WalletDemoContent({
  authDefaultModeWhenNoDetectedAccount,
}: WalletDemoProps): React.JSX.Element {
  const { seams, loginState } = useSeams();
  const [demoPage, setDemoPage] = React.useState(0);
  const { theme: demoTheme, setTheme: setDemoTheme } = useDemoTheme();
  const themeTrackRef = useDragScroll<HTMLDivElement>();
  const activePreset = demoThemePreset(demoTheme);
  const activeWalletId = loginState?.isLoggedIn ? loginState.walletId || '' : '';

  React.useEffect(() => {
    try {
      seams.config.setAppearance(demoIframeAppearance(activePreset, locale));
    } catch {}
  }, [seams, activePreset, loginState?.isLoggedIn, activeWalletId]);

  // The Transactions / Account recovery screens need an unlocked wallet,
  // mirroring the carousel's own page gating.
  const maxPage = loginState?.isLoggedIn ? demoPageNames.length - 1 : 0;

  return (
    <>
      <HeroDemoCell aria-label={t('demoEnglish')}>
        {locale === 'ja' ? <span className="h2-demo__language">{t('demoEnglish')}</span> : null}
        <Theme
          theme={activePreset.mode}
          tokens={demoReactTokens(activePreset)}
          tag="div"
          className="h2-demo-theme-root"
          style={{ display: 'contents' }}
        >
          {/* SDK card renders in its own px; scoped scaling keeps the designed
                hero proportion now that the page-level zoom is gone */}
          <div className="h2-sdk-zoom">
            <React.Suspense fallback={<div className="h2-demo__placeholder" />}>
              <DemoPasskeyColumnLazy
                currentPage={demoPage}
                onCurrentPageChange={setDemoPage}
                defaultModeWhenNoDetectedAccount={authDefaultModeWhenNoDetectedAccount}
              />
            </React.Suspense>
          </div>
        </Theme>
        <div className="h2-themeswitch">
          <div
            ref={themeTrackRef}
            className="h2-themeswitch__track"
            role="group"
            aria-label={t('previewTheme')}
          >
            {DEMO_THEME_PRESETS.map((theme) => (
              <button
                key={theme.id}
                type="button"
                className={`h2-themeswitch__btn${demoTheme === theme.id ? ' is-active' : ''}`}
                aria-pressed={demoTheme === theme.id}
                onClick={() => setDemoTheme(theme.id)}
              >
                <span className="h2-themeswitch__swatch" style={{ background: theme.swatch }} />
                {t(demoThemeLabels[theme.id])}
              </button>
            ))}
          </div>
        </div>
      </HeroDemoCell>

      {/* Pager lives at the split level so it sits on the divider/border junction */}
      <div className="h2-pager" role="group" aria-label={t('demoScreens')}>
        <button
          type="button"
          className="h2-pager__btn"
          aria-label={t('previousDemo')}
          disabled={demoPage === 0}
          onClick={() => setDemoPage((p) => Math.max(0, p - 1))}
        >
          <ChevronLeft aria-hidden />
        </button>
        <span className="h2-pager__dots">
          {demoPageNames.map((name, i) => (
            <span
              key={name}
              className={`h2-pager__dot${i === demoPage ? ' is-active' : ''}`}
              title={name}
            />
          ))}
        </span>
        <button
          type="button"
          className="h2-pager__btn"
          aria-label={t('nextDemo')}
          disabled={demoPage >= maxPage}
          onClick={() => setDemoPage((p) => Math.min(maxPage, p + 1))}
        >
          <ChevronRight aria-hidden />
        </button>
      </div>
    </>
  );
}

export default function WalletDemo(props: WalletDemoProps): React.JSX.Element {
  const { theme } = useSiteTheme();
  return (
    <FrontendRuntimeProvider>
      <FrontendSdkProvider
        appearance={demoAppearance}
        theme={{ theme, tokens: SITE_THEME_TOKEN_OVERRIDES }}
      >
        <WalletDemoContent {...props} />
      </FrontendSdkProvider>
    </FrontendRuntimeProvider>
  );
}
