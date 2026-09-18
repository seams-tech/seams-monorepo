function SunIcon({ size, ...rest }: { size?: number } & React.SVGProps<SVGSVGElement>) {
  const s = size ?? 16;
  return (
    <svg
      width={s}
      height={s}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      {...rest}
    >
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2m0 16v2M4.9 4.9l1.4 1.4m11.4 11.4 1.4 1.4M2 12h2m16 0h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
    </svg>
  );
}

function MoonIcon({ size, ...rest }: { size?: number } & React.SVGProps<SVGSVGElement>) {
  const s = size ?? 16;
  return (
    <svg
      width={s}
      height={s}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      {...rest}
    >
      <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z" />
    </svg>
  );
}

import React from 'react';
import { createPortal } from 'react-dom';
import SeamsWordmark from '@core/components/SeamsWordmark';
import {
  openMobileNavigation,
  SidebarWorkspaceSwitcher,
  type DashboardHomeLinkProps,
  type SidebarWorkspaceProps,
} from './DashboardSidebar';
import DashboardSidebarToggleIcon from '../icons/DashboardSidebarToggleIcon';
import type { SidebarIconComponent, TopbarMenuKey, TopbarOption } from '../types';
import { getDocsOrigin } from '@core/router/siteRouting';

export type TopbarSearchItem = {
  label: string;
  path: string;
  group: string;
  icon: SidebarIconComponent;
};

export type DashboardTopbarProps = {
  workspace?: SidebarWorkspaceProps;
  isSidebarExpanded: boolean;
  onToggleSidebar: () => void;
  homeProps: DashboardHomeLinkProps;
  pageTitle: string;
  onSelectContext: (menu: TopbarMenuKey, value: string) => void;
  dropdownOptions: Record<TopbarMenuKey, TopbarOption[]>;
  accountLabel: string;
  searchItems?: TopbarSearchItem[];
  onNavigate?: (path: string) => void;
};

