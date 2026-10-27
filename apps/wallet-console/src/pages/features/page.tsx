import React from 'react';
import { GrainField, type GrainFieldName } from '@seams-internal/grain-field';
import {
  Cloud,
  Fingerprint,
  KeyRound,
  Mail,
  Mic,
  QrCode,
  ScanFace,
  Server,
  Unlock,
  type LucideIcon,
} from 'lucide-react';
import { FieldBanner, H2Footer } from '@/components/h2/sections';
import NavbarCompact from '@/components/Navbar/NavbarCompact';
import { WalletFigure, type WalletFigureName } from '@/components/h2/WalletFigure';
import { ArrowRightAnim } from '@/components/ArrowRightAnim';
import { useSiteRouter } from '@/app/router/useSiteRouter';
import { startSiteAnchorScroll } from '@/app/router/siteRouting';
import { CONTACT_LINK_TARGET } from '@/components/contact/contactLink';
import type { MessageKey } from './catalog';
import { t } from './i18n';
import { RegionalGlobe } from './RegionalGlobe';
import '@/styles/h2.css';
import './styles.css';

type Feature = {
  icon: LucideIcon;
  title: MessageKey;
  copy: MessageKey;
};

/* The anchors the Features menu links to, in page order, each with its menu
   row's gradient. */
const SECTIONS: readonly { id: string; label: MessageKey; field: GrainFieldName }[] = [
  { id: 'recovery', label: 'recoveryKicker', field: 'teal-peach' },
  { id: 'biometrics', label: 'biometricsKicker', field: 'aqua-evergreen' },
  { id: 'global', label: 'globalKicker', field: 'azure-coral' },
  { id: 'self-hosted', label: 'selfHostedKicker', field: 'slate-amber' },
];

const RECOVERY: readonly Feature[] = [
  { icon: KeyRound, title: 'passkeySignIn', copy: 'passkeySignInCopy' },
  { icon: Mail, title: 'emailRecovery', copy: 'emailRecoveryCopy' },
  { icon: QrCode, title: 'deviceLinking', copy: 'deviceLinkingCopy' },
];

const BIOMETRICS: readonly Feature[] = [
  { icon: Fingerprint, title: 'passkeys', copy: 'passkeysCopy' },
  { icon: ScanFace, title: 'faceId', copy: 'faceIdCopy' },
  { icon: Mic, title: 'voiceId', copy: 'voiceIdCopy' },
];

const SELF_HOSTED: readonly Feature[] = [
  { icon: Cloud, title: 'cloudflare', copy: 'cloudflareCopy' },
  { icon: Server, title: 'virtualMachines', copy: 'virtualMachinesCopy' },
  { icon: Unlock, title: 'openSource', copy: 'openSourceCopy' },
];

// About one play of the front page's figures.
const FIGURE_PLAY_MS = 3600;
// The sign-in figure reads three blocks in turn, about 3.8 s, then holds.
const METHODS_PLAY_MS = 5000;

/* A large line figure from the front page. With `playMs` it plays once each
   time it comes into view, then rests; without it, it plays while it is in
   view. A visitor's hover plays it again. Reduced motion keeps it at rest. */
function FeatureFigure({
  figure,
  playMs,
  className,
}: {
  figure: WalletFigureName;
  playMs?: number;
  className?: string;
}): React.JSX.Element {
  const ref = React.useRef<HTMLElement>(null);
  const [playing, setPlaying] = React.useState(false);

  React.useEffect(() => {
    const panel = ref.current;
    if (!panel || !window.matchMedia('(prefers-reduced-motion: no-preference)').matches) {
      return undefined;
    }
    let timer = 0;
    const observer = new IntersectionObserver(
      ([entry]) => {
        window.clearTimeout(timer);
        setPlaying(entry.isIntersecting);
        if (entry.isIntersecting && playMs !== undefined) {
          timer = window.setTimeout(() => setPlaying(false), playMs);
        }
      },
      { threshold: 0.6 },
    );
    observer.observe(panel);
    return () => {
      observer.disconnect();
      window.clearTimeout(timer);
    };
  }, [playMs]);

  return (
    <figure ref={ref} className={className ? `features-figure ${className}` : 'features-figure'}>
      <WalletFigure figure={figure} playing={playing} hideSigningCaption />
    </figure>
  );
}

function FeatureCards({
  features,
  field,
  stacked = false,
}: {
  features: readonly Feature[];
  field: GrainFieldName;
  /* one card per row, beside a figure */
  stacked?: boolean;
}): React.JSX.Element {
  return (
    <ul className={stacked ? 'features-cards features-cards--stack' : 'features-cards'}>
      {features.map(({ icon: Icon, title, copy }) => (
        <li key={title} className="features-card">
          <div className="features-card__head">
            {/* the front page's beige icon tile, with the section's grain in grey */}
            <span className="h2-fieldtile" aria-hidden>
              <GrainField field={field} />
              <Icon size={18} strokeWidth={1.7} />
            </span>
          </div>
          <h3 className="features-card__title">{t(title)}</h3>
          <p className="features-card__copy">{t(copy)}</p>
        </li>
      ))}
    </ul>
  );
}

