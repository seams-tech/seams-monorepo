import React from 'react';
import { GrainField, type GrainFieldName } from '@seams-internal/grain-field';
import NavbarCompact from '@/components/Navbar/NavbarCompact';
import { ArrowRightAnim } from '@/components/ArrowRightAnim';
import { useSiteRouter } from '@/app/router/useSiteRouter';
import { H2Footer } from '@/components/h2/sections';
import '@/styles/h2.css';
import './styles.css';

/* Unknown routes: the wallet hero's layout, copy on the left and a grain
   panel on the right, with the same product forks under the actions. */

const destinations: readonly { label: string; to: string; field: GrainFieldName }[] = [
  { label: 'Wallet', to: '/wallet', field: 'teal-peach' },
  { label: 'Harness', to: '/ecommerce', field: 'mauve-ember' },
  { label: 'Pricing', to: '/pricing', field: 'sky-sand' },
  { label: 'API', to: '/docs/concepts/', field: 'azure-coral' },
];

export function NotFoundPage(): React.JSX.Element {
  const { linkProps } = useSiteRouter();
  const homeProps = linkProps('/');
  const docsProps = linkProps('/docs/');
  const pathname = typeof window === 'undefined' ? '' : window.location.pathname;

  return (
    <div className="h2-page">
      <NavbarCompact />
      <div className="h2-col">
        <main className="not-found" aria-labelledby="not-found-title">
          <div className="h2-shell not-found__grid">
            <div className="not-found__copy">
              <p className="h2-kicker">Error 404</p>
              <h1 id="not-found-title" className="h2-display not-found__title">
                This page does not exist
              </h1>
              <p className="not-found__sub">
                The link can be old, or the address can have a typo. Go back to the home page, or
                open one of the pages below.
              </p>
              {pathname ? (
                <p className="not-found__path">
                  <span>Requested</span>
                  <code>{pathname}</code>
                </p>
              ) : null}
              <div className="not-found__ctas">
                <a
                  className="h2-btn h2-btn--primary h2-btn--lg"
                  href={homeProps.href}
                  onClick={homeProps.onClick}
                >
                  Go to home
                  <ArrowRightAnim size={12} />
                </a>
                <a
                  className="h2-btn h2-btn--outline h2-btn--lg"
                  href={docsProps.href}
                  onClick={docsProps.onClick}
                >
                  Read the docs
                </a>
              </div>
              <nav className="not-found__forks" aria-label="Popular pages">
                {destinations.map((destination) => {
                  const destinationProps = linkProps(destination.to);
                  return (
                    <a
                      key={destination.label}
                      className="h2-fork"
                      href={destinationProps.href}
                      onClick={destinationProps.onClick}
                    >
                      <span className="h2-fork__chip" aria-hidden>
                        <GrainField field={destination.field} />
                      </span>
                      {destination.label}
                    </a>
                  );
                })}
              </nav>
            </div>

            <div className="not-found__panel" aria-hidden="true">
              <GrainField field="teal-peach" flow={1.6} />
              <span className="not-found__code">404</span>
            </div>
          </div>
        </main>
        <H2Footer />
      </div>
    </div>
  );
}

export default NotFoundPage;
