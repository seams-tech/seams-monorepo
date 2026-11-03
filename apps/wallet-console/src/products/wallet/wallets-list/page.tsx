import {
  consoleWalletKeyString,
  type ConsoleWalletKey,
} from '@seams-internal/wallet-console-shared';
import React from 'react';
import { t } from '@core/i18n';
import { formatDashboardTimestamp } from '@core/dashboard/utils/timestamps';
import {
  DashboardTable,
  DashboardTableCell,
  DashboardTableDetailsPanel,
  DashboardTableFooter,
  DashboardTableHeader,
  DashboardTableHeaderCell,
  DashboardTableRow,
  DashboardTableState,
  DashboardTableStatus,
  dashboardTableColumns,
  useDashboardTablePagination,
} from '@core/dashboard/components/DashboardTable';
import {
  DASHBOARD_EMPTY_VALUE,
  dashboardStatusLabel,
  dashboardStatusTone,
} from '@core/dashboard/utils/statusTone';
import { ChevronRightIcon, WalletCardsIcon } from '@core/dashboard/icons/SidebarIcons';
import { useDashboardConsoleSession } from '@core/dashboard/consoleSession';
import { useDashboardSelectedContext } from '@core/dashboard/selectedContext';
import { listDashboardPolicies } from '../policy-engine/consolePoliciesApi';
import {
  formatWalletBalanceMinor,
  listDashboardWallets,
  mergeDashboardWallets,
  refreshDashboardWalletBalances,
  replaceDashboardWallets,
  searchDashboardWallets,
  type DashboardConsoleWallet,
  type DashboardConsoleWalletListInput,
  type DashboardConsoleWalletSortBy,
  type DashboardConsoleWalletSortOrder,
  type DashboardConsoleWalletType,
} from '../wallets/consoleWalletApi';

const USER_WALLETS_TABLE_COLUMNS = [
  { id: 'wallet', label: t('walletListColWallet') },
  { id: 'owner', label: t('walletListColOwner') },
  { id: 'policy', label: t('walletListColPolicy') },
  { id: 'balance', label: t('walletListColBalance') },
  { id: 'status', label: t('walletListColStatus') },
  { id: 'updated', label: t('walletListColUpdated') },
] as const;
const SEARCH_USER_WALLETS_PLACEHOLDER = t('walletListSearchPlaceholder');
const ANY_POLICY_LABEL = t('walletListAnyPolicy');

type WalletFilterOption = {
  value: string;
  label: string;
};

type WalletSortOption = WalletFilterOption & {
  sortBy: DashboardConsoleWalletSortBy;
  sortOrder: DashboardConsoleWalletSortOrder;
};

const WALLET_TYPE_OPTIONS: readonly WalletFilterOption[] = [
  { value: '', label: t('walletListTypeAll') },
  { value: 'EOA', label: t('walletListTypeEoa') },
  { value: 'SMART', label: t('walletListTypeSmart') },
];

const SORT_OPTIONS: readonly WalletSortOption[] = [
  {
    value: 'created-desc',
    label: t('walletListSortNewest'),
    sortBy: 'createdAt',
    sortOrder: 'desc',
  },
  { value: 'created-asc', label: t('walletListSortOldest'), sortBy: 'createdAt', sortOrder: 'asc' },
  {
    value: 'balance-desc',
    label: t('walletListSortHighestBalance'),
    sortBy: 'balance',
    sortOrder: 'desc',
  },
  {
    value: 'balance-asc',
    label: t('walletListSortLowestBalance'),
    sortBy: 'balance',
    sortOrder: 'asc',
  },
  {
    value: 'last-activity-desc',
    label: t('walletListSortRecentActivity'),
    sortBy: 'lastActivity',
    sortOrder: 'desc',
  },
  {
    value: 'last-activity-asc',
    label: t('walletListSortOldestActivity'),
    sortBy: 'lastActivity',
    sortOrder: 'asc',
  },
];
const WALLETS_TABLE_COLUMNS = dashboardTableColumns(2, 1.15, 0.6, 0.75, 0.6, 0.9);

function formatTimestamp(value: string): string {
  return formatDashboardTimestamp(value, '—');
}

