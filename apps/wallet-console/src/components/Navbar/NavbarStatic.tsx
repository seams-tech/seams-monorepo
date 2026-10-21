import React from 'react';
import { SiteNavbar, type NavbarStaticProps } from '@seams-internal/site-navbar';
import { ArrowRightAnim } from '../ArrowRightAnim';
import SeamsWordmark from '../icons/SeamsWordmark';
import { useSiteRouter } from '@/app/router/useSiteRouter';
import { siteNavbarConfig } from './navbarConfig';
import { LanguageSelector } from '@/marketing/LanguageSelector';

export type { NavbarStaticProps };

export function NavbarStatic(props: NavbarStaticProps = {}): React.JSX.Element {
  const router = useSiteRouter();
  return (
    <SiteNavbar
      {...props}
      config={siteNavbarConfig}
      router={router}
      Wordmark={SeamsWordmark}
      Arrow={ArrowRightAnim}
      languageSelector={<LanguageSelector placement="navbar" />}
    />
  );
}

export default NavbarStatic;
