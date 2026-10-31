import React from 'react';
import { BrowserOnly } from '@/marketing/BrowserOnly';
import { useTranslation } from '@/marketing/context';
import { FieldBanner } from '@/components/h2/sections';
import './component-showcase.css';

async function loadShowcase() {
  const module = await import('./ComponentShowcase');
  return { default: module.ComponentShowcase };
}

const LiveShowcase = React.lazy(loadShowcase);

export function ComponentShowcaseIntro(): React.JSX.Element {
  const t = useTranslation();
  return (
    <section id="components" className="component-showcase__intro h2-rule">
      <FieldBanner field="teal-peach">
        <div>
          <h2 id="component-showcase-title" className="h2-display h2-eco__title h2-banner__title">
            {t('componentsTitle')}
          </h2>
        </div>
      </FieldBanner>
    </section>
  );
}

export function ComponentShowcase(): React.JSX.Element {
  const placeholder = (
    <div className="component-showcase h2-rule">
      <div className="component-showcase__viewport" />
    </div>
  );
  return (
    <>
      <ComponentShowcaseIntro />
      <BrowserOnly fallback={placeholder}>
        <React.Suspense fallback={placeholder}>
          <LiveShowcase />
        </React.Suspense>
      </BrowserOnly>
    </>
  );
}
