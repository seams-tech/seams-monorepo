import React from 'react';
import { consoleLocale, saveConsoleLocaleAndReload, t, type ConsoleLocale } from '@core/i18n';
import type { ConsoleNetwork } from '@core/runtime';

/** The account network this Console reads, and the switch to the other one. */
export type DashboardNetworkSwitch = {
  readonly selected: ConsoleNetwork;
  readonly onSelect: (network: ConsoleNetwork) => void;
  /** Called when the pointer or focus reaches the switch, before a click. */
  readonly onIntent?: () => void;
};

export const CONSOLE_NETWORKS: readonly {
  readonly value: ConsoleNetwork;
  readonly label: string;
}[] = [
  { value: 'testnet', label: t('commonNetworkTestnet') },
  { value: 'mainnet', label: t('commonNetworkMainnet') },
];

// Each language names itself, so a reader finds their own in either locale.
const CONSOLE_LANGUAGES: readonly { readonly value: ConsoleLocale; readonly label: string }[] = [
  { value: 'en', label: 'English' },
  { value: 'ja', label: '日本語' },
];

type ToggleOption<Value extends string> = { readonly value: Value; readonly label: string };

/* One labelled row with a two-way pill. Inside the popup menu its options are
   menuitemradio rows, so the menu keeps only menu roles; in the mobile panel they
   are plain pressed buttons. */
function AccountMenuToggle<Value extends string>({
  label,
  options,
  selected,
  inMenu,
  onSelect,
  onIntent,
}: {
  label: string;
  options: readonly ToggleOption<Value>[];
  selected: Value;
  inMenu: boolean;
  onSelect: (value: Value) => void;
  onIntent?: () => void;
}): React.JSX.Element {
  const labelId = React.useId();
  return (
    <div className="dashboard-menu-toggle">
      <span id={labelId} className="dashboard-menu-toggle__label">
        {label}
      </span>
      <div
        className="dashboard-menu-toggle__options"
        role="group"
        aria-labelledby={labelId}
        onPointerEnter={onIntent}
        onFocus={onIntent}
      >
        {options.map((option) => {
          const current = option.value === selected;
          return (
            <button
              key={option.value}
              type="button"
              className="dashboard-menu-toggle__option"
              {...(inMenu
                ? { role: 'menuitemradio', 'aria-checked': current }
                : { 'aria-pressed': current })}
              data-selected={current}
              onClick={() => {
                if (!current) onSelect(option.value);
              }}
            >
              {option.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/* Language and network as toggles in the account menu. A language change reloads
   the page; a network change switches the dashboard in place, then `onDone` runs. */
export function AccountMenuToggles({
  network,
  inMenu,
  onDone,
}: {
  network?: DashboardNetworkSwitch;
  inMenu: boolean;
  onDone?: () => void;
}): React.JSX.Element {
  return (
    <div className="dashboard-menu-toggles">
      <AccountMenuToggle
        label={t('commonLanguageLabel')}
        options={CONSOLE_LANGUAGES}
        selected={consoleLocale}
        inMenu={inMenu}
        onSelect={saveConsoleLocaleAndReload}
      />
      {network ? (
        <AccountMenuToggle
          label={t('commonNetworkLabel')}
          options={CONSOLE_NETWORKS}
          selected={network.selected}
          inMenu={inMenu}
          onSelect={(value) => {
            network.onSelect(value);
            onDone?.();
          }}
          onIntent={network.onIntent}
        />
      ) : null}
    </div>
  );
}
