import React from 'react';
import { t } from '@core/i18n';
import { formatDashboardTimestamp } from '../../utils/timestamps';
import { KeyRoundIcon } from '../../icons/SidebarIcons';
import {
  DashboardTable,
  DashboardTableActionButton,
  DashboardTableActionGroup,
  DashboardTableActionMenu,
  DashboardTableBadge,
  DashboardTableCell,
  DashboardTableHeader,
  DashboardTableHeaderCell,
  DashboardTableRow,
  DashboardTableState,
  DashboardTableStatus,
  dashboardTableColumns,
  useDashboardTablePagination,
} from '../../components/DashboardTable';
import {
  DASHBOARD_EMPTY_VALUE,
  dashboardStatusLabel,
  dashboardStatusTone,
} from '../../utils/statusTone';
import { DashboardInlineModal } from '../../components/DashboardInlineModal';
import { DashboardPageActions } from '../../components/DashboardPageActions';
import { useDashboardConsoleSession } from '../../consoleSession';
import {
  useDashboardSelectedContext,
  useDashboardSelectedContextDisplay,
} from '../../selectedContext';
import {
  createDashboardApiKey,
  deleteRevokedDashboardApiKey,
  listDashboardApiKeys,
  revokeDashboardApiKey,
  rotateDashboardApiKey,
  updateDashboardApiKey,
  type CreateDashboardApiKeyInput,
  type DashboardConsoleApiKey,
} from './consoleApiKeysApi';
import { useFrontendRuntime, type ConsoleNetwork } from '@core/runtime';
import { CopyButton } from '@core/components/CopyButton';
import { UriListEditor } from '../../components/UriListEditor';
import { ScopePicker } from '../../components/ScopePicker';
import { networkForConsoleEnvironmentId } from '../../environmentNetwork';
import { getDashboardEnvironmentLabel } from '../../utils/scopeLabels';
import type { ApiCredentialScope, ApiCredentialScopeCatalog } from './apiKeyScopeCatalog';
import { DashboardTableSkeletonRows } from '../../components/DashboardSkeleton';

const DEFAULT_RATE_LIMIT_BUCKET = 'default_web_v1';
const DEFAULT_QUOTA_BUCKET = 'free_registrations_v1';
const DEFAULT_RISK_POLICY: Record<string, unknown> = { captcha: 'adaptive' };
const DEFAULT_PAYMENT_PRODUCT_ID = 'wallet_registration_v1';

type PublishablePaymentPolicyValue = 'disabled' | 'quota_then_x402' | 'always_x402';

interface PublishableChoiceOption<TValue extends string> {
  value: TValue;
  label: string;
  description: string;
}

const PAYMENT_POLICY_OPTIONS: readonly PublishableChoiceOption<PublishablePaymentPolicyValue>[] = [
  {
    value: 'disabled',
    label: t('apiKeysPaymentDisabledLabel'),
    description: t('apiKeysPaymentDisabledDescription'),
  },
  {
    value: 'quota_then_x402',
    label: t('apiKeysPaymentQuotaThenLabel'),
    description: t('apiKeysPaymentQuotaThenDescription'),
  },
  {
    value: 'always_x402',
    label: t('apiKeysPaymentAlwaysLabel'),
    description: t('apiKeysPaymentAlwaysDescription'),
  },
] as const;

const API_KEYS_TABLE_COLUMNS = dashboardTableColumns(1.6, 0.65, 1.3, 0.95, 0.8);

type DashboardCredentialKind = DashboardConsoleApiKey['kind'];
type PendingCredentialAction = {
  type: 'rotate' | 'revoke';
  apiKey: DashboardConsoleApiKey;
} | null;

function formatNetworkLabel(network: ConsoleNetwork): string {
  return network === 'mainnet' ? t('apiKeysMainnet') : t('apiKeysTestnet');
}

function readBrowserOrigin(): string {
  return typeof window === 'undefined' ? '' : window.location.origin;
}

function CredentialScopeSummary({
  environmentId,
  environmentName,
  network,
  projectName,
  variant,
}: {
  environmentId: string;
  environmentName: string;
  network: ConsoleNetwork;
  projectName: string;
  variant: 'page' | 'dialog';
}): React.JSX.Element {
  return (
    <section
      className={`dashboard-credential-scope dashboard-credential-scope--${variant}`}
      aria-label={t('apiKeysScopeAria')}
    >
      <div className="dashboard-credential-scope__header">
        <strong>
          {variant === 'dialog' ? t('apiKeysScopeCreatingFor') : t('apiKeysScopeCurrent')}
        </strong>
        <span>{projectName}</span>
      </div>
      <dl className="dashboard-credential-scope__facts">
        <div>
          <dt>{t('apiKeysEnvironment')}</dt>
          <dd>{environmentName}</dd>
        </div>
        <div>
          <dt>{t('apiKeysChainNetwork')}</dt>
          <dd>{formatNetworkLabel(network)}</dd>
        </div>
        <div className="dashboard-credential-scope__environment-id">
          <dt>{t('apiKeysEnvironmentId')}</dt>
          <dd>
            <code>{environmentId}</code>
          </dd>
        </div>
      </dl>
    </section>
  );
}

function parseCsvValues(raw: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const piece of String(raw || '')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)) {
    const key = piece.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(piece);
  }
  return out;
}

function parseEditableList(values: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const entry of Array.isArray(values) ? values : []) {
    const value = String(entry || '').trim();
    if (!value) continue;
    const key = value.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(value);
  }
  return out;
}

function parseApiCredentialScopeSelection(
  values: string[],
  scopeCatalog: ApiCredentialScopeCatalog,
): ApiCredentialScope[] {
  const selections = parseEditableList(values);
  const out: ApiCredentialScope[] = [];
  for (const value of selections) {
    if (!scopeCatalog.isScope(value)) {
      throw new Error(t('apiKeysUnsupportedScope', { scope: value }));
    }
    out.push(value);
  }
  return out;
}

function formatTimestamp(value: string | null): string {
  return formatDashboardTimestamp(value, '—');
}

function normalizeOrigin(value: string): string {
  return String(value || '')
    .trim()
    .toLowerCase();
}