function isMetaK(event: KeyboardEvent): boolean {
  return (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k';
}

function movePaletteSelection(current: number, offset: number, itemCount: number): number {
  if (itemCount === 0) return 0;
  return (current + offset + itemCount) % itemCount;
}

function dismissPaletteFromBackdrop(
  onClose: () => void,
  event: React.PointerEvent<HTMLDivElement>,
): void {
  if (event.target === event.currentTarget) onClose();
}

function updatePaletteQuery(
  setQuery: React.Dispatch<React.SetStateAction<string>>,
  event: React.ChangeEvent<HTMLInputElement>,
): void {
  setQuery(event.target.value);
}

function keepPaletteInputFocused(event: React.PointerEvent<HTMLButtonElement>): void {
  event.preventDefault();
}

/* Lightweight ⌘K palette: filters navigation destinations and jumps. */
function TopbarCommandPalette({
  items,
  onNavigate,
  onClose,
}: {
  items: TopbarSearchItem[];
  onNavigate: (path: string) => void;
  onClose: () => void;
}): React.JSX.Element {
  const [query, setQuery] = React.useState('');
  const [activeIndex, setActiveIndex] = React.useState(0);
  const inputRef = React.useRef<HTMLInputElement | null>(null);
  const listboxId = React.useId();
  const shortcutDescriptionId = React.useId();

  const matches = React.useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return items;
    return items.filter((item) => `${item.group} ${item.label}`.toLowerCase().includes(normalized));
  }, [items, query]);

  React.useEffect(() => {
    const shell = document.querySelector<HTMLElement>('.dashboard-shell');
    const shellWasInert = shell?.inert === true;
    const previousBodyOverflow = document.body.style.overflow;
    if (shell) shell.inert = true;
    document.body.style.overflow = 'hidden';
    inputRef.current?.focus();
    return () => {
      if (shell && !shellWasInert) shell.inert = false;
      document.body.style.overflow = previousBodyOverflow;
    };
  }, []);

  React.useEffect(() => {
    setActiveIndex(0);
  }, [query]);

  React.useEffect(() => {
    const activeOption = document.getElementById(`${listboxId}-option-${activeIndex}`);
    activeOption?.scrollIntoView({ block: 'nearest' });
  }, [activeIndex, listboxId]);

  const commit = React.useCallback(
    (item: TopbarSearchItem | undefined) => {
      if (!item) return;
      onClose();
      onNavigate(item.path);
    },
    [onClose, onNavigate],
  );

  if (typeof document === 'undefined') return <></>;
  return createPortal(
    <div
      className="dashboard-command-palette-backdrop"
      role="presentation"
      onPointerDown={dismissPaletteFromBackdrop.bind(null, onClose)}
    >
      <div
        className="dashboard-command-palette"
        role="dialog"
        aria-modal="true"
        aria-label="Search pages"
        aria-describedby={shortcutDescriptionId}
      >
        <div className="dashboard-command-palette__search">
          <span className="dashboard-command-palette__search-icon" aria-hidden="true" />
          <input
            ref={inputRef}
            className="dashboard-command-palette__input"
            type="search"
            role="combobox"
            aria-label="Search pages"
            aria-controls={listboxId}
            aria-expanded="true"
            aria-autocomplete="list"
            aria-activedescendant={
              matches.length > 0 ? `${listboxId}-option-${activeIndex}` : undefined
            }
            placeholder="Search pages..."
            value={query}
            onChange={updatePaletteQuery.bind(null, setQuery)}
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                event.preventDefault();
                onClose();
              } else if (event.key === 'ArrowDown') {
                event.preventDefault();
                setActiveIndex((current) => movePaletteSelection(current, 1, matches.length));
              } else if (event.key === 'ArrowUp') {
                event.preventDefault();
                setActiveIndex((current) => movePaletteSelection(current, -1, matches.length));
              } else if (event.key === 'Enter') {
                event.preventDefault();
                commit(matches[activeIndex]);
              } else if (event.key === 'Tab') {
                event.preventDefault();
                inputRef.current?.focus();
              }
            }}
          />
          <kbd className="dashboard-command-palette__escape" aria-hidden="true">
            Esc
          </kbd>
        </div>
        <div id={listboxId} className="dashboard-command-palette__list" role="listbox">
          {matches.length === 0 ? (
            <p className="dashboard-command-palette__empty">No matching pages.</p>
          ) : (
            matches.map((item, index) => {
              const ItemIcon = item.icon;
              return (
                <button
                  id={`${listboxId}-option-${index}`}
                  key={item.path}
                  type="button"
                  role="option"
                  tabIndex={-1}
                  aria-selected={index === activeIndex}
                  className={`dashboard-command-palette__item${index === activeIndex ? ' is-active' : ''}`}
                  onPointerDown={keepPaletteInputFocused}
                  onMouseEnter={setActiveIndex.bind(null, index)}
                  onClick={commit.bind(null, item)}
                >
                  <span className="dashboard-command-palette__item-main">
                    <span className="dashboard-command-palette__item-icon" aria-hidden="true">
                      <ItemIcon size={24} strokeWidth={1.8} />
                    </span>
                    <span className="dashboard-command-palette__item-label">{item.label}</span>
                  </span>
                  <span className="dashboard-command-palette__group">{item.group}</span>
                </button>
              );
            })
          )}
        </div>
        <div
          id={shortcutDescriptionId}
          className="dashboard-command-palette__footer"
          aria-label="Keyboard shortcuts"
        >
          <span className="dashboard-command-palette__shortcut">
            <span className="dashboard-command-palette__shortcut-keys" aria-hidden="true">
              <kbd>↑</kbd>
              <kbd>↓</kbd>
            </span>
            <span>Navigate</span>
          </span>
          <span className="dashboard-command-palette__shortcut">
            <kbd aria-hidden="true">↵</kbd>
            <span>Open</span>
          </span>
          <span className="dashboard-command-palette__shortcut">
            <kbd aria-hidden="true">Esc</kbd>
            <span>Close</span>
          </span>
        </div>
      </div>
    </div>,
    document.body,
  );
}

