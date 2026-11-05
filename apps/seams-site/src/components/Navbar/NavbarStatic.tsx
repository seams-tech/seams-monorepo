import React from 'react';
import { SiteNavbar, type NavbarStaticProps } from '@seams-internal/site-navbar';
import { ArrowRightAnim } from '../ArrowRightAnim';
import SeamsWordmark from '../icons/SeamsWordmark';
import { useSiteRouter } from '@/app/router/useSiteRouter';
import { getSiteNavbarConfig } from './navbarConfig';
import { useLocale } from '@/i18n/browser';
import { LanguageSelector } from '@/i18n/LanguageSelector';

export type { NavbarStaticProps };

export function NavbarStatic(props: NavbarStaticProps = {}): React.JSX.Element {
  const router = useSiteRouter();
  const locale = useLocale();
  return (
    <SiteNavbar
      {...props}
      config={getSiteNavbarConfig(locale)}
      languageSelector={<LanguageSelector placement="navbar" />}
      router={router}
      Wordmark={SeamsWordmark}
      Arrow={ArrowRightAnim}
    />
  );
}

export default NavbarStatic;
