import React from 'react';
import { SiteNavbar, type NavbarStaticProps } from '@seams-internal/site-navbar';
import { ArrowRightAnim } from '../ArrowRightAnim';
import SeamsWordmark from '../icons/SeamsWordmark';
import { useSiteRouter } from '@/app/router/useSiteRouter';
import { getSiteNavbarConfig } from './navbarConfig';
import { useSitePage } from '@/i18n/browser';
import { LanguageSelector } from '@/i18n/LanguageSelector';

export type { NavbarStaticProps };

export function NavbarStatic(props: NavbarStaticProps = {}): React.JSX.Element {
  const router = useSiteRouter();
  const page = useSitePage();
  return (
    <SiteNavbar
      {...props}
      config={getSiteNavbarConfig(page.locale)}
      languageSelector={
        page.kind === 'translated' ? <LanguageSelector page={page.page} placement="navbar" /> : null
      }
      router={router}
      Wordmark={SeamsWordmark}
      Arrow={ArrowRightAnim}
    />
  );
}

export default NavbarStatic;