function normalizePaymentPolicyValue(
  raw: Record<string, unknown> | null | undefined,
): PublishablePaymentPolicyValue {
  const mode = String(raw?.mode || '').trim();
  if (mode === 'always_x402') return 'always_x402';
  if (mode === 'quota_then_x402') return 'quota_then_x402';
  return 'disabled';
}

function toPaymentPolicyObject(value: PublishablePaymentPolicyValue): Record<string, unknown> {
  if (value === 'disabled') return { mode: 'disabled' };
  return {
    mode: value,
    productId: DEFAULT_PAYMENT_PRODUCT_ID,
  };
}

const PAYMENT_POLICY_CHIP_LABELS: Record<PublishablePaymentPolicyValue, string> = {
  disabled: t('apiKeysPaymentChipDisabled'),
  quota_then_x402: t('apiKeysPaymentChipQuotaThen'),
  always_x402: t('apiKeysPaymentChipAlways'),
};

function describePublishablePaymentPolicyChip(
  value: Record<string, unknown> | null | undefined,
): string {
  return PAYMENT_POLICY_CHIP_LABELS[normalizePaymentPolicyValue(value)];
}

function describePublishablePaymentPolicy(
  value: Record<string, unknown> | null | undefined,
): string {
  const normalized = normalizePaymentPolicyValue(value);
  return (
    PAYMENT_POLICY_OPTIONS.find((option) => option.value === normalized)?.label ||
    PAYMENT_POLICY_OPTIONS[0].label
  );
}

function toDateTimeLocalValue(value: string | null): string {
  const iso = String(value || '').trim();
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const offsetMs = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offsetMs).toISOString().slice(0, 16);
}

function parseOptionalDateTimeLocalValue(raw: string): string | null | undefined {
  const value = String(raw || '').trim();
  if (!value) return null;
  const parsedMs = Date.parse(value);
  if (!Number.isFinite(parsedMs)) {
    throw new Error(t('apiKeysExpiryInvalid'));
  }
  return new Date(parsedMs).toISOString();
}

function buildSecretKeyServerSnippet(credential: string, environmentId: string): string {
  const envScope = String(environmentId || '').trim() || '<environment-id>';
  return [
    'curl -X POST "$RELAYER_URL/registration/bootstrap" \\',
    `  -H "Authorization: Bearer ${credential}" \\`,
    `  -H "X-Seams-Environment-Id: ${envScope}" \\`,
    '  -H "Content-Type: application/json" \\',
    "  -d '{",
    '    "new_account_id": "alice.testnet",',
    '    "rp_id": "localhost",',
    '    "account": { "type": "passkey" }',
    "  }'",
  ].join('\n');
}

function jsStringLiteral(value: string): string {
  return JSON.stringify(value);
}

function buildPublishableKeyManagedSnippet(
  credential: string,
  environmentId: string,
  allowedOrigins: string[],
  walletOrigin: string,
): string {
  const envScope = String(environmentId || '').trim() || '<environment-id>';
  const allowedOrigin = allowedOrigins[0] || 'https://app.example.com';
  const hostedWalletOrigin = String(walletOrigin || '').trim() || 'https://wallet.example.com';
  return [
    "import { SeamsWeb } from '@seams/wallet';",
    '',
    'const seams = new SeamsWeb({',
    "  relayer: { url: '$RELAYER_URL' },",
    '  iframeWallet: {',
    `    walletOrigin: ${jsStringLiteral(hostedWalletOrigin)},`,
    "    walletServicePath: '/wallet-service',",
    "    sdkBasePath: '/sdk',",
    '  },',
    '  registration: {',
    "    mode: 'managed',",
    `    projectEnvironmentId: ${jsStringLiteral(envScope)},`,
    `    publishableKey: ${jsStringLiteral(credential)},`,
    '  },',
    '});',
    '',
    '// publishable_key is browser-safe and is sent directly to the registration setup route.',
    '// The relay validates its environment and allowed-origin binding.',
    `// Example allowed origin: ${allowedOrigin}`,
    `// Environment scope: ${envScope}`,
  ].join('\n');
}

function describeCredentialMode(kind: DashboardCredentialKind): {
  title: string;
  summary: string;
} {
  if (kind === 'publishable_key') {
    return {
      title: t('apiKeysModeBrowserTitle'),
      summary: t('apiKeysModeBrowserSummary'),
    };
  }
  return {
    title: t('apiKeysModeServerTitle'),
    summary: t('apiKeysModeServerSummary'),
  };
}