export function DashboardTopbar({
  workspace,
  isSidebarExpanded,
  onToggleSidebar,
  homeProps,
  pageTitle,
  onSelectContext,
  dropdownOptions,
  accountLabel,
  searchItems = [],
  onNavigate,
}: DashboardTopbarProps): React.JSX.Element {
  const topbarRef = React.useRef<HTMLElement | null>(null);
  const paletteReturnFocusRef = React.useRef<HTMLElement | null>(null);
  const [accountMenuOpen, setAccountMenuOpen] = React.useState(false);
  const [paletteOpen, setPaletteOpen] = React.useState(false);
  const accountName = accountLabel;
  const accountInitial = (accountName.trim().charAt(0) || 'A').toUpperCase();
  const searchEnabled = searchItems.length > 0 && Boolean(onNavigate);
  const openPalette = React.useCallback(() => {
    paletteReturnFocusRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setAccountMenuOpen(false);
    setPaletteOpen(true);
  }, []);
  const closePalette = React.useCallback(() => {
    setPaletteOpen(false);
    window.requestAnimationFrame(() => paletteReturnFocusRef.current?.focus());
  }, []);
  React.useEffect(() => {
    if (!accountMenuOpen) return;
    const onPointerDown = (event: PointerEvent) => {
      const next = event.target;
      if (next instanceof Node && topbarRef.current?.contains(next)) return;
      setAccountMenuOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setAccountMenuOpen(false);
    };
    window.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [accountMenuOpen]);

  React.useEffect(() => {
    if (!searchEnabled) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (isMetaK(event)) {
        event.preventDefault();
        if (paletteOpen) closePalette();
        else openPalette();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [closePalette, openPalette, paletteOpen, searchEnabled]);

  /* Docs live on their own origin, so this is a plain link out rather than a
     console route. */
  const docsLink = (
    <a className="dashboard-topbar__docs" href={getDocsOrigin()} target="_blank" rel="noreferrer">
      Docs
    </a>
  );

  const accountMenu = (
    <div className="dashboard-account-menu">
      <button
        type="button"
        className="dashboard-account-menu__trigger"
        aria-haspopup="menu"
        aria-expanded={accountMenuOpen}
        aria-label={`Account menu for ${accountName}`}
        onClick={() => setAccountMenuOpen((current) => !current)}
      >
        <span className="dashboard-account-menu__avatar" aria-hidden="true">
          {accountInitial}
        </span>
      </button>
      {accountMenuOpen ? (
        <div
          className="dashboard-context-menu dashboard-context-menu--actions dashboard-account-menu__list"
          role="menu"
          aria-label="Account options"
        >
          <p className="dashboard-account-menu__identity">{accountName}</p>
          {dropdownOptions.accountSettings.map((option) => {
            const icon =
              option.icon === 'sun' ? (
                <SunIcon size={18} strokeWidth={2} aria-hidden />
              ) : option.icon === 'moon' ? (
                <MoonIcon size={18} strokeWidth={2} aria-hidden />
              ) : null;
            return (
              <button
                key={option.value}
                type="button"
                className={`dashboard-context-menu__item${option.disabled === true ? ' is-disabled' : ''}`}
                role="menuitem"
                onClick={() => {
                  onSelectContext('accountSettings', option.value);
                  if (option.keepMenuOpen !== true) {
                    setAccountMenuOpen(false);
                  }
                }}
              >
                {icon ? (
                  <span className="dashboard-context-menu__theme-action">
                    <span>{option.label}</span>
                    <span
                      className="navbar-static__theme-toggle dashboard-context-menu__theme-toggle"
                      aria-hidden="true"
                    >
                      {icon}
                    </span>
                  </span>
                ) : (
                  option.label
                )}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );

  return (
    <header
      ref={topbarRef}
      className="dashboard-topbar"
      role="banner"
      aria-label="Workspace context"
    >
      <a className="dashboard-mobile-brand" {...homeProps} aria-label="Seams home">
        <SeamsWordmark height={24} />
      </a>
      <div className="dashboard-topbar__lead">
        {!isSidebarExpanded ? (
          <button
            type="button"
            className="dashboard-sidebar-toggle"
            aria-label="Expand sidebar"
            aria-expanded="false"
            aria-controls="dashboard-sidebar-navigation"
            onClick={onToggleSidebar}
          >
            <DashboardSidebarToggleIcon expanded={false} />
          </button>
        ) : null}
        <span className="dashboard-topbar__page-title">{pageTitle}</span>
      </div>

      {searchEnabled ? (
        <button
          type="button"
          className="dashboard-topbar__search"
          aria-label="Search pages"
          onClick={openPalette}
        >
          <span className="dashboard-search-icon" aria-hidden="true" />
          <span className="dashboard-topbar__search-placeholder">Search everything...</span>
          <span className="dashboard-topbar__search-keys" aria-hidden="true">
            <kbd>⌘</kbd>
            <kbd>K</kbd>
          </span>
        </button>
      ) : (
        <span />
      )}

      <div className="dashboard-topbar__utilities">
        {docsLink}
        {accountMenu}
      </div>

      <button
        type="button"
        className="dashboard-mobile-menu-button"
        aria-label="Open navigation"
        aria-haspopup="dialog"
        aria-controls="dashboard-mobile-navigation"
        onClick={openMobileNavigation}
      >
        <svg
          width="24"
          height="24"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          aria-hidden="true"
        >
          <path d="M4 6h16M4 12h16M4 18h16" />
        </svg>
      </button>
      {workspace ? (
        <div className="dashboard-mobile-context">
          <SidebarWorkspaceSwitcher {...workspace} />
        </div>
      ) : null}
      {paletteOpen && searchEnabled && onNavigate ? (
        <TopbarCommandPalette items={searchItems} onNavigate={onNavigate} onClose={closePalette} />
      ) : null}
    </header>
  );
}

export default DashboardTopbar;
