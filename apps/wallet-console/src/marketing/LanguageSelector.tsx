import React from 'react';
import * as Select from '@radix-ui/react-select';
import { Check, ChevronDown, Languages } from 'lucide-react';
import { getWalletLanguageHref } from '@/app/router/siteRouting';
import { locale, t } from './i18n/browser';
import type { Locale } from './i18n/locale';

const languages: Record<Locale, { label: string; description: string | null }> = {
  en: { label: 'English', description: null },
  ja: { label: '日本語', description: 'Japanese' },
};

function changeLanguage(value: string): void {
  if (value !== 'en' && value !== 'ja') return;
  window.location.assign(getWalletLanguageHref(value));
}

function LanguageFlag({ language }: { language: Locale }): React.JSX.Element {
  if (language === 'ja') {
    return (
      <svg className="wallet-language__flag" viewBox="0 0 26 26" aria-hidden>
        <circle cx="13" cy="13" r="13" fill="#f0efed" />
        <circle cx="13" cy="13" r="5.5" fill="#bc002d" />
      </svg>
    );
  }
  return (
    <svg className="wallet-language__flag" viewBox="0 0 26 26" aria-hidden>
      <path fill="#fff" d="M0 0h26v26H0z" />
      <path
        stroke="#b31942"
        strokeWidth="2"
        d="M0 1h26M0 5h26M0 9h26M0 13h26M0 17h26M0 21h26M0 25h26"
      />
      <path fill="#0a3161" d="M0 0h13v14H0z" />
      <path
        stroke="#fff"
        strokeWidth="1"
        strokeLinecap="round"
        d="M2 3h0M6 3h0M10 3h0M4 6h0M8 6h0M2 9h0M6 9h0M10 9h0M4 12h0M8 12h0"
      />
    </svg>
  );
}

function LanguageOption({ language }: { language: Locale }): React.JSX.Element {
  const { label, description } = languages[language];
  return (
    <Select.Item
      className="wallet-language__option"
      value={language}
      textValue={label}
      lang={language}
    >
      <LanguageFlag language={language} />
      <Select.ItemText>{label}</Select.ItemText>
      {description ? (
        <span className="wallet-language__description" aria-hidden>
          {description}
        </span>
      ) : null}
      <Select.ItemIndicator className="wallet-language__indicator">
        <Check size={18} strokeWidth={1.7} aria-hidden />
      </Select.ItemIndicator>
    </Select.Item>
  );
}

export function LanguageSelector({
  placement,
}: {
  placement: 'navbar' | 'footer';
}): React.JSX.Element {
  return (
    <Select.Root value={locale} onValueChange={changeLanguage}>
      <Select.Trigger
        className={`wallet-language__trigger wallet-language__trigger--${placement}`}
        aria-label={t('language')}
      >
        <Languages size={19} strokeWidth={1.7} aria-hidden />
        <span className="wallet-language__name" lang={locale}>
          <Select.Value />
        </span>
        <Select.Icon>
          <ChevronDown size={15} aria-hidden />
        </Select.Icon>
      </Select.Trigger>
      <Select.Portal>
        <Select.Content
          className="wallet-language__menu"
          position="popper"
          side="bottom"
          align={placement === 'navbar' ? 'end' : 'start'}
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
