import React from 'react';
import { ChevronDown, Menu, X } from 'lucide-react';
import { GrainField, type GrainFieldName } from '@seams-internal/grain-field';
import { blinkMenuItem } from './menuItemBlink';
import './Navbar.css';

export type DropdownId = 'products' | 'documentation' | 'about' | 'pricing';

export type MenuRow = {
  title: string;
  description: string;
  to: string;
  icon: React.ComponentType<{ size?: number; strokeWidth?: number; 'aria-hidden'?: boolean }>;
  /** Small right-aligned annotation, e.g. a plan's price basis. */
  meta?: string;
  /** Sets the icon in white on a small gradient tile. */
  field?: GrainFieldName;
};

export type MenuHighlight = {
  title: string;
  description: string;
  to: string;
  /** The moving gradient behind the card. */
  field: GrainFieldName;
};

export type MenuFooterLink = {
  label: string;
  to: string;
};

export type DropdownPane = {
  id: DropdownId;
  label: string;
  kicker: string;
  rows: MenuRow[];
  /** Optional gradient promo card on the pane's right side. */
  highlight?: MenuHighlight;
  footerLinks: MenuFooterLink[];
};

/** One extra link at the end of a mobile menu section. */
export type MobileExtraLink = {
  title: string;
  description: string;
  to: string;
};

/** The site's own menus and link targets; the navbar supplies the design. */
export type SiteNavbarConfig = {
  labels: SiteNavbarLabels;
  panes: Record<DropdownId, DropdownPane>;
  homeHref: string;
  aboutHref: string;
  dashboardHref: string;
  /** Extra links under the mobile Plans section, e.g. a sales contact. */
  mobilePlanLinks?: MobileExtraLink[];
};

export type SiteNavbarLabels = {
  primary: string;
  home: string;
  dashboard: string;
  openMenu: string;
  closeMenu: string;
  companyOverview: string;
  companyMission: string;
};

/** The site router: an in-app navigation and the props for a link. */
export type SiteNavbarRouter = {
  go: (to: string) => void;
  linkProps: (to: string) => {
    href: string;
    onClick?: (event: React.MouseEvent<HTMLAnchorElement>) => void;
  };
};

function isModifiedClick(event: React.MouseEvent<HTMLElement>): boolean {
  return event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0;
}

type DropdownTriggerConfig = {
  id: DropdownId;
  label: string;
};

type DropdownFocusTarget = 'first' | 'last';
const DASHBOARD_AUTH_OPEN_EVENT = 'seams:dashboard-auth-open';

/* Visual left-to-right order of the dropdown triggers in the bar; drives which
   side inactive panes park on so a menu switch slides content in from the
   direction of travel (restores the pre-refresh pane slide). */
const DROPDOWN_VISUAL_ORDER: DropdownId[] = ['documentation', 'products', 'pricing', 'about'];

function paneOrderIndex(id: DropdownId): number {
  return DROPDOWN_VISUAL_ORDER.indexOf(id);
}

function paneVisualClass(paneId: DropdownId, activeId: DropdownId | null): string {
  if (paneId === activeId) return 'is-active';
  if (!activeId) return 'is-after';
  return paneOrderIndex(paneId) < paneOrderIndex(activeId) ? 'is-before' : 'is-after';
}

function isClickInsideRoot(target: EventTarget | null, root: HTMLElement | null): boolean {
  return !!(target instanceof Node && root && root.contains(target));
}

function getMenuItems(panel: HTMLDivElement | null, id: DropdownId | null): HTMLElement[] {
  if (!panel || !id) return [];
  return Array.from(
    panel.querySelectorAll<HTMLElement>(`[data-dropdown-view="${id}"] a[role="menuitem"]`),
  );
}

export type NavbarStaticProps = {
  /** 'auto' follows the site theme; 'light' pins the light-page skin (used by /home2). */
  appearance?: 'auto' | 'light';
  /** Compact keeps the inset shell when a page supplies its own navbar treatment. */
  layout?: 'page' | 'compact';
};