function SectionHead({
  id,
  title,
  copy,
}: {
  id: string;
  title: MessageKey;
  copy?: MessageKey;
}): React.JSX.Element {
  return (
    <div className="h2-split-head">
      <h2 id={`${id}-title`} className="h2-display">
        {t(title)}
      </h2>
      {copy ? <p className="h2-split-head__copy">{t(copy)}</p> : null}
    </div>
  );
}

function SiteLink({
  to,
  className,
  children,
}: {
  to: string;
  className: string;
  children: React.ReactNode;
}): React.JSX.Element {
  const { linkProps } = useSiteRouter();
  const props = linkProps(to);
  return (
    <a className={className} href={props.href} onClick={props.onClick}>
      {children}
      <ArrowRightAnim size={12} />
    </a>
  );
}

/* Closing call to action: the plans, on the site's moving banner. */
function PricingBanner(): React.JSX.Element {
  return (
    <section
      className="h2-section h2-section--banner h2-rule"
      aria-labelledby="features-pricing-title"
    >
      <FieldBanner field="teal-peach">
        <div>
          <h2 id="features-pricing-title" className="h2-display h2-banner__title">
            {t('pricingBannerTitle')}
          </h2>
          <p className="h2-banner__sub">{t('pricingBannerCopy')}</p>
        </div>
        <div className="h2-banner__actions">
          <SiteLink to="/dashboard" className="h2-btn h2-btn--outline">
            {t('startFree')}
          </SiteLink>
          <SiteLink to="/pricing/" className="h2-btn h2-btn--primary">
            {t('seePricing')}
          </SiteLink>
        </div>
      </FieldBanner>
    </section>
  );
}

export function FeaturesPage(): React.JSX.Element {
  React.useEffect(startSiteAnchorScroll, []);

  return (
    <div className="h2-page">
      <NavbarCompact appearance="light" />
      <div className="h2-col">
        <main aria-labelledby="features-title">
          <header className="h2-hero-simple features-hero">
            <div className="h2-shell features-hero__grid">
              <div>
                <h1 id="features-title" className="h2-display h2-hero-simple__title">
                  {t('featuresTitle')}
                </h1>
                <p className="h2-hero-simple__sub">{t('featuresDescription')}</p>
                {/* the front page's fork links, one gradient chip per section */}
                <nav className="h2-hero__forks" aria-label={t('sections')}>
                  {SECTIONS.map((section) => (
                    <a key={section.id} className="h2-fork" href={`#${section.id}`}>
                      <span className="h2-fork__chip" aria-hidden>
                        <GrainField field={section.field} />
                      </span>
                      {t(section.label)}
                    </a>
                  ))}
                </nav>
                <div className="h2-hero-simple__ctas">
                  <SiteLink to="/pricing/" className="h2-btn h2-btn--primary h2-btn--lg">
                    {t('seePricing')}
                  </SiteLink>
                </div>
              </div>
              <FeatureFigure figure="signing" className="features-figure--hero" />
            </div>
          </header>

          <section
            id="recovery"
            className="h2-section h2-section--compact h2-rule features-anchor"
            aria-labelledby="recovery-title"
          >
            <div className="h2-shell">
              <SectionHead id="recovery" title="recoveryTitle" />
              <div className="features-split">
                <FeatureFigure figure="devices" playMs={FIGURE_PLAY_MS} />
                <FeatureCards features={RECOVERY} field="teal-peach" stacked />
              </div>
            </div>
          </section>

          <section
            id="biometrics"
            className="h2-section h2-section--compact h2-rule features-anchor"
            aria-labelledby="biometrics-title"
          >
            <div className="h2-shell">
              <SectionHead id="biometrics" title="biometricsTitle" copy="biometricsCopy" />
              <div className="features-split">
                <div>
                  <FeatureCards features={BIOMETRICS} field="aqua-evergreen" stacked />
                  <div className="features-actions">
                    <SiteLink
                      to="/docs/concepts/auth-methods/passkeys"
                      className="h2-btn h2-btn--primary"
                    >
                      {t('readDocs')}
                    </SiteLink>
                  </div>
                </div>
                <FeatureFigure figure="methods" playMs={METHODS_PLAY_MS} />
              </div>
            </div>
          </section>

          <RegionalGlobe />

          <section
            id="self-hosted"
            className="h2-section h2-section--compact h2-rule features-anchor"
            aria-labelledby="self-hosted-title"
          >
            <div className="h2-shell">
              <SectionHead id="self-hosted" title="selfHostedTitle" copy="selfHostedCopy" />
              <div className="features-split">
                <div>
                  <FeatureCards features={SELF_HOSTED} field="slate-amber" stacked />
                  <div className="features-actions">
                    <SiteLink to="/pricing/#enterprise" className="h2-btn h2-btn--primary">
                      {t('seePricing')}
                    </SiteLink>
                    <SiteLink to={CONTACT_LINK_TARGET} className="h2-btn h2-btn--outline">
                      {t('contactUs')}
                    </SiteLink>
                  </div>
                </div>
                <FeatureFigure figure="infrastructure" playMs={FIGURE_PLAY_MS} />
              </div>
            </div>
          </section>

          <PricingBanner />
        </main>
        <H2Footer />
      </div>
    </div>
  );
}

export default FeaturesPage;