function PublishablePaymentPolicyField(props: {
  value: PublishablePaymentPolicyValue;
  onChange(next: PublishablePaymentPolicyValue): void;
  disabled?: boolean;
}): React.JSX.Element {
  const { value, onChange, disabled = false } = props;
  const selectedOption =
    PAYMENT_POLICY_OPTIONS.find((option) => option.value === value) || PAYMENT_POLICY_OPTIONS[0];
  return (
    <label className="dashboard-form-field">
      <span>{t('apiKeysOverageBehavior')}</span>
      <select
        className="dashboard-input dashboard-scope-picker__select"
        value={value}
        onChange={(event) => onChange(event.target.value as PublishablePaymentPolicyValue)}
        disabled={disabled}
        aria-label={t('apiKeysOverageBehavior')}
      >
        {PAYMENT_POLICY_OPTIONS.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      <p className="dashboard-pagination-note">{selectedOption.description}</p>
    </label>
  );
}

function describeCredentialNamePreview(apiKey: DashboardConsoleApiKey): string {
  if (apiKey.kind !== 'publishable_key') return '';
  return String(apiKey.credentialPreview || '').trim();
}

function describeCredentialOverage(apiKey: DashboardConsoleApiKey): {
  short: string;
  title: string;
} {
  if (apiKey.kind !== 'publishable_key') {
    return { short: DASHBOARD_EMPTY_VALUE, title: t('apiKeysNotApplicableSecret') };
  }
  return {
    short: describePublishablePaymentPolicyChip(apiKey.paymentPolicy),
    title: describePublishablePaymentPolicy(apiKey.paymentPolicy),
  };
}

function describeCredentialOrigins(apiKey: DashboardConsoleApiKey): {
  short: string;
  title: string;
} {
  if (apiKey.kind !== 'publishable_key') {
    return { short: DASHBOARD_EMPTY_VALUE, title: t('apiKeysNotApplicableSecret') };
  }
  const count = apiKey.allowedOrigins.length;
  if (count === 0) return { short: DASHBOARD_EMPTY_VALUE, title: t('apiKeysNoAllowedOrigins') };
  /* Full URLs wrap badly in a narrow cell; show a count and put the list in
     the tooltip. */
  return {
    short: count === 1 ? apiKey.allowedOrigins[0] : t('apiKeysOriginCount', { count }),
    title: apiKey.allowedOrigins.join(', '),
  };
}

function formatCredentialKindLabel(kind: DashboardCredentialKind): string {
  return kind === 'publishable_key'
    ? t('apiKeysKindPublishableLabel')
    : t('apiKeysKindSecretLabel');
}

/* Chip-sized: the row already says "key", so the chip only has to say which. */
function formatCredentialKindChip(kind: DashboardCredentialKind): string {
  return kind === 'publishable_key' ? t('apiKeysKindPublishableChip') : t('apiKeysKindSecretChip');
}

function formatCredentialEnvironmentLabel(environmentId: string): string {
  return getDashboardEnvironmentLabel({ environmentId });
}

function formatCredentialActionLabel(action: 'rotate' | 'revoke'): string {
  return action === 'rotate' ? t('apiKeysRotate') : t('apiKeysRevoke');
}

export function ApiKeyManagementPage({
  scopeCatalog,
}: {
  scopeCatalog: ApiCredentialScopeCatalog;
}): React.JSX.Element {
  const session = useDashboardConsoleSession();
  const selectedContext = useDashboardSelectedContext();
  const selectedContextDisplay = useDashboardSelectedContextDisplay();
  const { deployment, selectedNetwork } = useFrontendRuntime();
  const selectedEnvironmentId = String(selectedContext.environment || '').trim();
  const credentialNetwork =
    networkForConsoleEnvironmentId(selectedEnvironmentId) ?? selectedNetwork;
  const selectedEnvironmentName =
    String(selectedContextDisplay.environment || '').trim() || selectedEnvironmentId;
  const selectedProjectName =
    String(selectedContextDisplay.project || '').trim() || String(selectedContext.project).trim();
  const registrationOriginHint = React.useMemo(readBrowserOrigin, []);
  const defaultPublishableOrigins = parseEditableList([
    registrationOriginHint,
    deployment.walletOrigin,
  ]);
  const [apiKeys, setApiKeys] = React.useState<DashboardConsoleApiKey[]>([]);
  const [loading, setLoading] = React.useState<boolean>(true);
  const [errorMessage, setErrorMessage] = React.useState<string>('');
  const [mutationError, setMutationError] = React.useState<string>('');
  const [creating, setCreating] = React.useState<boolean>(false);
  const [busyApiKeyId, setBusyApiKeyId] = React.useState<string>('');
  const [credentialKindInput, setCredentialKindInput] =
    React.useState<DashboardCredentialKind>('secret_key');
  const [nameInput, setNameInput] = React.useState<string>('');
  const [scopesInput, setScopesInput] = React.useState<ApiCredentialScope[]>([
    ...scopeCatalog.defaultScopes,
  ]);
  const [ipAllowlistInput, setIpAllowlistInput] = React.useState<string>('');
  const [allowedOriginsInput, setAllowedOriginsInput] =
    React.useState<string[]>(defaultPublishableOrigins);
  const [paymentPolicyInput, setPaymentPolicyInput] =
    React.useState<PublishablePaymentPolicyValue>('disabled');
  const [isCreateModalOpen, setIsCreateModalOpen] = React.useState<boolean>(false);
  const [revealedCredential, setRevealedCredential] = React.useState<{
    action: 'created' | 'rotated';
    apiKey: DashboardConsoleApiKey;
    credential: string;
  } | null>(null);
  const [copyCredentialStatus, setCopyCredentialStatus] = React.useState<string>('');
  const [editingApiKeyId, setEditingApiKeyId] = React.useState<string>('');
  const [editingNameInput, setEditingNameInput] = React.useState<string>('');
  const [editingScopesInput, setEditingScopesInput] = React.useState<ApiCredentialScope[]>([]);
  const [editingIpAllowlistInput, setEditingIpAllowlistInput] = React.useState<string>('');
  const [editingAllowedOriginsInput, setEditingAllowedOriginsInput] = React.useState<string[]>([]);
  const [editingPaymentPolicyInput, setEditingPaymentPolicyInput] =
    React.useState<PublishablePaymentPolicyValue>('disabled');
  const [editingExpiresAtInput, setEditingExpiresAtInput] = React.useState<string>('');
  const [editingBusy, setEditingBusy] = React.useState<boolean>(false);
  const [editingError, setEditingError] = React.useState<string>('');
  const [pendingAction, setPendingAction] = React.useState<PendingCredentialAction>(null);

  const loadApiKeys = React.useCallback(() => {
    if (!session.claims) {
      setLoading(false);
      setApiKeys([]);
      setErrorMessage(session.errorMessage || t('apiKeysSessionUnavailable'));
      return;
    }
    let cancelled = false;
    setLoading(true);
    setErrorMessage('');
    listDashboardApiKeys()
      .then((next) => {
        if (cancelled) return;
        setApiKeys(next);
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setApiKeys([]);
        setErrorMessage(error instanceof Error ? error.message : String(error));
      })
      .finally(() => {
        if (cancelled) return;
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [session.claims, session.errorMessage]);

  React.useEffect(() => {
    if (session.loading) {
      setLoading(true);
      return;
    }
    const cleanup = loadApiKeys();
    return cleanup;
  }, [loadApiKeys, session.loading]);

  const visibleApiKeys = React.useMemo(() => {
    const filtered = selectedEnvironmentId
      ? apiKeys.filter((entry) => entry.environmentId === selectedEnvironmentId)
      : apiKeys;
    return [...filtered].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }, [apiKeys, selectedEnvironmentId]);

  const editingApiKey = React.useMemo(
    () => visibleApiKeys.find((entry) => entry.id === editingApiKeyId) || null,
    [editingApiKeyId, visibleApiKeys],
  );
  const apiKeysPagination = useDashboardTablePagination(visibleApiKeys, {
    disabled: session.loading || loading,
    itemLabel: t('apiKeysItemSingular'),
    itemLabelPlural: t('apiKeysItemPlural'),
  });

  const onOpenCreateModal = React.useCallback(() => {
    setEditingApiKeyId('');
    setPendingAction(null);
    setAllowedOriginsInput(defaultPublishableOrigins);
    setIsCreateModalOpen(true);
    setMutationError('');
  }, [defaultPublishableOrigins]);

  const onCloseCreateModal = React.useCallback(() => {
    if (creating) return;
    setIsCreateModalOpen(false);
    setMutationError('');
  }, [creating]);

  const onOpenEditApiKey = React.useCallback((apiKey: DashboardConsoleApiKey) => {
    setIsCreateModalOpen(false);
    setPendingAction(null);
    setEditingApiKeyId(apiKey.id);
    setEditingNameInput(apiKey.name || '');
    setEditingScopesInput(apiKey.kind === 'secret_key' ? [...apiKey.scopes] : []);
    setEditingIpAllowlistInput(apiKey.kind === 'secret_key' ? apiKey.ipAllowlist.join(',') : '');
    setEditingAllowedOriginsInput(
      apiKey.kind === 'publishable_key' ? [...apiKey.allowedOrigins] : [],
    );
    setEditingPaymentPolicyInput(
      apiKey.kind === 'publishable_key'
        ? normalizePaymentPolicyValue(apiKey.paymentPolicy)
        : 'disabled',
    );
    setEditingExpiresAtInput(toDateTimeLocalValue(apiKey.expiresAt));
    setEditingError('');
  }, []);

  const onCloseEditApiKey = React.useCallback(() => {
    if (editingBusy) return;
    setEditingApiKeyId('');
    setEditingError('');
  }, [editingBusy]);

  const onOpenCredentialAction = React.useCallback(
    (action: 'rotate' | 'revoke', apiKey: DashboardConsoleApiKey) => {
      setIsCreateModalOpen(false);
      setEditingApiKeyId('');
      setEditingError('');
      setMutationError('');
      setPendingAction({ type: action, apiKey });
    },
    [],
  );

  const onClosePendingAction = React.useCallback(() => {
    if (pendingAction && busyApiKeyId === pendingAction.apiKey.id) return;
    setPendingAction(null);
    setMutationError('');
  }, [busyApiKeyId, pendingAction]);

  const onCreateApiKey = React.useCallback(
    async (event: React.FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      if (!session.claims) {
        setMutationError(session.errorMessage || t('apiKeysSessionUnavailable'));
        return;
      }
      const name = String(nameInput || '').trim();
      const environmentId = selectedEnvironmentId;
      if (!name) {
        setMutationError(t('apiKeysNameRequired'));
        return;
      }
      if (!environmentId) {
        setMutationError(t('apiKeysSelectEnvironment'));
        return;
      }

      let payload: CreateDashboardApiKeyInput;
      try {
        if (credentialKindInput === 'publishable_key') {
          const allowedOrigins = parseEditableList(allowedOriginsInput);
          if (allowedOrigins.length === 0) {
            setMutationError(t('apiKeysOriginRequired'));
            return;
          }
          if (
            registrationOriginHint &&
            !allowedOrigins.some(
              (origin) => normalizeOrigin(origin) === normalizeOrigin(registrationOriginHint),
            )
          ) {
            setMutationError(
              t('apiKeysOriginMustIncludeRegistration', { origin: registrationOriginHint }),
            );
            return;
          }
          payload = {
            kind: 'publishable_key',
            name,
            environmentId,
            allowedOrigins,
            rateLimitBucket: DEFAULT_RATE_LIMIT_BUCKET,
            quotaBucket: DEFAULT_QUOTA_BUCKET,
            riskPolicy: DEFAULT_RISK_POLICY,
            paymentPolicy: toPaymentPolicyObject(paymentPolicyInput),
          };
        } else {
          const scopes = parseApiCredentialScopeSelection(scopesInput, scopeCatalog);
          const ipAllowlist = parseCsvValues(ipAllowlistInput);
          if (scopes.length === 0) {
            setMutationError(t('apiKeysScopeRequired'));
            return;
          }
          payload = {
            kind: 'secret_key',
            name,
            environmentId,
            scopes,
            ...(ipAllowlist.length > 0 ? { ipAllowlist } : {}),
          };
        }
      } catch (error: unknown) {
        setMutationError(error instanceof Error ? error.message : String(error));
        return;
      }

      setCreating(true);
      setMutationError('');
      try {
        const created = await createDashboardApiKey(payload);
        setRevealedCredential({
          action: 'created',
          apiKey: created.apiKey,
          credential: created.credential,
        });
        setNameInput('');
        setIpAllowlistInput('');
        setScopesInput([...scopeCatalog.defaultScopes]);
        setAllowedOriginsInput(defaultPublishableOrigins);
        setPaymentPolicyInput('disabled');
        setCopyCredentialStatus('');
        setIsCreateModalOpen(false);
        loadApiKeys();
      } catch (error: unknown) {
        setMutationError(error instanceof Error ? error.message : String(error));
      } finally {
        setCreating(false);
      }
    },
    [
      allowedOriginsInput,
      credentialKindInput,
      defaultPublishableOrigins,
      ipAllowlistInput,
      loadApiKeys,
      nameInput,
      paymentPolicyInput,
      scopeCatalog,
      scopesInput,
      selectedEnvironmentId,
      session.claims,
      session.errorMessage,
      registrationOriginHint,
    ],
  );

  const onSaveApiKeyEdits = React.useCallback(
    async (event: React.FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      if (!session.claims) {
        setEditingError(session.errorMessage || t('apiKeysSessionUnavailable'));
        return;
      }
      if (!editingApiKey) {
        setEditingError(t('apiKeysNotFound'));
        return;
      }

      try {
        const name = String(editingNameInput || '').trim();
        if (!name) {
          setEditingError(t('apiKeysNameRequired'));
          return;
        }
        const expiresAt = parseOptionalDateTimeLocalValue(editingExpiresAtInput);
        setEditingBusy(true);
        setEditingError('');

        if (editingApiKey.kind === 'publishable_key') {
          const allowedOrigins = parseEditableList(editingAllowedOriginsInput);
          if (allowedOrigins.length === 0) {
            setEditingError(t('apiKeysOriginRequired'));
            return;
          }
          if (
            registrationOriginHint &&
            !allowedOrigins.some(
              (origin) => normalizeOrigin(origin) === normalizeOrigin(registrationOriginHint),
            )
          ) {
            setEditingError(
              t('apiKeysOriginMustIncludeRegistration', { origin: registrationOriginHint }),
            );
            return;
          }
          await updateDashboardApiKey({
            apiKeyId: editingApiKey.id,
            name,
            allowedOrigins,
            rateLimitBucket:
              String(editingApiKey.rateLimitBucket || '').trim() || DEFAULT_RATE_LIMIT_BUCKET,
            quotaBucket: String(editingApiKey.quotaBucket || '').trim() || DEFAULT_QUOTA_BUCKET,
            riskPolicy:
              Object.keys(editingApiKey.riskPolicy || {}).length > 0
                ? editingApiKey.riskPolicy
                : DEFAULT_RISK_POLICY,
            paymentPolicy: toPaymentPolicyObject(editingPaymentPolicyInput),
            ...(expiresAt !== undefined ? { expiresAt } : {}),
          });
        } else {
          const scopes = parseApiCredentialScopeSelection(editingScopesInput, scopeCatalog);
          if (scopes.length === 0) {
            setEditingError(t('apiKeysScopeRequired'));
            return;
          }
          await updateDashboardApiKey({
            apiKeyId: editingApiKey.id,
            name,
            scopes,
            ipAllowlist: parseCsvValues(editingIpAllowlistInput),
            ...(expiresAt !== undefined ? { expiresAt } : {}),
          });
        }

        await loadApiKeys();
        setEditingApiKeyId('');
      } catch (error: unknown) {
        setEditingError(error instanceof Error ? error.message : String(error));
      } finally {
        setEditingBusy(false);
      }
    },
    [
      editingAllowedOriginsInput,
      editingApiKey,
      editingExpiresAtInput,
      editingIpAllowlistInput,
      editingNameInput,
      editingPaymentPolicyInput,
      editingScopesInput,
      loadApiKeys,
      scopeCatalog,
      session.claims,
      session.errorMessage,
      registrationOriginHint,
    ],
  );

  const onRotateApiKey = React.useCallback(
    async (apiKey: DashboardConsoleApiKey) => {
      if (!session.claims) {
        setMutationError(session.errorMessage || t('apiKeysSessionUnavailable'));
        return;
      }
      setBusyApiKeyId(apiKey.id);
      setMutationError('');
      try {
        const rotated = await rotateDashboardApiKey({
          apiKeyId: apiKey.id,
          reason: 'dashboard manual rotation',
        });
        setRevealedCredential({
          action: 'rotated',
          apiKey: rotated.apiKey,
          credential: rotated.credential,
        });
        setCopyCredentialStatus('');
        setPendingAction(null);
        loadApiKeys();
      } catch (error: unknown) {
        setMutationError(error instanceof Error ? error.message : String(error));
      } finally {
        setBusyApiKeyId('');
      }
    },
    [loadApiKeys, session.claims, session.errorMessage],
  );

  const onRevokeApiKey = React.useCallback(
    async (apiKey: DashboardConsoleApiKey) => {
      if (!session.claims) {
        setMutationError(session.errorMessage || t('apiKeysSessionUnavailable'));
        return;
      }
      setBusyApiKeyId(apiKey.id);
      setMutationError('');
      try {
        await revokeDashboardApiKey({ apiKeyId: apiKey.id });
        setPendingAction(null);
        loadApiKeys();
      } catch (error: unknown) {
        setMutationError(error instanceof Error ? error.message : String(error));
      } finally {
        setBusyApiKeyId('');
      }
    },
    [loadApiKeys, session.claims, session.errorMessage],
  );

  const onDeleteRevokedApiKey = React.useCallback(
    async (apiKey: DashboardConsoleApiKey) => {
      if (!session.claims) {
        setMutationError(session.errorMessage || t('apiKeysSessionUnavailable'));
        return;
      }
      if (apiKey.status !== 'REVOKED') {
        setMutationError(t('apiKeysOnlyRevokedDeletable'));
        return;
      }
      if (!window.confirm(t('apiKeysDeleteConfirm', { kind: apiKey.kind, id: apiKey.id }))) {
        return;
      }
      setBusyApiKeyId(apiKey.id);
      setMutationError('');
      try {
        await deleteRevokedDashboardApiKey({ apiKeyId: apiKey.id });
        if (revealedCredential?.apiKey.id === apiKey.id) {
          setRevealedCredential(null);
          setCopyCredentialStatus('');
        }
        loadApiKeys();
      } catch (error: unknown) {
        setMutationError(error instanceof Error ? error.message : String(error));
      } finally {
        setBusyApiKeyId('');
      }
    },
    [loadApiKeys, revealedCredential?.apiKey.id, session.claims, session.errorMessage],
  );

  return (
    <div className="dashboard-view" aria-label={t('apiKeysPageAria')}>
      <DashboardPageActions>
        <button
          type="button"
          className="dashboard-pagination-button dashboard-pagination-button--primary"
          onClick={onOpenCreateModal}
          disabled={creating || !selectedEnvironmentId}
        >
          {t('apiKeysCreateCredential')}
        </button>
      </DashboardPageActions>

      <CredentialScopeSummary
        environmentId={selectedEnvironmentId}
        environmentName={selectedEnvironmentName}
        network={credentialNetwork}
        projectName={selectedProjectName}
        variant="page"
      />

      {mutationError && !isCreateModalOpen && pendingAction === null ? (
        <p className="dashboard-form-alert" role="alert">
          {mutationError}
        </p>
      ) : null}

      {revealedCredential ? (
        <div className="dashboard-secret-banner">
          <div className="dashboard-secret-banner__header">
            <span className="dashboard-secret-banner__eyebrow">{t('apiKeysShownOnce')}</span>
            <h3>
              {revealedCredential.apiKey.kind === 'publishable_key'
                ? t('apiKeysSaveThisPublishable')
                : t('apiKeysSaveThisSecret')}
            </h3>
            <p>
              {t('apiKeysReturnedOnlyWhen', {
                action:
                  revealedCredential.action === 'created'
                    ? t('apiKeysActionCreated')
                    : t('apiKeysActionRotated'),
              })}{' '}
              <code>{revealedCredential.apiKey.id}</code>
              {t('apiKeysIdExplainerPost')}
            </p>
          </div>
          <div className="dashboard-secret-banner__facts">
            <div className="dashboard-secret-banner__fact">
              <span className="dashboard-secret-banner__fact-label">
                {t('apiKeysCredentialId')}
              </span>
              <code>{revealedCredential.apiKey.id}</code>
            </div>
            <div className="dashboard-secret-banner__fact">
              <span className="dashboard-secret-banner__fact-label">
                {t('apiKeysEnvironmentId')}
              </span>
              <code>{revealedCredential.apiKey.environmentId}</code>
            </div>
            <div className="dashboard-secret-banner__fact">
              <span className="dashboard-secret-banner__fact-label">
                {t('apiKeysCredentialValue')}
              </span>
              <div className="dashboard-secret-banner__secret-row">
                <code className="dashboard-secret-banner__secret-value">
                  {revealedCredential.credential}
                </code>
                <div className="dashboard-secret-banner__copy-action">
                  <CopyButton
                    text={revealedCredential.credential}
                    ariaLabel={t('apiKeysCopyValueAria', { kind: revealedCredential.apiKey.kind })}
                    className="dashboard-context-copy dashboard-secret-banner__copy"
                    size={16}
                    onCopy={() =>
                      setCopyCredentialStatus(
                        t('apiKeysCopied', { kind: revealedCredential.apiKey.kind }),
                      )
                    }
                    onCopyError={() => setCopyCredentialStatus(t('apiKeysCopyFailed'))}
                  />
                  <span>{t('apiKeysCopyValue')}</span>
                </div>
              </div>
            </div>
          </div>
          <p className="dashboard-pagination-note dashboard-secret-banner__hint">
            {t('apiKeysStoreSecurely')}
          </p>
          {copyCredentialStatus ? (
            <p className="dashboard-pagination-note dashboard-secret-banner__status" role="status">
              {copyCredentialStatus}
            </p>
          ) : null}
        </div>
      ) : null}

      {revealedCredential ? (
        <details className="dashboard-view__section" aria-label={t('apiKeysSnippetAria')}>
          <summary>
            {revealedCredential.apiKey.kind === 'publishable_key'
              ? t('apiKeysSnippetBrowserTitle')
              : t('apiKeysSnippetServerTitle')}
          </summary>
          <p>
            {revealedCredential.apiKey.kind === 'publishable_key'
              ? t('apiKeysSnippetBrowserDescription')
              : t('apiKeysSnippetServerDescription')}
          </p>
          <pre className="dashboard-code-block">
            <code>
              {revealedCredential.apiKey.kind === 'publishable_key'
                ? buildPublishableKeyManagedSnippet(
                    revealedCredential.credential,
                    revealedCredential.apiKey.environmentId,
                    revealedCredential.apiKey.allowedOrigins,
                    deployment.walletOrigin,
                  )
                : buildSecretKeyServerSnippet(
                    revealedCredential.credential,
                    revealedCredential.apiKey.environmentId,
                  )}
            </code>
          </pre>
        </details>
      ) : null}

      <DashboardTable
        ariaLabel={t('apiKeysTableAria')}
        className="dashboard-credential-table"
        columns={API_KEYS_TABLE_COLUMNS}
        pagination={apiKeysPagination.pagination}
      >
        <DashboardTableHeader>
          <DashboardTableHeaderCell>{t('apiKeysColName')}</DashboardTableHeaderCell>
          <DashboardTableHeaderCell>{t('apiKeysColStatus')}</DashboardTableHeaderCell>
          <DashboardTableHeaderCell>{t('apiKeysColAccess')}</DashboardTableHeaderCell>
          <DashboardTableHeaderCell>{t('apiKeysColLastUsed')}</DashboardTableHeaderCell>
          <DashboardTableHeaderCell>{t('apiKeysColActions')}</DashboardTableHeaderCell>
        </DashboardTableHeader>
        {session.loading || loading ? (
          <DashboardTableSkeletonRows label={t('apiKeysLoading')} columns={5} />
        ) : !session.claims ? (
          <DashboardTableState>
            {t('apiKeysUnavailableSession', {
              reason: session.errorMessage || t('apiKeysUnauthorized'),
            })}
          </DashboardTableState>
        ) : errorMessage ? (
          <DashboardTableState>
            {t('apiKeysUnavailableError', { reason: errorMessage })}
          </DashboardTableState>
        ) : visibleApiKeys.length === 0 ? (
          <DashboardTableState>{t('apiKeysEmpty')}</DashboardTableState>
        ) : (
          <>
            {apiKeysPagination.rows.map((apiKey) => {
              const preview = describeCredentialNamePreview(apiKey);
              const overage = describeCredentialOverage(apiKey);
              const origins = describeCredentialOrigins(apiKey);
              return (
                <DashboardTableRow key={apiKey.id}>
                  <DashboardTableCell
                    title={`${apiKey.name} · ${formatCredentialKindLabel(apiKey.kind)}`}
                    className="dashboard-data-table__cell--lead"
                  >
                    <div className="dashboard-lead">
                      <span className="dashboard-lead__icon" aria-hidden="true">
                        <KeyRoundIcon size={16} />
                      </span>
                      <span className="dashboard-lead__copy">
                        <span className="dashboard-lead__title">
                          <span className="dashboard-data-table__summary">{apiKey.name}</span>
                          <DashboardTableBadge>
                            {formatCredentialKindChip(apiKey.kind)}
                          </DashboardTableBadge>
                        </span>
                        {preview ? <code className="dashboard-lead__sub">{preview}</code> : null}
                      </span>
                    </div>
                  </DashboardTableCell>
                  <DashboardTableCell>
                    <DashboardTableStatus tone={dashboardStatusTone(apiKey.status)}>
                      {dashboardStatusLabel(apiKey.status)}
                    </DashboardTableStatus>
                  </DashboardTableCell>
                  <DashboardTableCell
                    title={`${origins.title} · ${overage.title}`}
                    className="dashboard-data-table__cell--nowrap"
                  >
                    {origins.short || DASHBOARD_EMPTY_VALUE}
                    {apiKey.kind === 'publishable_key' && overage.short ? (
                      <span className="dashboard-data-table__inline-note"> · {overage.short}</span>
                    ) : null}
                  </DashboardTableCell>
                  <DashboardTableCell truncate>
                    {formatTimestamp(apiKey.lastUsedAt)}
                  </DashboardTableCell>
                  <DashboardTableCell>
                    <DashboardTableActionGroup className="dashboard-credential-table__actions">
                      <DashboardTableActionButton
                        className="dashboard-credential-table__action-button"
                        onClick={() => onOpenEditApiKey(apiKey)}
                        disabled={busyApiKeyId === apiKey.id}
                      >
                        {t('apiKeysEdit')}
                      </DashboardTableActionButton>
                      <DashboardTableActionMenu
                        ariaLabel={t('apiKeysMoreActionsFor', { name: apiKey.name })}
                        items={[
                          {
                            label: t('apiKeysRotate'),
                            onSelect: () => onOpenCredentialAction('rotate', apiKey),
                            disabled: busyApiKeyId === apiKey.id || apiKey.status === 'REVOKED',
                          },
                          apiKey.status === 'REVOKED'
                            ? {
                                label: t('apiKeysDelete'),
                                onSelect: () => onDeleteRevokedApiKey(apiKey),
                                tone: 'danger' as const,
                                disabled: busyApiKeyId === apiKey.id,
                              }
                            : {
                                label: t('apiKeysRevoke'),
                                onSelect: () => onOpenCredentialAction('revoke', apiKey),
                                tone: 'danger' as const,
                                disabled: busyApiKeyId === apiKey.id,
                              },
                        ]}
                      />
                    </DashboardTableActionGroup>
                  </DashboardTableCell>
                </DashboardTableRow>
              );
            })}
          </>
        )}
      </DashboardTable>

      <DashboardInlineModal
        isOpen={isCreateModalOpen}
        ariaLabel={t('apiKeysCreateModalAria')}
        onRequestClose={onCloseCreateModal}
        className="dashboard-modal--wide"
      >
        <h2>{t('apiKeysCreateCredential')}</h2>

        <CredentialScopeSummary
          environmentId={selectedEnvironmentId}
          environmentName={selectedEnvironmentName}
          network={credentialNetwork}
          projectName={selectedProjectName}
          variant="dialog"
        />

        <div className="dashboard-mode-toggle" aria-label={t('apiKeysKindAria')}>
          {(['secret_key', 'publishable_key'] as DashboardCredentialKind[]).map((kind) => {
            const mode = describeCredentialMode(kind);
            return (
              <button
                key={kind}
                type="button"
                aria-pressed={credentialKindInput === kind}
                className={[
                  'dashboard-mode-toggle__button',
                  credentialKindInput === kind ? 'dashboard-mode-toggle__button--active' : '',
                ]
                  .filter(Boolean)
                  .join(' ')}
                onClick={() => setCredentialKindInput(kind)}
                disabled={creating}
              >
                <strong>{mode.title}</strong>
                <span>{mode.summary}</span>
              </button>
            );
          })}
        </div>

        <form className="dashboard-view-grid dashboard-view-grid--two" onSubmit={onCreateApiKey}>
          <label className="dashboard-form-field dashboard-form-field--full">
            <span>{t('apiKeysName')}</span>
            <input
              className="dashboard-input"
              value={nameInput}
              onChange={(event) => setNameInput(event.target.value)}
              placeholder={
                credentialKindInput === 'publishable_key' ? 'frontend-app' : 'server-key'
              }
              disabled={creating}
            />
          </label>

          {credentialKindInput === 'publishable_key' ? (
            <>
              <div className="dashboard-form-field dashboard-form-field--full">
                <UriListEditor
                  label={t('apiKeysAllowedOrigins')}
                  description={
                    <>
                      <p>{t('apiKeysAddOriginExact')}</p>
                      <p>
                        {t('apiKeysBrowserRunningAtPre')}
                        <code>{registrationOriginHint}</code>
                        {t('apiKeysBrowserRunningAtPost')}
                      </p>
                    </>
                  }
                  values={allowedOriginsInput}
                  onChange={setAllowedOriginsInput}
                  placeholder="https://app.example.com"
                  addLabel={t('apiKeysAddUri')}
                  disabled={creating}
                />
              </div>

              <PublishablePaymentPolicyField
                value={paymentPolicyInput}
                onChange={setPaymentPolicyInput}
                disabled={creating}
              />
            </>
          ) : (
            <>
              <div className="dashboard-form-field dashboard-form-field--full">
                <ScopePicker
                  label={t('apiKeysScopes')}
                  options={scopeCatalog.options}
                  values={scopesInput}
                  onChange={setScopesInput}
                  variant="segmented"
                  disabled={creating}
                />
              </div>

              <label className="dashboard-form-field">
                <span>{t('apiKeysSourceIps')}</span>
                <input
                  className="dashboard-input"
                  value={ipAllowlistInput}
                  onChange={(event) => setIpAllowlistInput(event.target.value)}
                  placeholder="203.0.113.10/32, 203.0.113.0/24"
                  disabled={creating}
                />
                <p className="dashboard-pagination-note">
                  {t('apiKeysSourceIpsHelpPre')}
                  <code>secret_key</code>
                  {t('apiKeysSourceIpsHelpPost')}
                </p>
              </label>
            </>
          )}

          {mutationError ? <p className="dashboard-form-alert">{mutationError}</p> : null}

          <div className="dashboard-form-actions">
            <button
              type="button"
              className="dashboard-pagination-button dashboard-pagination-button--secondary"
              onClick={onCloseCreateModal}
              disabled={creating}
            >
              {t('apiKeysCancel')}
            </button>
            <button type="submit" className="dashboard-pagination-button" disabled={creating}>
              {creating
                ? t('apiKeysCreatingProgress')
                : t('apiKeysCreateKind', { kind: credentialKindInput })}
            </button>
          </div>
        </form>
      </DashboardInlineModal>

      <DashboardInlineModal
        isOpen={editingApiKey !== null}
        ariaLabel={t('apiKeysEditModalAria')}
        onRequestClose={onCloseEditApiKey}
        className="dashboard-modal--wide"
      >
        {editingApiKey ? (
          <>
            <h2>{t('apiKeysEditCredential')}</h2>
            <p className="dashboard-pagination-note">
              <code>{editingApiKey.kind}</code> {editingApiKey.id}
            </p>
            <form
              className="dashboard-view-grid dashboard-view-grid--two"
              onSubmit={onSaveApiKeyEdits}
            >
              <label className="dashboard-form-field">
                <span>{t('apiKeysName')}</span>
                <input
                  className="dashboard-input"
                  value={editingNameInput}
                  onChange={(event) => setEditingNameInput(event.target.value)}
                  placeholder="frontend-app"
                  disabled={editingBusy}
                />
              </label>

              <label className="dashboard-form-field">
                <span>{t('apiKeysExpiresAt')}</span>
                <input
                  className="dashboard-input"
                  type="datetime-local"
                  value={editingExpiresAtInput}
                  onChange={(event) => setEditingExpiresAtInput(event.target.value)}
                  disabled={editingBusy}
                />
              </label>

              {editingApiKey.kind === 'publishable_key' ? (
                <>
                  <div className="dashboard-form-field dashboard-form-field--full">
                    <UriListEditor
                      label={t('apiKeysAllowedOrigins')}
                      description={
                        <>
                          <p className="dashboard-pagination-note">
                            {t('apiKeysOriginsStoredPre')}
                            <code>publishable_key</code>
                            {t('apiKeysOriginsStoredPost')}
                          </p>
                          <p className="dashboard-pagination-note">
                            {t('apiKeysExactOriginsOnly')}
                          </p>
                        </>
                      }
                      values={editingAllowedOriginsInput}
                      onChange={setEditingAllowedOriginsInput}
                      placeholder="https://app.example.com"
                      addLabel={t('apiKeysAddUri')}
                      disabled={editingBusy}
                    />
                  </div>

                  <PublishablePaymentPolicyField
                    value={editingPaymentPolicyInput}
                    onChange={setEditingPaymentPolicyInput}
                    disabled={editingBusy}
                  />
                </>
              ) : (
                <>
                  <div className="dashboard-form-field dashboard-form-field--full">
                    <ScopePicker
                      label={t('apiKeysScopes')}
                      options={scopeCatalog.options}
                      values={editingScopesInput}
                      onChange={setEditingScopesInput}
                      variant="segmented"
                      disabled={editingBusy}
                    />
                  </div>

                  <label className="dashboard-form-field">
                    <span>{t('apiKeysSourceIps')}</span>
                    <input
                      className="dashboard-input"
                      value={editingIpAllowlistInput}
                      onChange={(event) => setEditingIpAllowlistInput(event.target.value)}
                      placeholder="203.0.113.10/32, 203.0.113.0/24"
                      disabled={editingBusy}
                    />
                    <p className="dashboard-pagination-note">
                      {t('apiKeysSourceIpsHelpPre')}
                      <code>secret_key</code>
                      {t('apiKeysSourceIpsHelpPost')}
                    </p>
                  </label>
                </>
              )}

              {editingError ? <p className="dashboard-form-alert">{editingError}</p> : null}

              <div className="dashboard-form-actions">
                <button
                  type="button"
                  className="dashboard-pagination-button dashboard-pagination-button--secondary"
                  onClick={onCloseEditApiKey}
                  disabled={editingBusy}
                >
                  {t('apiKeysCancel')}
                </button>
                <button
                  type="submit"
                  className="dashboard-pagination-button"
                  disabled={editingBusy}
                >
                  {editingBusy ? t('apiKeysSavingProgress') : t('apiKeysSaveChanges')}
                </button>
              </div>
            </form>
          </>
        ) : null}
      </DashboardInlineModal>

      <DashboardInlineModal
        isOpen={pendingAction !== null}
        ariaLabel={t('apiKeysConfirmModalAria')}
        onRequestClose={onClosePendingAction}
      >
        {pendingAction ? (
          <>
            <h2>{t('apiKeysConfirmTitle')}</h2>
            <p className="dashboard-pagination-note">
              {pendingAction.type === 'rotate'
                ? t('apiKeysConfirmRotate')
                : t('apiKeysConfirmRevoke')}
            </p>
            <div className="dashboard-view-grid">
              <div className="dashboard-form-field">
                <span>{t('apiKeysCredential')}</span>
                <strong>{pendingAction.apiKey.name}</strong>
                <p className="dashboard-pagination-note">
                  {formatCredentialKindLabel(pendingAction.apiKey.kind)} ·{' '}
                  {formatCredentialEnvironmentLabel(pendingAction.apiKey.environmentId)}
                </p>
                <p className="dashboard-pagination-note">
                  <code>{pendingAction.apiKey.id}</code>
                </p>
              </div>
            </div>

            {mutationError ? <p className="dashboard-form-alert">{mutationError}</p> : null}

            <div className="dashboard-form-actions">
              <button
                type="button"
                className="dashboard-pagination-button dashboard-pagination-button--secondary"
                onClick={onClosePendingAction}
                disabled={busyApiKeyId === pendingAction.apiKey.id}
              >
                {t('apiKeysCancel')}
              </button>
              <button
                type="button"
                className={[
                  'dashboard-pagination-button',
                  pendingAction.type === 'revoke' ? 'dashboard-pagination-button--danger' : '',
                ]
                  .filter(Boolean)
                  .join(' ')}
                onClick={() =>
                  pendingAction.type === 'rotate'
                    ? onRotateApiKey(pendingAction.apiKey)
                    : onRevokeApiKey(pendingAction.apiKey)
                }
                disabled={busyApiKeyId === pendingAction.apiKey.id}
              >
                {busyApiKeyId === pendingAction.apiKey.id
                  ? t(pendingAction.type === 'rotate' ? 'apiKeysRotating' : 'apiKeysRevoking')
                  : formatCredentialActionLabel(pendingAction.type)}
              </button>
            </div>
          </>
        ) : null}
      </DashboardInlineModal>
    </div>
  );
}

export default ApiKeyManagementPage;