function formatRawAmount(
  raw: string,
  decimals: number,
  minimumFractionDigits: number,
  maximumFractionDigits: number,
): string {
  const normalized = String(raw || '').trim();
  if (!/^\d+$/.test(normalized)) return DASHBOARD_EMPTY_VALUE;
  const padded = normalized.padStart(decimals + 1, '0');
  const whole = padded.slice(0, -decimals) || '0';
  const rawFraction = decimals > 0 ? padded.slice(-decimals) : '';
  const truncated = rawFraction.slice(0, maximumFractionDigits);
  const fraction = truncated.replace(/0+$/u, '').padEnd(minimumFractionDigits, '0');
  const localizedWhole = BigInt(whole).toLocaleString();
  return fraction ? `${localizedWhole}.${fraction}` : localizedWhole;
}

function formatNearBalance(raw: string): string {
  return formatRawAmount(raw, 24, 2, 6);
}

function formatStablecoinBalance(raw: string, decimals: number): string {
  return `$${formatRawAmount(raw, decimals, 2, 2)}`;
}

function walletListFooterText(
  count: number,
  searchMode: boolean,
  projectId: string | undefined,
  environmentId: string | undefined,
): string {
  const one = count === 1;
  const summary = searchMode
    ? t(one ? 'walletListFooterResultsOne' : 'walletListFooterResultsMany', { count })
    : t(one ? 'walletListFooterWalletsOne' : 'walletListFooterWalletsMany', { count });
  if (!projectId) return summary;
  const scope = environmentId
    ? t('walletListFooterScopeEnvironment', { project: projectId, environment: environmentId })
    : t('walletListFooterScopeProject', { project: projectId });
  return `${summary} ${scope}`;
}

function walletBalancesRegionId(wallet: ConsoleWalletKey): string {
  return `wallet-chain-balances-${encodeURIComponent(consoleWalletKeyString(wallet))}`;
}

function WalletChainBalances(props: { wallet: DashboardConsoleWallet }): React.JSX.Element {
  const { wallet } = props;
  const balances = wallet.gasBalances;

  return (
    <DashboardTableDetailsPanel className="dashboard-wallet-balances">
      <section
        id={walletBalancesRegionId(wallet)}
        aria-label={t('walletBalancesLabel', { address: wallet.address })}
      >
        <header className="dashboard-wallet-balances__header">
          <strong>{t('walletBalancesTitle')}</strong>
          {balances ? (
            <time dateTime={balances.observedAt}>
              {t('walletBalancesUpdated', { time: formatTimestamp(balances.observedAt) })}
            </time>
          ) : (
            <span>{t('walletBalancesWaiting')}</span>
          )}
        </header>
        {balances ? (
          <div className="dashboard-wallet-balances__grid">
            <article className="dashboard-wallet-balances__card">
              <header className="dashboard-wallet-balances__network">
                <strong>NEAR</strong>
                <span>{t('walletBalancesGasCurrency')}</span>
              </header>
              <p className="dashboard-wallet-balances__amount">
                <strong>{formatNearBalance(balances.near.balanceYocto)}</strong>
                <span>NEAR</span>
              </p>
              <div className="dashboard-wallet-balances__identity">
                <span>{t('walletBalancesAccount')}</span>
                <code title={balances.near.accountId}>{balances.near.accountId}</code>
              </div>
            </article>
            <article className="dashboard-wallet-balances__card">
              <header className="dashboard-wallet-balances__network">
                <strong>Tempo</strong>
                <span>{t('walletBalancesGasCurrency')}</span>
              </header>
              <p className="dashboard-wallet-balances__amount">
                <strong>{formatStablecoinBalance(balances.tempo.alphaUsdRaw, 6)}</strong>
                <span>AlphaUSD</span>
              </p>
              <div className="dashboard-wallet-balances__identity">
                <span>{t('walletBalancesAddress')}</span>
                <code title={balances.tempo.address}>{balances.tempo.address}</code>
              </div>
            </article>
            <article className="dashboard-wallet-balances__card">
              <header className="dashboard-wallet-balances__network">
                <strong>Arc</strong>
                <span>{t('walletBalancesGasCurrency')}</span>
              </header>
              <p className="dashboard-wallet-balances__amount">
                <strong>{formatStablecoinBalance(balances.arc.usdcRaw, 18)}</strong>
                <span>USDC</span>
              </p>
              <div className="dashboard-wallet-balances__identity">
                <span>{t('walletBalancesAddress')}</span>
                <code title={balances.arc.address}>{balances.arc.address}</code>
              </div>
            </article>
          </div>
        ) : (
          <p className="dashboard-wallet-balances__empty">{t('walletBalancesEmpty')}</p>
        )}
      </section>
    </DashboardTableDetailsPanel>
  );
}

