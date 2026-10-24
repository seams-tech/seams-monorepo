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
import { H2Cta, H2Footer } from '@/components/h2/sections';
import NavbarCompact from '@/components/Navbar/NavbarCompact';
import { ArrowRightAnim } from '@/components/ArrowRightAnim';
import { useSiteRouter } from '@/app/router/useSiteRouter';
import { startSiteAnchorScroll } from '@/app/router/siteRouting';
import { CONTACT_SALES_TARGET } from '@/pages/pricing/planSignup';
import type { MessageKey } from './catalog';
import { t } from './i18n';
import { RegionalGlobe } from './RegionalGlobe';
import '@/styles/h2.css';
import './styles.css';

type Feature = {
  icon: LucideIcon;
  title: MessageKey;
  copy: MessageKey;
  status?: 'available' | 'planned';
};

/* The anchors the Products menu links to, in page order. */
const SECTIONS: readonly { id: string; label: MessageKey }[] = [
  { id: 'recovery', label: 'recoveryKicker' },
  { id: 'biometrics', label: 'biometricsKicker' },
  { id: 'global', label: 'globalKicker' },
  { id: 'self-hosted', label: 'selfHostedKicker' },
];

const RECOVERY: readonly Feature[] = [
  { icon: KeyRound, title: 'passkeySignIn', copy: 'passkeySignInCopy' },
  { icon: Mail, title: 'emailRecovery', copy: 'emailRecoveryCopy' },
  { icon: QrCode, title: 'deviceLinking', copy: 'deviceLinkingCopy' },
];

const BIOMETRICS: readonly Feature[] = [
  { icon: Fingerprint, title: 'passkeys', copy: 'passkeysCopy', status: 'available' },
  { icon: ScanFace, title: 'faceId', copy: 'faceIdCopy', status: 'available' },
  { icon: Mic, title: 'voiceId', copy: 'voiceIdCopy', status: 'planned' },
];

const SELF_HOSTED: readonly Feature[] = [
  { icon: Cloud, title: 'cloudflare', copy: 'cloudflareCopy' },
  { icon: Server, title: 'virtualMachines', copy: 'virtualMachinesCopy' },
  { icon: Unlock, title: 'openSource', copy: 'openSourceCopy' },
];

function FeatureCards({
  features,
  field,
}: {
  features: readonly Feature[];
  field: GrainFieldName;
}): React.JSX.Element {
  return (
    <ul className="features-cards">
      {features.map(({ icon: Icon, title, copy, status }) => (
        <li key={title} className="features-card">
          <div className="features-card__head">
            <span className="features-card__icon" aria-hidden>
              <GrainField field={field} playing={false} />
              <Icon size={18} strokeWidth={1.7} />
            </span>
            {status ? (
              <span className={`features-card__status features-card__status--${status}`}>
                {t(status)}
              </span>
            ) : null}
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
  kicker,
  title,
  copy,
}: {
  id: string;
  kicker: MessageKey;
  title: MessageKey;
  copy: MessageKey;
}): React.JSX.Element {
  return (
    <div className="h2-split-head">
      <p className="h2-kicker">{t(kicker)}</p>
      <h2 id={`${id}-title`} className="h2-display">
        {t(title)}
      </h2>
      <p className="h2-split-head__copy">{t(copy)}</p>
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

export function FeaturesPage(): React.JSX.Element {
  React.useEffect(startSiteAnchorScroll, []);

  return (
    <div className="h2-page">
      <NavbarCompact appearance="light" />
      <div className="h2-col">
        <main aria-labelledby="features-title">
          <header className="h2-hero-simple features-hero">
            <div className="h2-shell">
              <p className="h2-kicker">{t('featuresKicker')}</p>
              <h1 id="features-title" className="h2-display h2-hero-simple__title">
                {t('featuresTitle')}
              </h1>
              <p className="h2-hero-simple__sub">{t('featuresDescription')}</p>
              <nav className="features-toc" aria-label={t('sections')}>
                {SECTIONS.map((section) => (
                  <a key={section.id} href={`#${section.id}`}>
                    {t(section.label)}
                  </a>
                ))}
              </nav>
            </div>
          </header>

          <section
            id="recovery"
            className="h2-section h2-section--compact h2-rule features-anchor"
            aria-labelledby="recovery-title"
          >
            <div className="h2-shell">
              <SectionHead
                id="recovery"
                kicker="recoveryKicker"
                title="recoveryTitle"
                copy="recoveryCopy"
              />
              <FeatureCards features={RECOVERY} field="teal-peach" />
              <p className="features-note">{t('sameAddress')}</p>
            </div>
          </section>

          <section
            id="biometrics"
            className="h2-section h2-section--compact h2-rule features-anchor"
            aria-labelledby="biometrics-title"
          >
            <div className="h2-shell">
              <SectionHead
                id="biometrics"
                kicker="biometricsKicker"
                title="biometricsTitle"
                copy="biometricsCopy"
              />
              <FeatureCards features={BIOMETRICS} field="aqua-evergreen" />
              <div className="features-actions">
                <SiteLink
                  to="/docs/concepts/auth-methods/passkeys"
                  className="h2-btn h2-btn--outline"
                >
                  {t('readPasskeyDocs')}
                </SiteLink>
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
              <SectionHead
                id="self-hosted"
                kicker="selfHostedKicker"
                title="selfHostedTitle"
                copy="selfHostedCopy"
              />
              <FeatureCards features={SELF_HOSTED} field="slate-amber" />
              <div className="features-actions">
                <SiteLink to={CONTACT_SALES_TARGET} className="h2-btn h2-btn--primary">
                  {t('contactUs')}
                </SiteLink>
                <SiteLink to="/pricing/#enterprise" className="h2-btn h2-btn--outline">
                  {t('seePricing')}
                </SiteLink>
              </div>
            </div>
          </section>

          <H2Cta />
        </main>
        <H2Footer />
      </div>
    </div>
  );
}

export default FeaturesPage;
