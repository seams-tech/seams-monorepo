import React from 'react';
import * as Select from '@radix-ui/react-select';
import { Check, ChevronDown, Languages } from 'lucide-react';
import { getWalletLanguageHref } from '@/app/router/siteRouting';
import { locale, t } from './i18n/browser';
import type { Locale } from './i18n/locale';

const languages: Record<Locale, string> = { en: 'English', ja: '日本語' };

function changeLanguage(value: string): void {
  if (value !== 'en' && value !== 'ja') return;
  window.location.assign(getWalletLanguageHref(value));
}

function LanguageOption({ language }: { language: Locale }): React.JSX.Element {
  return (
    <Select.Item className="wallet-language__option" value={language} lang={language}>
      <Select.ItemText>{languages[language]}</Select.ItemText>
      <Select.ItemIndicator>
        <Check size={16} strokeWidth={1.7} aria-hidden />
      </Select.ItemIndicator>
    </Select.Item>
  );
}

export function LanguageSelector(): React.JSX.Element {
  return (
    <Select.Root value={locale} onValueChange={changeLanguage}>
      <Select.Trigger className="wallet-language__trigger" aria-label={t('language')}>
        <Languages size={19} strokeWidth={1.7} aria-hidden />
        <Select.Value />
        <Select.Icon>
          <ChevronDown size={15} aria-hidden />
        </Select.Icon>
      </Select.Trigger>
      <Select.Portal>
        <Select.Content
          className="wallet-language__menu"
          position="popper"
          side="top"
          align="start"
          sideOffset={8}
          collisionPadding={16}
        >
          <Select.Viewport>
            <LanguageOption language="en" />
            <LanguageOption language="ja" />
          </Select.Viewport>
        </Select.Content>
      </Select.Portal>
    </Select.Root>
  );
}
