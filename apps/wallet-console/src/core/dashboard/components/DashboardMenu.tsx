import React from 'react';
import clsx from 'clsx';
import { blinkMenuItem } from '@/components/menuItemBlink';

// Matches the dashboard-menu-exit animation in styles.css.
const DASHBOARD_MENU_EXIT_MS = 160;

type DashboardMenuPhase = 'closed' | 'open' | 'closing';

export interface DashboardMenuController {
  /** The menu is up and takes input. */
  readonly open: boolean;
  /** The menu is in the document: open, or fading out. */
  readonly mounted: boolean;
  readonly closing: boolean;
  /** Wraps the trigger and the menu; a pointer press outside it dismisses. */
  readonly rootRef: React.RefObject<HTMLDivElement | null>;
  show(): void;
  close(): void;
  toggle(): void;
  /** Blinks the chosen item, runs its action, then fades the menu out. */
  commit(item: HTMLElement, action: () => void): void;
}

/* One popup menu's state. A chosen item blinks once, highlight off then on, as
   macOS menus confirm a click; its action then runs and the menu fades out
   holding that highlight. Escape and a pointer press outside `rootRef` (or
   `dismissRootRef`) fade it out too, unless `dismiss` is false. The menu takes
   no input while an item blinks. */
export function useDashboardMenu(
  options: {
    dismiss?: boolean;
    dismissRootRef?: React.RefObject<HTMLElement | null>;
  } = {},
): DashboardMenuController {
  const { dismiss = true, dismissRootRef } = options;
  const [phase, setPhaseState] = React.useState<DashboardMenuPhase>('closed');
  const phaseRef = React.useRef<DashboardMenuPhase>('closed');
  const rootRef = React.useRef<HTMLDivElement | null>(null);
  const chosenRef = React.useRef<HTMLElement | null>(null);
  const exitTimerRef = React.useRef<number | null>(null);
  const mountedRef = React.useRef(true);

  const setPhase = React.useCallback((next: DashboardMenuPhase) => {
    phaseRef.current = next;
    setPhaseState(next);
  }, []);

  const endExit = React.useCallback(() => {
    if (exitTimerRef.current !== null) window.clearTimeout(exitTimerRef.current);
    exitTimerRef.current = null;
    if (chosenRef.current) delete chosenRef.current.dataset.blink;
    chosenRef.current = null;
  }, []);

  React.useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      endExit();
    };
  }, [endExit]);

  const fadeOut = React.useCallback(() => {
    setPhase('closing');
    exitTimerRef.current = window.setTimeout(() => {
      endExit();
      setPhase('closed');
    }, DASHBOARD_MENU_EXIT_MS);
  }, [endExit, setPhase]);

  const show = React.useCallback(() => {
    if (phaseRef.current === 'open') return;
    endExit();
    setPhase('open');
  }, [endExit, setPhase]);

  const close = React.useCallback(() => {
    if (phaseRef.current !== 'open' || chosenRef.current) return;
    fadeOut();
  }, [fadeOut]);

  const toggle = React.useCallback(() => {
    if (phaseRef.current === 'open') close();
    else show();
  }, [close, show]);

  const commit = React.useCallback(
    (item: HTMLElement, action: () => void) => {
      if (phaseRef.current !== 'open' || chosenRef.current) return;
      const blink = blinkMenuItem(item);
      if (!blink) return;
      chosenRef.current = item;
      void blink.then(() => {
        if (!mountedRef.current || chosenRef.current !== item) return;
        // The highlight stays on while the menu fades out.
        item.dataset.blink = 'on';
        action();
        fadeOut();
      });
    },
    [fadeOut],
  );

  React.useEffect(() => {
    if (!dismiss || phase !== 'open') return;
    const onPointerDown = (event: PointerEvent) => {
      const root = (dismissRootRef ?? rootRef).current;
      if (!root?.contains(event.target as Node)) close();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close();
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [close, dismiss, dismissRootRef, phase]);

  return React.useMemo(
    () => ({
      open: phase === 'open',
      mounted: phase !== 'closed',
      closing: phase === 'closing',
      rootRef,
      show,
      close,
      toggle,
      commit,
    }),
    [close, commit, phase, show, toggle],
  );
}

const DashboardMenuContext = React.createContext<DashboardMenuController | null>(null);

/* The popup itself. It renders nothing while closed and keeps showing its
   contents as they were at the click while it fades out, so an action that
   moves the selection doesn't redraw a menu that is leaving. */
export function DashboardMenu(
  props: { menu: DashboardMenuController } & React.HTMLAttributes<HTMLDivElement>,
): React.JSX.Element {
  const { menu, className, children, ...rest } = props;
  const shownChildren = React.useRef<React.ReactNode>(children);
  if (!menu.closing) shownChildren.current = children;
  if (!menu.mounted) return <></>;
  return (
    <DashboardMenuContext.Provider value={menu}>
      <div
        role="menu"
        {...rest}
        className={clsx('dashboard-menu', className, menu.closing && 'is-closing')}
      >
        {shownChildren.current}
      </div>
    </DashboardMenuContext.Provider>
  );
}

/* One row of a DashboardMenu. `keepOpen` rows act at once and leave the menu
   up; `blocked` rows stay focusable and do nothing. */
export function DashboardMenuItem(
  props: {
    onSelect: () => void;
    keepOpen?: boolean;
    blocked?: boolean;
  } & Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'onClick' | 'onSelect' | 'type'>,
): React.JSX.Element {
  const { onSelect, keepOpen = false, blocked = false, className, ...rest } = props;
  const menu = React.useContext(DashboardMenuContext);
  return (
    <button
      type="button"
      role="menuitem"
      aria-disabled={blocked || undefined}
      {...rest}
      className={clsx('dashboard-menu__item', className)}
      onClick={(event) => {
        if (blocked) return;
        if (keepOpen || !menu) onSelect();
        else menu.commit(event.currentTarget, onSelect);
      }}
    />
  );
}
