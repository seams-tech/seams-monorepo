import React from 'react';
import { SiteNavbar, type NavbarStaticProps } from '@seams-internal/site-navbar';
import { ArrowRightAnim } from '../ArrowRightAnim';
import SeamsWordmark from '../icons/SeamsWordmark';
import { useSiteRouter } from '@/app/router/useSiteRouter';
import { createSiteNavbarConfig } from './navbarConfig';
import { useMarketingPage } from '@/marketing/context';
import { LanguageSelector } from '@/marketing/LanguageSelector';

export type { NavbarStaticProps };

export function NavbarStatic(props: NavbarStaticProps = {}): React.JSX.Element {
  const router = useSiteRouter();
  const { locale } = useMarketingPage();
  return (
    <SiteNavbar
      {...props}
      config={createSiteNavbarConfig(locale)}
      router={router}
      Wordmark={SeamsWordmark}
      Arrow={ArrowRightAnim}
      languageSelector={<LanguageSelector placement="navbar" />}
    />
  );
}

export default NavbarStatic;
