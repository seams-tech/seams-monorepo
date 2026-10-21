import React from 'react';
import * as Select from '@radix-ui/react-select';
import { Check, ChevronDown, Languages } from 'lucide-react';
import './LanguageSelector.css';

export type SiteLocale = 'en' | 'ja';

const MENU_GAP_PX = 4;
const CLOSE_DELAY_MS = 120;

const languages: Record<SiteLocale, { label: string; description: string | null }> = {
  en: { label: 'English', description: null },
  ja: { label: '日本語', description: 'Japanese' },
};

function LanguageFlag({ language }: { language: SiteLocale }): React.JSX.Element {
  if (language === 'ja') {
    return (
      <svg className="site-language__flag" viewBox="0 0 26 26" aria-hidden>
        <circle cx="13" cy="13" r="13" fill="#f0efed" />
        <circle cx="13" cy="13" r="5.5" fill="#bc002d" />
      </svg>
    );
  }
  return (
    <svg className="site-language__flag" viewBox="0 0 26 26" aria-hidden>
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

function LanguageOption({ language }: { language: SiteLocale }): React.JSX.Element {
  const { label, description } = languages[language];
  return (
    <Select.Item
      className="site-language__option"
      value={language}
      textValue={label}
      lang={language}
    >
      <LanguageFlag language={language} />
      <Select.ItemText>{label}</Select.ItemText>
      {description ? (
        <span className="site-language__description" aria-hidden>
          {description}
        </span>
      ) : null}
      <Select.ItemIndicator className="site-language__indicator">
        <Check size={18} strokeWidth={1.7} aria-hidden />
      </Select.ItemIndicator>
    </Select.Item>
  );
}

function parseLanguage(onChange: (locale: SiteLocale) => void, value: string): void {
  if (value === 'en' || value === 'ja') onChange(value);
}

type LanguageSelectorProps = {
  placement: 'navbar' | 'footer';
  locale: SiteLocale;
  label: string;
  onChange: (locale: SiteLocale) => void;
};

function containsPointer(element: HTMLElement | null, event: PointerEvent): boolean {
  if (!element) return false;
  const rect = element.getBoundingClientRect();
  // Include the gap between the trigger and its portaled menu.
  return (
    event.clientX >= rect.left - MENU_GAP_PX &&
    event.clientX <= rect.right + MENU_GAP_PX &&
    event.clientY >= rect.top - MENU_GAP_PX &&
    event.clientY <= rect.bottom + MENU_GAP_PX
  );
}

export class LanguageSelector extends React.Component<LanguageSelectorProps, { open: boolean }> {
  state = { open: false };
  private readonly trigger = React.createRef<HTMLButtonElement>();
  private readonly menu = React.createRef<HTMLDivElement>();
  private closeTimer: number | null = null;

  componentDidMount(): void {
    // Select blocks outside pointer targets while open. Coordinates still
    // let the mouse dismiss it when moving toward another navbar menu.
    document.addEventListener('pointermove', this.onPointerMove);
  }

  componentWillUnmount(): void {
    document.removeEventListener('pointermove', this.onPointerMove);
    this.cancelClose();
  }

  private cancelClose(): void {
    if (this.closeTimer === null) return;
    window.clearTimeout(this.closeTimer);
    this.closeTimer = null;
  }

  private close = (): void => {
    this.cancelClose();
    this.setState({ open: false });
  };

  private onOpenChange = (open: boolean): void => {
    this.cancelClose();
    this.setState({ open });
  };

  private onPointerMove = (event: PointerEvent): void => {
    if (!this.state.open || event.pointerType !== 'mouse') return;
    if (containsPointer(this.trigger.current, event) || containsPointer(this.menu.current, event)) {
      this.cancelClose();
      return;
    }
    if (this.closeTimer !== null) return;
    this.closeTimer = window.setTimeout(this.close, CLOSE_DELAY_MS);
  };

  render(): React.JSX.Element {
    const { placement, locale, label, onChange } = this.props;
    return (
      <Select.Root
        open={this.state.open}
        onOpenChange={this.onOpenChange}
        value={locale}
        onValueChange={parseLanguage.bind(null, onChange)}
      >
        <Select.Trigger
          ref={this.trigger}
          className={`site-language__trigger site-language__trigger--${placement}`}
          aria-label={label}
        >
          <Languages size={16} strokeWidth={1.7} aria-hidden />
          <span className="site-language__name" lang={locale}>
            <Select.Value />
          </span>
          <Select.Icon>
            <ChevronDown size={12} aria-hidden />
          </Select.Icon>
        </Select.Trigger>
        <Select.Portal>
          <Select.Content
            ref={this.menu}
            className="site-language__menu"
            position="popper"
            side="bottom"
            align={placement === 'navbar' ? 'end' : 'start'}
            sideOffset={MENU_GAP_PX}
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
}