export function UserWalletsListPage(): React.JSX.Element {
  const session = useDashboardConsoleSession();
  const selectedContext = useDashboardSelectedContext();
  const [query, setQuery] = React.useState<string>('');
  const [wallets, setWallets] = React.useState<DashboardConsoleWallet[]>([]);
  const [loading, setLoading] = React.useState<boolean>(true);
  const [errorMessage, setErrorMessage] = React.useState<string>('');
  const [expandedWalletKey, setExpandedWalletKey] = React.useState<string>('');
  const [policyFilter, setPolicyFilter] = React.useState<string>('');
  const [walletTypeFilter, setWalletTypeFilter] = React.useState<string>('');
  const [sortValue, setSortValue] = React.useState<string>(SORT_OPTIONS[0].value);
  const [policyOptions, setPolicyOptions] = React.useState<readonly WalletFilterOption[]>([
    { value: '', label: ANY_POLICY_LABEL },
  ]);
  const walletScope = React.useMemo(
    () => ({
      projectId: String(selectedContext.project || '').trim() || undefined,
      environmentId: String(selectedContext.environment || '').trim() || undefined,
    }),
    [selectedContext.environment, selectedContext.project],
  );
  const trimmedQuery = query.trim();
  const searchMode = trimmedQuery.length >= 2;
  const walletsPagination = useDashboardTablePagination(wallets, {
    disabled: loading,
    itemLabel: t('walletListItemSingular'),
    itemLabelPlural: t('walletListItemPlural'),
  });
  const activeSort = SORT_OPTIONS.find((option) => option.value === sortValue) || SORT_OPTIONS[0];
  const walletRequest = React.useMemo<DashboardConsoleWalletListInput>(
    () => ({
      projectId: walletScope.projectId,
      environmentId: walletScope.environmentId,
      walletType: (walletTypeFilter || undefined) as DashboardConsoleWalletType | undefined,
      policyId: policyFilter || undefined,
      sortBy: activeSort.sortBy,
      sortOrder: activeSort.sortOrder,
    }),
    [activeSort.sortBy, activeSort.sortOrder, policyFilter, walletScope, walletTypeFilter],
  );

  React.useEffect(() => {
    if (session.loading || !session.claims) {
      setPolicyOptions([{ value: '', label: ANY_POLICY_LABEL }]);
      return;
    }

    let cancelled = false;
    listDashboardPolicies()
      .then((policies) => {
        if (cancelled) return;
        const nextOptions: WalletFilterOption[] = [{ value: '', label: ANY_POLICY_LABEL }];
        const seen = new Set<string>();
        for (const policy of policies) {
          const policyId = String(policy.id || '').trim();
          if (!policyId || seen.has(policyId)) continue;
          seen.add(policyId);
          nextOptions.push({
            value: policyId,
            label: String(policy.name || '').trim() || policyId,
          });
        }
        setPolicyOptions(nextOptions);
      })
      .catch(() => {
        if (cancelled) return;
        setPolicyOptions([{ value: '', label: ANY_POLICY_LABEL }]);
      });

    return () => {
      cancelled = true;
    };
  }, [session.claims, session.loading]);

  React.useEffect(() => {
    setPolicyOptions((current) => {
      const dynamic = new Map(current.map((option) => [option.value, option.label]));
      for (const wallet of wallets) {
        const policyId = String(wallet.policyId || '').trim();
        if (!policyId || dynamic.has(policyId)) continue;
        dynamic.set(policyId, policyId);
      }
      if (policyFilter && !dynamic.has(policyFilter)) {
        dynamic.set(policyFilter, policyFilter);
      }
      const next = [{ value: '', label: ANY_POLICY_LABEL }];
      for (const [value, label] of dynamic.entries()) {
        if (!value) continue;
        next.push({ value, label });
      }
      const unchanged =
        next.length === current.length &&
        next.every(
          (option, index) =>
            current[index] != null &&
            current[index].value === option.value &&
            current[index].label === option.label,
        );
      return unchanged ? current : next;
    });
  }, [policyFilter, wallets]);

  React.useEffect(() => {
    if (session.loading) {
      setLoading(true);
      return;
    }
    if (!session.claims) {
      setLoading(false);
      setWallets([]);
      setErrorMessage(session.errorMessage || t('walletListSessionUnavailable'));
      return;
    }

    let cancelled = false;
    setLoading(true);
    setErrorMessage('');
    const fetchWallets = async () => {
      try {
        let cursor: string | undefined;
        let allWallets: DashboardConsoleWallet[] = [];
        for (;;) {
          const page = await (searchMode
            ? searchDashboardWallets({
                q: trimmedQuery,
                limit: 100,
                ...(cursor ? { cursor } : {}),
                ...walletRequest,
              })
            : listDashboardWallets({
                limit: 100,
                ...(cursor ? { cursor } : {}),
                ...walletRequest,
              }));
          if (cancelled) return;
          allWallets = mergeDashboardWallets(allWallets, page.wallets);
          cursor = page.nextCursor;
          if (!cursor) break;
        }
        if (cancelled) return;
        setWallets(allWallets);
        void refreshDashboardWalletBalances(allWallets.slice(0, 10))
          .then((refreshedWallets) => {
            if (cancelled || refreshedWallets.length === 0) return;
            setWallets((current) => replaceDashboardWallets(current, refreshedWallets));
          })
          .catch(() => undefined);
      } catch (error: unknown) {
        if (cancelled) return;
        setWallets([]);
        setErrorMessage(error instanceof Error ? error.message : String(error));
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    const timeoutId = searchMode ? window.setTimeout(fetchWallets, 200) : undefined;
    if (!searchMode) {
      void fetchWallets();
    }
    return () => {
      cancelled = true;
      if (timeoutId !== undefined) window.clearTimeout(timeoutId);
    };
  }, [
    searchMode,
    session.claims,
    session.errorMessage,
    session.loading,
    trimmedQuery,
    walletRequest,
  ]);

  React.useEffect(() => {
    setExpandedWalletKey('');
  }, [policyFilter, sortValue, walletScope.environmentId, walletScope.projectId, walletTypeFilter]);

  const summaryMetrics = React.useMemo(
    () => [
      {
        label: t('walletListSummaryWallets'),
        value: String(wallets.length),
      },
      {
        label: t('walletListSummaryFunded'),
        value: String(wallets.filter((wallet) => wallet.funded).length),
      },
      {
        label: t('walletListSummaryActive'),
        value: String(
          wallets.filter((wallet) => String(wallet.status || '').toUpperCase() === 'ACTIVE').length,
        ),
      },
    ],
    [wallets],
  );

  return (
    <div className="dashboard-view" aria-label={t('walletListPageLabel')}>
      <section className="dashboard-filters" aria-label={t('walletListSearchControls')}>
        <label className="dashboard-search-control">
          <span className="dashboard-search-icon" aria-hidden="true" />
          <input
            type="search"
            placeholder={SEARCH_USER_WALLETS_PLACEHOLDER}
            aria-label={t('walletListSearchLabel')}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
        <label className="dashboard-form-field">
          <select
            className="dashboard-input"
            aria-label={t('walletListFilterPolicyLabel')}
            value={policyFilter}
            onChange={(event) => setPolicyFilter(event.target.value)}
          >
            {policyOptions.map((option) => (
              <option key={option.value || 'all'} value={option.value}>
                {t('walletListPolicyOption', { label: option.label })}
              </option>
            ))}
          </select>
        </label>
        <label className="dashboard-form-field">
          <select
            className="dashboard-input"
            aria-label={t('walletListFilterTypeLabel')}
            value={walletTypeFilter}
            onChange={(event) => setWalletTypeFilter(event.target.value)}
          >
            {WALLET_TYPE_OPTIONS.map((option) => (
              <option key={option.value || 'all'} value={option.value}>
                {t('walletListTypeOption', { label: option.label })}
              </option>
            ))}
          </select>
        </label>
        <label className="dashboard-form-field">
          <select
            className="dashboard-input"
            aria-label={t('walletListSortLabel')}
            value={sortValue}
            onChange={(event) => setSortValue(event.target.value)}
          >
            {SORT_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {t('walletListSortOption', { label: option.label })}
              </option>
            ))}
          </select>
        </label>
      </section>

      <section className="dashboard-wallet-summary" aria-label={t('walletListSummaryLabel')}>
        {summaryMetrics.map((metric) => (
          <article className="dashboard-wallet-summary__item" key={metric.label}>
            <p className="dashboard-wallet-summary__label">{metric.label}</p>
            <p className="dashboard-wallet-summary__value">{metric.value}</p>
          </article>
        ))}
      </section>

      <DashboardTable
        ariaLabel={t('walletListTableLabel')}
        columns={WALLETS_TABLE_COLUMNS}
        pagination={walletsPagination.pagination}
      >
        <DashboardTableHeader>
          {USER_WALLETS_TABLE_COLUMNS.map((column) => (
            <DashboardTableHeaderCell
              key={column.id}
              className={
                column.id === 'balance' ? 'dashboard-data-table__header-cell--end' : undefined
              }
            >
              {column.label}
            </DashboardTableHeaderCell>
          ))}
        </DashboardTableHeader>
        {loading ? (
          <DashboardTableState>
            {searchMode ? t('walletListSearching') : t('walletListLoading')}
          </DashboardTableState>
        ) : errorMessage ? (
          <DashboardTableState>
            {searchMode
              ? t('walletListSearchFailed', { message: errorMessage })
              : t('walletListUnavailable', { message: errorMessage })}
          </DashboardTableState>
        ) : wallets.length === 0 ? (
          <DashboardTableState>
            {searchMode ? t('walletListNoMatch') : t('walletListEmpty')}
          </DashboardTableState>
        ) : (
          <>
            {walletsPagination.rows.map((wallet) => {
              const key = consoleWalletKeyString(wallet);
              const expanded = expandedWalletKey === key;
              return (
                <React.Fragment key={key}>
                  <DashboardTableRow
                    className={`dashboard-wallet-row${
                      expanded ? ' dashboard-wallet-row--expanded' : ''
                    }`}
                  >
                    <DashboardTableCell className="dashboard-data-table__cell--lead">
                      <div className="dashboard-lead">
                        <span className="dashboard-lead__icon" aria-hidden="true">
                          <WalletCardsIcon size={16} />
                        </span>
                        <span className="dashboard-lead__copy">
                          <span className="dashboard-lead__title">
                            <button
                              type="button"
                              className="dashboard-inline-link dashboard-data-table__mono dashboard-wallet-row__toggle"
                              aria-expanded={expanded}
                              aria-controls={walletBalancesRegionId(wallet)}
                              aria-label={t('walletListToggleBalances', {
                                address: wallet.address,
                              })}
                              onClick={() =>
                                setExpandedWalletKey((current) => (current === key ? '' : key))
                              }
                            >
                              <span className="dashboard-wallet-row__label">{wallet.address}</span>
                              <span className="dashboard-wallet-row__chevron" aria-hidden="true">
                                <ChevronRightIcon size={16} strokeWidth={1.75} />
                              </span>
                            </button>
                          </span>
                          {wallet.id !== wallet.address ? (
                            <span className="dashboard-lead__sub">{wallet.id}</span>
                          ) : null}
                        </span>
                      </div>
                    </DashboardTableCell>
                    <DashboardTableCell
                      title={wallet.userId}
                      className="dashboard-data-table__cell--nowrap"
                    >
                      {wallet.userId || DASHBOARD_EMPTY_VALUE}
                    </DashboardTableCell>
                    <DashboardTableCell title={wallet.policyId || ''}>
                      {wallet.policyId ? <code>{wallet.policyId}</code> : DASHBOARD_EMPTY_VALUE}
                    </DashboardTableCell>
                    <DashboardTableCell align="end">
                      {formatWalletBalanceMinor(wallet.balanceMinor)}
                    </DashboardTableCell>
                    <DashboardTableCell>
                      {wallet.status ? (
                        <DashboardTableStatus tone={dashboardStatusTone(wallet.status)}>
                          {dashboardStatusLabel(wallet.status)}
                        </DashboardTableStatus>
                      ) : (
                        DASHBOARD_EMPTY_VALUE
                      )}
                    </DashboardTableCell>
                    <DashboardTableCell truncate>
                      {formatTimestamp(wallet.updatedAt)}
                    </DashboardTableCell>
                  </DashboardTableRow>
                  {expanded ? <WalletChainBalances wallet={wallet} /> : null}
                </React.Fragment>
              );
            })}
            <DashboardTableFooter>
              {walletListFooterText(
                wallets.length,
                searchMode,
                walletScope.projectId,
                walletScope.environmentId,
              )}
            </DashboardTableFooter>
          </>
        )}
      </DashboardTable>
    </div>
  );
}

export default UserWalletsListPage;