export type SiteNavbarProps = NavbarStaticProps & {
  config: SiteNavbarConfig;
  router: SiteNavbarRouter;
  /** The site's wordmark component. */
  Wordmark: React.ComponentType<{ className?: string; height?: number }>;
  /** The site's animated arrow component. */
  Arrow: React.ComponentType<{ size?: number }>;
  languageSelector?: React.ReactNode;
};

export function SiteNavbar({
  appearance = 'auto',
  layout = 'page',
  config,
  router,
  Wordmark,
  Arrow,
  languageSelector,
}: SiteNavbarProps): React.JSX.Element {
  const OPEN_DELAY_MS = 0;
  const CLOSE_DELAY_MS = 120;
  const SCROLL_THRESHOLD_PX = 8;
  /* Near the top the bar always shows; past it, the bar hides on a scroll
     down and returns on a scroll up. A small dead band ignores jitter from
     trackpad momentum. */
  const HIDE_AFTER_PX = 80;
  const SCROLL_DIRECTION_DEADBAND_PX = 6;

  const { go, linkProps } = router;
  const {
    products: productsDropdownPane,
    documentation: documentationDropdownPane,
    about: aboutDropdownPane,
    pricing: pricingDropdownPane,
  } = config.panes;
  const labels = config.labels;
  const dropdownPanes = [
    productsDropdownPane,
    documentationDropdownPane,
    aboutDropdownPane,
    pricingDropdownPane,
  ];
  const rootRef = React.useRef<HTMLElement | null>(null);
  const dropdownButtonRefs = React.useRef<Record<DropdownId, HTMLButtonElement | null>>({
    products: null,
    documentation: null,
    pricing: null,
    about: null,
  });
  const dropdownPanelRef = React.useRef<HTMLDivElement | null>(null);
  const dropdownPopupRef = React.useRef<HTMLDivElement | null>(null);
  const paneRefs = React.useRef<Record<DropdownId, HTMLDivElement | null>>({
    products: null,
    documentation: null,
    pricing: null,
    about: null,
  });
  const prevOpenDropdownRef = React.useRef<DropdownId | null>(null);
  const openTimerRef = React.useRef<number | null>(null);
  const closeTimerRef = React.useRef<number | null>(null);
  const [openDropdown, setOpenDropdown] = React.useState<DropdownId | null>(null);
  const [paneSize, setPaneSize] = React.useState<{ w: number; h: number } | null>(null);
  // Horizontal anchor: the popup's left edge lines up with the trigger that
  // opened it, clamped so the panel never overhangs the bar.
  const [popupLeft, setPopupLeft] = React.useState<number | null>(null);
  // The card morphs between pane sizes only while already open; opening from
  // closed snaps to size so the panel doesn't grow out of the previous shape.
  const [paneMorphEnabled, setPaneMorphEnabled] = React.useState<boolean>(false);
  const [hasScrolled, setHasScrolled] = React.useState<boolean>(false);
  const [isScrollHidden, setIsScrollHidden] = React.useState<boolean>(false);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = React.useState<boolean>(false);
  const [isMobileProductsOpen, setIsMobileProductsOpen] = React.useState<boolean>(false);
  const [isMobileDocumentationOpen, setIsMobileDocumentationOpen] = React.useState<boolean>(false);
  const [isMobilePricingOpen, setIsMobilePricingOpen] = React.useState<boolean>(false);
  const [isMobileAboutOpen, setIsMobileAboutOpen] = React.useState<boolean>(false);

  // Measure the active pane (panes are absolutely positioned at max-content,
  // so offset sizes are their natural dimensions even while hidden) and morph
  // the card chrome to it — the ElevenLabs-style resize between menus. The
  // popup's left edge follows the open menu's trigger, so each menu opens
  // under its own label; switching menus glides the panel across.
  React.useLayoutEffect(() => {
    const previousOpen = prevOpenDropdownRef.current;
    prevOpenDropdownRef.current = openDropdown;
    // Keep the last size/anchor while closing so the panel fades out in place.
    if (!openDropdown) {
      setPaneMorphEnabled(false);
      return;
    }
    const pane = paneRefs.current[openDropdown];
    if (!pane) return;
    const paneW = pane.offsetWidth;
    const paneH = pane.offsetHeight;
    const shell = dropdownPopupRef.current?.offsetParent as HTMLElement | null;
    const trigger = dropdownButtonRefs.current[openDropdown];
    if (shell && trigger) {
      const shellRect = shell.getBoundingClientRect();
      // an ancestor's css zoom scales rect coordinates but not offset/style
      // px; normalize rect-derived values back to layout px
      const zoom = shell.offsetWidth ? shellRect.width / shell.offsetWidth : 1;
      const anchor = (trigger.getBoundingClientRect().left - shellRect.left) / zoom;
      // Only yield the anchor if a wide panel would overhang the bar's right edge.
      // Whole pixels keep the pane text on the pixel grid when it settles.
      setPopupLeft(Math.round(Math.max(8, Math.min(anchor, shellRect.width / zoom - paneW - 8))));
    }
    setPaneMorphEnabled(previousOpen !== null && previousOpen !== openDropdown);
    setPaneSize({ w: paneW, h: paneH });
  }, [openDropdown]);

  const clearDropdownTimers = React.useCallback(() => {
    if (openTimerRef.current !== null) {
      window.clearTimeout(openTimerRef.current);
      openTimerRef.current = null;
    }
    if (closeTimerRef.current !== null) {
      window.clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
  }, []);

  const scheduleOpenDropdown = React.useCallback(
    (id: DropdownId, delayMs: number = OPEN_DELAY_MS) => {
      if (isMobileMenuOpen) return;

      const effectiveDelayMs = openDropdown && openDropdown !== id ? 0 : delayMs;

      if (closeTimerRef.current !== null) {
        window.clearTimeout(closeTimerRef.current);
        closeTimerRef.current = null;
      }
      if (openTimerRef.current !== null) {
        window.clearTimeout(openTimerRef.current);
        openTimerRef.current = null;
      }

      openTimerRef.current = window.setTimeout(() => {
        setOpenDropdown(id);
        openTimerRef.current = null;
      }, effectiveDelayMs);
    },
    [isMobileMenuOpen, openDropdown],
  );

  const scheduleCloseDropdown = React.useCallback(
    (delayMs: number = CLOSE_DELAY_MS) => {
      if (isMobileMenuOpen) return;
      if (openTimerRef.current !== null) {
        window.clearTimeout(openTimerRef.current);
        openTimerRef.current = null;
      }
      if (closeTimerRef.current !== null) {
        window.clearTimeout(closeTimerRef.current);
        closeTimerRef.current = null;
      }
      closeTimerRef.current = window.setTimeout(() => {
        setOpenDropdown(null);
        closeTimerRef.current = null;
      }, delayMs);
    },
    [isMobileMenuOpen],
  );

  const closeMenus = React.useCallback(() => {
    clearDropdownTimers();
    setOpenDropdown(null);
    setIsMobileMenuOpen(false);
    setIsMobileProductsOpen(false);
    setIsMobileDocumentationOpen(false);
    setIsMobilePricingOpen(false);
    setIsMobileAboutOpen(false);
  }, [clearDropdownTimers]);

  React.useEffect(() => {
    return () => {
      clearDropdownTimers();
    };
  }, [clearDropdownTimers]);

  React.useEffect(() => {
    let lastY = window.scrollY;
    const onScroll = () => {
      const y = window.scrollY;
      setHasScrolled(y > SCROLL_THRESHOLD_PX);
      if (y <= HIDE_AFTER_PX) {
        setIsScrollHidden(false);
        lastY = y;
        return;
      }
      const delta = y - lastY;
      if (Math.abs(delta) < SCROLL_DIRECTION_DEADBAND_PX) return;
      setIsScrollHidden(delta > 0);
      lastY = y;
    };

    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      window.removeEventListener('scroll', onScroll);
    };
  }, [SCROLL_THRESHOLD_PX, HIDE_AFTER_PX, SCROLL_DIRECTION_DEADBAND_PX]);

  // an open dropdown or mobile menu keeps the bar on screen
  const isHidden = isScrollHidden && openDropdown === null && !isMobileMenuOpen;

  const getNavLinkProps = React.useCallback(
    (to: string) => {
      const props = linkProps(to);
      return {
        href: props.href,
        onClick: (e: React.MouseEvent<HTMLAnchorElement>) => {
          props.onClick?.(e);
          closeMenus();
        },
      };
    },
    [linkProps, closeMenus],
  );

  // Dropdown items blink once, then navigate as the menu closes. Modified
  // clicks still open a new tab straight away.
  const getMenuItemProps = React.useCallback(
    (to: string) => ({
      href: linkProps(to).href,
      onClick: (e: React.MouseEvent<HTMLAnchorElement>) => {
        if (isModifiedClick(e)) {
          closeMenus();
          return;
        }
        e.preventDefault();
        void blinkMenuItem(e.currentTarget)?.then(() => {
          go(to);
          closeMenus();
        });
      },
    }),
    [linkProps, closeMenus, go],
  );

  const openDropdownFromKeyboard = React.useCallback(
    (id: DropdownId, focusTarget: DropdownFocusTarget = 'first') => {
      clearDropdownTimers();
      setOpenDropdown(id);

      requestAnimationFrame(() => {
        const menuItems = getMenuItems(dropdownPanelRef.current, id);
        if (!menuItems.length) return;

        if (focusTarget === 'last') {
          menuItems[menuItems.length - 1]?.focus();
          return;
        }
        menuItems[0]?.focus();
      });
    },
    [clearDropdownTimers],
  );

  const onDropdownButtonKeyDown = React.useCallback(
    (e: React.KeyboardEvent<HTMLButtonElement>, id: DropdownId) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        closeMenus();
        return;
      }

      if (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        openDropdownFromKeyboard(id, 'first');
      }

      if (e.key === 'ArrowUp') {
        e.preventDefault();
        openDropdownFromKeyboard(id, 'last');
      }
    },
    [closeMenus, openDropdownFromKeyboard],
  );

  const onDropdownPanelKeyDown = React.useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      const id = openDropdown;
      const menuItems = getMenuItems(dropdownPanelRef.current, id);
      if (!menuItems.length) return;

      const activeIndex = menuItems.findIndex((item) => item === document.activeElement);

      if (e.key === 'Escape') {
        e.preventDefault();
        closeMenus();
        if (id) {
          dropdownButtonRefs.current[id]?.focus();
        }
        return;
      }

      if (e.key === 'Home') {
        e.preventDefault();
        menuItems[0]?.focus();
        return;
      }

      if (e.key === 'End') {
        e.preventDefault();
        menuItems[menuItems.length - 1]?.focus();
        return;
      }

      if (e.key === 'ArrowDown') {
        e.preventDefault();
        const nextIndex = activeIndex < 0 ? 0 : (activeIndex + 1) % menuItems.length;
        menuItems[nextIndex]?.focus();
        return;
      }

      if (e.key === 'ArrowUp') {
        e.preventDefault();
        const nextIndex = activeIndex <= 0 ? menuItems.length - 1 : activeIndex - 1;
        menuItems[nextIndex]?.focus();
      }
    },
    [closeMenus, openDropdown],
  );

  React.useEffect(() => {
    if (!openDropdown && !isMobileMenuOpen) return;

    const onPointerDown = (e: PointerEvent) => {
      if (isClickInsideRoot(e.target, rootRef.current)) return;
      closeMenus();
    };

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      closeMenus();
    };

    window.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [closeMenus, isMobileMenuOpen, openDropdown]);

  const homeProps = getNavLinkProps(config.homeHref);
  const aboutRootProps = getNavLinkProps(config.aboutHref);
  const getStartedProps = getNavLinkProps(config.dashboardHref);

  const openDashboardEntry = React.useCallback(() => {
    closeMenus();
    go(config.dashboardHref);
  }, [closeMenus, config.dashboardHref, go]);

  React.useEffect(() => {
    if (typeof window === 'undefined') return;
    const onOpenRequest = () => {
      openDashboardEntry();
    };
    window.addEventListener(DASHBOARD_AUTH_OPEN_EVENT, onOpenRequest as EventListener);
    return () => {
      window.removeEventListener(DASHBOARD_AUTH_OPEN_EVENT, onOpenRequest as EventListener);
    };
  }, [openDashboardEntry]);

  const onDashboardClick = React.useCallback(
    (event: React.MouseEvent<HTMLAnchorElement>) => {
      const modified =
        event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0;
      if (modified) return;
      event.preventDefault();
      openDashboardEntry();
    },
    [openDashboardEntry],
  );

  const dropdownAriaConfig = dropdownPanes.find((config) => config.id === openDropdown) ?? null;

  function renderDropdownTrigger(config: DropdownTriggerConfig): React.JSX.Element {
    const isOpen = openDropdown === config.id;

    return (
      <div
        key={config.id}
        className="navbar-static__group"
        onMouseEnter={() => scheduleOpenDropdown(config.id)}
        onMouseLeave={() => scheduleCloseDropdown()}
        onFocusCapture={() => scheduleOpenDropdown(config.id, 0)}
        onBlurCapture={(e) => {
          const next = e.relatedTarget;
          if (next instanceof Node && rootRef.current?.contains(next)) return;
          scheduleCloseDropdown(0);
        }}
      >
        <button
          type="button"
          ref={(el) => {
            dropdownButtonRefs.current[config.id] = el;
          }}
          className={`navbar-static__link navbar-static__link--button${isOpen ? ' is-active' : ''}`}
          aria-expanded={isOpen}
          aria-haspopup="menu"
          aria-controls={`navbar-dropdown-${config.id}`}
          onClick={() => {
            clearDropdownTimers();
            setOpenDropdown((open) => {
              if (open === config.id) return null;
              return config.id;
            });
          }}
          onKeyDown={(e) => onDropdownButtonKeyDown(e, config.id)}
        >
          <span>{config.label}</span>
        </button>
      </div>
    );
  }

  function renderAccessPane(pane: DropdownPane): React.JSX.Element {
    const isActive = pane.id === openDropdown;
    const paneClassName = `navbar-static__access-pane ${paneVisualClass(pane.id, openDropdown)}`;

    const highlightProps = pane.highlight ? getMenuItemProps(pane.highlight.to) : null;

    return (
      <div
        key={pane.id}
        id={`navbar-dropdown-${pane.id}`}
        ref={(el) => {
          paneRefs.current[pane.id] = el;
        }}
        className={paneClassName}
        data-dropdown-view={pane.id}
        aria-hidden={!isActive}
      >
        <div className="navbar-static__menu">
          <div className="navbar-static__menu-body">
            <div className="navbar-static__menu-col">
              <p className="navbar-static__menu-kicker">{pane.kicker}</p>
              {pane.rows.map((row) => {
                const rowProps = getMenuItemProps(row.to);
                const Icon = row.icon;
                return (
                  <a
                    key={row.title}
                    className={
                      row.field
                        ? 'navbar-static__menu-row navbar-static__menu-row--tile'
                        : 'navbar-static__menu-row'
                    }
                    role="menuitem"
                    href={rowProps.href}
                    onClick={rowProps.onClick}
                    tabIndex={isActive ? undefined : -1}
                  >
                    <span
                      className={
                        row.field
                          ? 'navbar-static__menu-row-icon navbar-static__menu-row-icon--tile'
                          : 'navbar-static__menu-row-icon'
                      }
                      aria-hidden
                    >
                      {row.field ? <GrainField field={row.field} playing={isActive} /> : null}
                      <Icon size={16} strokeWidth={1.7} />
                    </span>
                    <span className="navbar-static__menu-row-text">
                      <span className="navbar-static__menu-row-title">{row.title}</span>
                      <span className="navbar-static__menu-row-description">{row.description}</span>
                    </span>
                    {row.meta ? (
                      <span className="navbar-static__menu-row-meta">{row.meta}</span>
                    ) : null}
                  </a>
                );
              })}
            </div>
            {pane.highlight && highlightProps ? (
              <div className="navbar-static__menu-side">
                <a
                  className="navbar-static__menu-highlight"
                  role="menuitem"
                  href={highlightProps.href}
                  onClick={highlightProps.onClick}
                  tabIndex={isActive ? undefined : -1}
                >
                  <GrainField field={pane.highlight.field} playing={isActive} />
                  <span className="navbar-static__menu-highlight-title">
                    {pane.highlight.title}
                  </span>
                  <span className="navbar-static__menu-highlight-description">
                    {pane.highlight.description}
                  </span>
                </a>
              </div>
            ) : null}
          </div>
          {pane.footerLinks.length > 0 ? (
            <div className="navbar-static__menu-footer">
              {pane.footerLinks.map((link) => {
                const linkNavProps = getMenuItemProps(link.to);
                return (
                  <a
                    key={link.label}
                    className="navbar-static__menu-footer-link"
                    role="menuitem"
                    href={linkNavProps.href}
                    onClick={linkNavProps.onClick}
                    tabIndex={isActive ? undefined : -1}
                  >
                    <span>{link.label}</span>
                    <Arrow size={12} />
                  </a>
                );
              })}
            </div>
          ) : null}
        </div>
      </div>
    );
  }

  return (
    <nav
      ref={rootRef}
      className={`navbar-static${appearance === 'light' ? ' navbar-static--light' : ''}${
        layout === 'compact' ? ' navbar-static--compact' : ''
      }${isHidden ? ' is-hidden' : ''}`}
      aria-label={labels.primary}
    >
      <div className={`navbar-static__shell${hasScrolled ? ' is-scrolled' : ''}`}>
        <div className="navbar-static__left">
          <a
            className="navbar-static__brand"
            href={homeProps.href}
            onClick={homeProps.onClick}
            aria-label={labels.home}
          >
            <Wordmark className="navbar-static__brand-wordmark" height={17} />
          </a>
        </div>

        <div className="navbar-static__center">
          <div className="navbar-static__links">
            {renderDropdownTrigger(documentationDropdownPane)}
            {renderDropdownTrigger(productsDropdownPane)}
            {renderDropdownTrigger(pricingDropdownPane)}
            {renderDropdownTrigger(aboutDropdownPane)}
          </div>
        </div>

        <div className="navbar-static__right">
          <div className="navbar-static__actions">
            {languageSelector}
            <a
              className="navbar-static__pill navbar-static__pill--solid"
              href={getStartedProps.href}
              onClick={onDashboardClick}
            >
              <span>{labels.dashboard}</span>
              <Arrow size={14} />
            </a>
            <button
              type="button"
              className="navbar-static__mobile-toggle"
              aria-label={isMobileMenuOpen ? labels.closeMenu : labels.openMenu}
              onClick={() => setIsMobileMenuOpen((open) => !open)}
            >
              <span
                className="navbar-static__context-icon"
                key={isMobileMenuOpen ? 'close' : 'menu'}
              >
                {isMobileMenuOpen ? <X size={20} aria-hidden /> : <Menu size={20} aria-hidden />}
              </span>
            </button>
          </div>
        </div>

        <div
          ref={dropdownPopupRef}
          className={`navbar-static__access-popup${openDropdown ? ' is-open' : ''}${
            paneMorphEnabled ? ' is-morphing' : ''
          }`}
          style={popupLeft !== null ? { left: popupLeft } : undefined}
          onMouseEnter={clearDropdownTimers}
          onMouseLeave={() => scheduleCloseDropdown()}
          onFocusCapture={clearDropdownTimers}
          onBlurCapture={(e) => {
            const next = e.relatedTarget;
            if (next instanceof Node && rootRef.current?.contains(next)) return;
            scheduleCloseDropdown(0);
          }}
        >
          <div
            ref={dropdownPanelRef}
            className="navbar-static__access-card"
            role="menu"
            aria-label={dropdownAriaConfig ? dropdownAriaConfig.label : undefined}
            aria-orientation="vertical"
            onKeyDown={onDropdownPanelKeyDown}
          >
            <div
              className={`navbar-static__access-grid-shell${
                paneMorphEnabled ? ' is-morphing' : ''
              }`}
              style={paneSize ? { width: paneSize.w, height: paneSize.h } : undefined}
            >
              {dropdownPanes.map(renderAccessPane)}
            </div>
          </div>
        </div>
      </div>

      <div className={`navbar-static__mobile-menu${isMobileMenuOpen ? ' is-open' : ''}`}>
        <button
          type="button"
          className="navbar-static__mobile-link navbar-static__mobile-link--button"
          aria-expanded={isMobileProductsOpen}
          onClick={() => {
            setIsMobileProductsOpen((open) => !open);
            setIsMobileDocumentationOpen(false);
            setIsMobilePricingOpen(false);
            setIsMobileAboutOpen(false);
          }}
        >
          <span>{documentationDropdownPane.label}</span>
          <ChevronDown
            size={16}
            className={`navbar-static__chevron${isMobileProductsOpen ? ' is-open' : ''}`}
            aria-hidden
          />
        </button>
        <div className={`navbar-static__mobile-submenu${isMobileProductsOpen ? ' is-open' : ''}`}>
          <section className="navbar-static__mobile-section">
            <h3 className="navbar-static__mobile-section-title">
              {documentationDropdownPane.kicker}
            </h3>
            {documentationDropdownPane.rows.map((row) => {
              const rowProps = getNavLinkProps(row.to);
              return (
                <a
                  key={row.title}
                  className="navbar-static__mobile-subitem"
                  href={rowProps.href}
                  onClick={rowProps.onClick}
                >
                  <span>{row.title}</span>
                  <small>{row.description}</small>
                </a>
              );
            })}
          </section>
        </div>
        <button
          type="button"
          className="navbar-static__mobile-link navbar-static__mobile-link--button"
          aria-expanded={isMobileDocumentationOpen}
          onClick={() => {
            setIsMobileDocumentationOpen((open) => !open);
            setIsMobileProductsOpen(false);
            setIsMobilePricingOpen(false);
            setIsMobileAboutOpen(false);
          }}
        >
          <span>{productsDropdownPane.label}</span>
          <ChevronDown
            size={16}
            className={`navbar-static__chevron${isMobileDocumentationOpen ? ' is-open' : ''}`}
            aria-hidden
          />
        </button>
        <div
          className={`navbar-static__mobile-submenu${isMobileDocumentationOpen ? ' is-open' : ''}`}
        >
          <section className="navbar-static__mobile-section">
            <h3 className="navbar-static__mobile-section-title">{productsDropdownPane.kicker}</h3>
            {productsDropdownPane.rows.map((row) => {
              const rowProps = getNavLinkProps(row.to);
              return (
                <a
                  key={row.title}
                  className="navbar-static__mobile-subitem"
                  href={rowProps.href}
                  onClick={rowProps.onClick}
                >
                  <span>{row.title}</span>
                  <small>{row.description}</small>
                </a>
              );
            })}
          </section>
        </div>
        <button
          type="button"
          className="navbar-static__mobile-link navbar-static__mobile-link--button"
          aria-expanded={isMobileAboutOpen}
          onClick={() => {
            setIsMobileAboutOpen((open) => !open);
            setIsMobileProductsOpen(false);
            setIsMobileDocumentationOpen(false);
            setIsMobilePricingOpen(false);
          }}
        >
          <span>{aboutDropdownPane.label}</span>
          <ChevronDown
            size={16}
            className={`navbar-static__chevron${isMobileAboutOpen ? ' is-open' : ''}`}
            aria-hidden
          />
        </button>
        <div className={`navbar-static__mobile-submenu${isMobileAboutOpen ? ' is-open' : ''}`}>
          <section className="navbar-static__mobile-section">
            <h3 className="navbar-static__mobile-section-title">{aboutDropdownPane.kicker}</h3>
            {aboutDropdownPane.rows.map((row) => {
              const rowProps = getNavLinkProps(row.to);
              return (
                <a
                  key={row.title}
                  className="navbar-static__mobile-subitem"
                  href={rowProps.href}
                  onClick={rowProps.onClick}
                >
                  <span>{row.title}</span>
                  <small>{row.description}</small>
                </a>
              );
            })}
          </section>
          <a
            className="navbar-static__mobile-subitem"
            href={aboutRootProps.href}
            onClick={aboutRootProps.onClick}
          >
            <span>{labels.companyOverview}</span>
            <small>{labels.companyMission}</small>
          </a>
        </div>
        <button
          type="button"
          className="navbar-static__mobile-link navbar-static__mobile-link--button"
          aria-expanded={isMobilePricingOpen}
          onClick={() => {
            setIsMobilePricingOpen((open) => !open);
            setIsMobileProductsOpen(false);
            setIsMobileDocumentationOpen(false);
            setIsMobileAboutOpen(false);
          }}
        >
          <span>{pricingDropdownPane.label}</span>
          <ChevronDown
            size={16}
            className={`navbar-static__chevron${isMobilePricingOpen ? ' is-open' : ''}`}
            aria-hidden
          />
        </button>
        <div className={`navbar-static__mobile-submenu${isMobilePricingOpen ? ' is-open' : ''}`}>
          <section className="navbar-static__mobile-section">
            <h3 className="navbar-static__mobile-section-title">{pricingDropdownPane.kicker}</h3>
            {pricingDropdownPane.rows.map((row) => {
              const rowProps = getNavLinkProps(row.to);
              return (
                <a
                  key={row.title}
                  className="navbar-static__mobile-subitem"
                  href={rowProps.href}
                  onClick={rowProps.onClick}
                >
                  <span>{row.title}</span>
                  <small>{row.description}</small>
                </a>
              );
            })}
          </section>
          {(config.mobilePlanLinks ?? []).map((link) => {
            const linkNavProps = getNavLinkProps(link.to);
            return (
              <a
                key={link.title}
                className="navbar-static__mobile-subitem"
                href={linkNavProps.href}
                onClick={linkNavProps.onClick}
              >
                <span>{link.title}</span>
                <small>{link.description}</small>
              </a>
            );
          })}
        </div>
        <div className="navbar-static__mobile-cta-row">
          <a
            className="navbar-static__pill navbar-static__pill--solid"
            href={getStartedProps.href}
            onClick={onDashboardClick}
          >
            <span>{labels.dashboard}</span>
            <Arrow size={14} />
          </a>
        </div>
      </div>
    </nav>
  );
}

export default SiteNavbar;
