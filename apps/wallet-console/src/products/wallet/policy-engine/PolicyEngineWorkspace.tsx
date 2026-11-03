import React from 'react';
import { t, type MessageKey } from '@core/i18n';
import { formatDashboardTimestamp } from '@core/dashboard/utils/timestamps';
import { toast } from 'sonner';
import { useSiteRouter } from '@core/router/useSiteRouter';
import {
  DashboardTable,
  DashboardTableActionButton,
  DashboardTableActionGroup,
  DashboardTableActionMenu,
  DashboardTableBadge,
  DashboardTableCell,
  DashboardTableDetailsGrid,
  DashboardTableDetailsItem,
  DashboardTableHeader,
  DashboardTableHeaderCell,
  DashboardTableRow,
  DashboardTableState,
  dashboardTableColumns,
  useDashboardTablePagination,
} from '@core/dashboard/components/DashboardTable';
import { ScaleIcon } from '@core/dashboard/icons/SidebarIcons';
import { useDashboardCreateIntent } from '@core/dashboard/utils/routeCreateIntent';
import { DashboardInlineModal } from '@core/dashboard/components/DashboardInlineModal';
import { DashboardPageActions } from '@core/dashboard/components/DashboardPageActions';
import {
  approveDashboardApproval,
  createDashboardApproval,
  listDashboardApprovals,
  rejectDashboardApproval,
  type DashboardConsoleApprovalRequest,
} from '../approvals/consoleApprovalsApi';
import { getDashboardPolicyCoverage, type DashboardPolicyCoverage } from '../consoleInsightsApi';
import {
  formatWalletBalanceMinor,
  listDashboardWallets,
  type DashboardConsoleWallet,
} from '../wallets/consoleWalletApi';
import {
  canDashboardEditProject,
  useDashboardConsoleSession,
} from '@core/dashboard/consoleSession';
import { useSessionDraft } from '@core/dashboard/drafts/useSessionDraft';
import type { DashboardDraftIdentity } from '@core/dashboard/drafts/sessionDraftStore';
import { useDashboardSelectedContext } from '@core/dashboard/selectedContext';
import {
  createDashboardPolicy,
  deleteDashboardPolicy,
  listDashboardPolicies,
  listDashboardPolicyVersions,
  listDashboardPolicyAssignments,
  publishDashboardPolicy,
  simulateDashboardPolicy,
  updateDashboardPolicy,
  type DashboardConsolePolicy,
  type DashboardConsolePolicyVersion,
  type DashboardConsolePolicyAssignment,
  type DashboardConsolePolicySimulation,
} from './consolePoliciesApi';

type PolicyScopeType = 'ORG' | 'PROJECT' | 'ENVIRONMENT' | 'WALLET';
type PolicyCreateMode = 'STANDARD' | 'WALLET_OVERRIDE';
type PolicyModalKind = 'create' | 'details' | 'edit' | 'delete' | 'simulate' | 'publish';
type PolicyStatusFilter = 'ALL' | 'DRAFT' | 'PUBLISHED';
type PolicyImpactFilter = 'ALL' | 'USED' | 'UNUSED';
const POLICY_TABLE_COLUMNS = dashboardTableColumns(2.1, 1.15, 0.7, 0.85, 1.15);

interface PolicyModalState {
  kind: PolicyModalKind;
  policyId?: string;
}

interface PolicyContractRuleDraft {
  id: string;
  contractAddress: string;
  functions: string[];
}

type PolicyContractCallMode = 'ALLOW_ALL' | 'ALLOWLIST';

interface PolicyContractCallsDraft {
  mode: PolicyContractCallMode;
  rules: PolicyContractRuleDraft[];
}

interface PolicyEditorFormState {
  walletId: string;
  policyName: string;
  blockedActions: string[];
  contractCalls: PolicyContractCallsDraft;
  allowedChains: string[];
  maxAmountMinor: string;
}

interface PolicyDraftScope {
  orgId: string;
  projectId: string;
  environmentId: string;
}

interface PolicyRuleReviewRow {
  label: string;
  live: string;
  next: string;
  changed: boolean;
}

interface PolicyReviewTableRow {
  label: string;
  value: React.ReactNode;
}

const POLICY_ACTIONS = [
  'transfer',
  'contract_call',
  'deploy_contract',
  'add_key',
  'delete_key',
  'sign_message',
  'export_key',
] as const;

const POLICY_CHAINS = ['Ethereum', 'NEAR', 'Tempo', 'Arc Circle'] as const;

function allPolicyChains(): string[] {
  return [...POLICY_CHAINS];
}

function walletCountLabel(count: number): string {
  return t(count === 1 ? 'policyWalletCountOne' : 'policyWalletCountMany', { count });
}

/* Fills {name} tokens of a message with React nodes, so a sentence that wraps
   one value in <strong> or <code> keeps its word order in every language. */
function renderMessageWithNodes(
  template: string,
  nodes: Record<string, React.ReactNode>,
): React.ReactNode[] {
  return template.split(/(\{\w+\})/g).map((part, index) => {
    const name = /^\{(\w+)\}$/.exec(part)?.[1];
    if (name !== undefined && nodes[name] !== undefined) {
      return <React.Fragment key={index}>{nodes[name]}</React.Fragment>;
    }
    return part;
  });
}

const EMPTY_ASSIGNMENTS: Record<PolicyScopeType, DashboardConsolePolicyAssignment | null> = {
  ORG: null,
  PROJECT: null,
  ENVIRONMENT: null,
  WALLET: null,
};

function formatTimestamp(value: string | null | undefined): string {
  return formatDashboardTimestamp(value, '—');
}

/* Human labels for the raw policy action identifiers; the API values are
   snake_case and must not leak into the UI. */
const POLICY_ACTION_MESSAGE_KEYS: Record<string, MessageKey> = {
  transfer: 'policyActionTransfer',
  contract_call: 'policyActionContractCall',
  deploy_contract: 'policyActionDeployContract',
  add_key: 'policyActionAddKey',
  delete_key: 'policyActionDeleteKey',
  sign_message: 'policyActionSignMessage',
  export_key: 'policyActionExportKey',
};

function formatPolicyActionLabel(action: string): string {
  const normalized = String(action || '').trim();
  if (!normalized) return action;
  const messageKey = POLICY_ACTION_MESSAGE_KEYS[normalized];
  if (messageKey) return t(messageKey);
  const spaced = normalized.replaceAll('_', ' ');
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

function formatPolicyStatusLabel(status: DashboardConsolePolicy['status']): string {
  switch (status) {
    case 'PUBLISHED':
      return t('policyStatusPublished');
    case 'DRAFT':
      return t('policyStatusDraft');
    case 'ARCHIVED':
      return t('policyStatusArchived');
    default:
      return status;
  }
}

function policyStatusBadgeTone(
  status: DashboardConsolePolicy['status'],
): 'success' | 'warning' | 'danger' | 'neutral' {
  switch (status) {
    case 'PUBLISHED':
      return 'success';
    case 'DRAFT':
      return 'warning';
    case 'ARCHIVED':
      return 'danger';
    default:
      return 'neutral';
  }
}

function defaultPolicyName(createMode: PolicyCreateMode): string {
  if (createMode === 'WALLET_OVERRIDE') return 'Wallet signing override';
  return 'Project signing policy';
}

function readStringRuleList(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const entry of raw) {
    const value = String(entry || '').trim();
    if (!value) continue;
    const key = value.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(value);
  }
  return out;
}

function readNumberRule(raw: unknown): string {
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0) return '';
  return String(Math.floor(value));
}

function parseOptionalNonNegativeInt(raw: string, label: string): number | undefined {
  const trimmed = String(raw || '').trim();
  if (!trimmed) return undefined;
  const value = Number(trimmed);
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(t('policyMustBeNonNegativeInteger', { label }));
  }
  return value;
}

function toggleStringValue(current: string[], value: string): string[] {
  const key = value.toLowerCase();
  if (current.some((entry) => entry.toLowerCase() === key)) {
    return current.filter((entry) => entry.toLowerCase() !== key);
  }
  return [...current, value];
}

function makeDraftId(prefix: string): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}

function normalizeDraftString(value: string): string {
  return String(value || '').trim();
}

function createEmptyContractRuleDraft(): PolicyContractRuleDraft {
  return {
    id: makeDraftId('contract'),
    contractAddress: '',
    functions: [''],
  };
}

const POLICY_EDITOR_FORM_DRAFT_FIELDS = [
  'walletId',
  'policyName',
  'blockedActions',
  'contractCalls',
  'allowedChains',
  'maxAmountMinor',
] as const;
const POLICY_CONTRACT_CALLS_DRAFT_FIELDS = ['mode', 'rules'] as const;

function policyDraftPlainObject(raw: unknown): object | null {
  return raw !== null && typeof raw === 'object' && !Array.isArray(raw) ? raw : null;
}

function policyDraftOwnValue(raw: object, field: string): unknown {
  return Reflect.get(raw, field);
}

function policyDraftExactObject(raw: unknown, expectedFields: readonly string[]): object | null {
  const object = policyDraftPlainObject(raw);
  if (!object) return null;
  const actualFields = Object.keys(object);
  if (actualFields.length !== expectedFields.length) return null;
  return actualFields.every((field) => expectedFields.includes(field)) ? object : null;
}

function createInitialPolicyEditorForm(
  createMode: PolicyCreateMode,
  walletId: string,
): PolicyEditorFormState {
  return {
    walletId: String(walletId || '').trim(),
    policyName: defaultPolicyName(createMode),
    blockedActions: ['delete_key'],
    contractCalls: {
      mode: 'ALLOW_ALL',
      rules: [],
    },
    allowedChains: allPolicyChains(),
    maxAmountMinor: '',
  };
}

function createPolicyEditorFormFromPolicy(
  policy: DashboardConsolePolicy,
  walletId: string,
): PolicyEditorFormState {
  const nextBlockedActions = readStringRuleList(policy.rules.blockedActions).filter(
    (entry) => entry.toLowerCase() !== 'contract_call',
  );
  const nextContractCallRules = readContractCallRuleDrafts(policy.rules.allowedContractCalls);
  return {
    walletId: String(walletId || '').trim(),
    policyName: policy.name || defaultPolicyName('STANDARD'),
    blockedActions: nextBlockedActions,
    contractCalls: {
      mode: nextContractCallRules.length > 0 ? 'ALLOWLIST' : 'ALLOW_ALL',
      rules: nextContractCallRules,
    },
    allowedChains: (() => {
      const configuredChains = readStringRuleList(policy.rules.allowedChains);
      return configuredChains.length > 0 ? configuredChains : allPolicyChains();
    })(),
    maxAmountMinor: readNumberRule(policy.rules.maxAmountMinor),
  };
}

function readContractCallsDraft(raw: unknown): PolicyContractCallsDraft {
  const contractCalls = policyDraftExactObject(raw, POLICY_CONTRACT_CALLS_DRAFT_FIELDS);
  if (!contractCalls) {
    return {
      mode: 'ALLOW_ALL',
      rules: [],
    };
  }
  const mode =
    String(policyDraftOwnValue(contractCalls, 'mode') || '')
      .trim()
      .toUpperCase() === 'ALLOWLIST'
      ? 'ALLOWLIST'
      : 'ALLOW_ALL';
  return {
    mode,
    rules: readContractCallRuleDrafts(policyDraftOwnValue(contractCalls, 'rules')),
  };
}

function parsePolicyEditorDraft(
  raw: unknown,
  fallback: PolicyEditorFormState,
): PolicyEditorFormState | null {
  const form = policyDraftExactObject(raw, POLICY_EDITOR_FORM_DRAFT_FIELDS);
  if (!form) return null;
  return {
    walletId: normalizeDraftString(
      String(policyDraftOwnValue(form, 'walletId') ?? fallback.walletId),
    ),
    policyName: normalizeDraftString(
      String(policyDraftOwnValue(form, 'policyName') ?? fallback.policyName),
    ),
    blockedActions: readStringRuleList(policyDraftOwnValue(form, 'blockedActions')),
    contractCalls: readContractCallsDraft(policyDraftOwnValue(form, 'contractCalls')),
    allowedChains: readStringRuleList(policyDraftOwnValue(form, 'allowedChains')),
    maxAmountMinor: normalizeDraftString(
      String(policyDraftOwnValue(form, 'maxAmountMinor') ?? fallback.maxAmountMinor),
    ),
  };
}

function parsePolicyContractCallRuleDraft(raw: unknown): PolicyContractRuleDraft | null {
  const entry = policyDraftPlainObject(raw);
  if (!entry) return null;
  const hasStoredId = policyDraftExactObject(raw, ['id', 'contractAddress', 'functions']);
  const hasPolicyRule = policyDraftExactObject(raw, ['contractAddress', 'functions']);
  if (!hasStoredId && !hasPolicyRule) return null;
  const functionsRaw = policyDraftOwnValue(entry, 'functions');
  const functions: string[] = [];
  if (Array.isArray(functionsRaw)) {
    for (const value of functionsRaw) {
      const normalized = normalizeDraftString(String(value || ''));
      if (normalized) functions.push(normalized);
    }
  }
  return {
    id: makeDraftId('contract'),
    contractAddress: normalizeDraftString(
      String(policyDraftOwnValue(entry, 'contractAddress') || ''),
    ),
    functions: functions.length > 0 ? functions : [''],
  };
}

function readContractCallRuleDrafts(raw: unknown): PolicyContractRuleDraft[] {
  if (!Array.isArray(raw)) return [];
  const out: PolicyContractRuleDraft[] = [];
  for (const entry of raw) {
    const parsed = parsePolicyContractCallRuleDraft(entry);
    if (parsed) out.push(parsed);
  }
  return out;
}

function arePolicyStringListsEqual(left: readonly string[], right: readonly string[]): boolean {
  if (left.length !== right.length) return false;
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) return false;
  }
  return true;
}

function arePolicyContractRuleDraftsEqual(
  left: readonly PolicyContractRuleDraft[],
  right: readonly PolicyContractRuleDraft[],
): boolean {
  if (left.length !== right.length) return false;
  for (let index = 0; index < left.length; index += 1) {
    const leftEntry = left[index];
    const rightEntry = right[index];
    if (
      leftEntry.id !== rightEntry.id ||
      leftEntry.contractAddress !== rightEntry.contractAddress ||
      !arePolicyStringListsEqual(leftEntry.functions, rightEntry.functions)
    ) {
      return false;
    }
  }
  return true;
}

function arePolicyEditorFormsEqual(
  left: PolicyEditorFormState,
  right: PolicyEditorFormState,
): boolean {
  return (
    left.walletId === right.walletId &&
    left.policyName === right.policyName &&
    arePolicyStringListsEqual(left.blockedActions, right.blockedActions) &&
    left.contractCalls.mode === right.contractCalls.mode &&
    arePolicyContractRuleDraftsEqual(left.contractCalls.rules, right.contractCalls.rules) &&
    arePolicyStringListsEqual(left.allowedChains, right.allowedChains) &&
    left.maxAmountMinor === right.maxAmountMinor
  );
}

function rulesSummary(policy: DashboardConsolePolicy): string {
  const chains = readStringRuleList(policy.rules.allowedChains);
  const blockedActions = readStringRuleList(policy.rules.blockedActions);
  const maxAmountMinor = readNumberRule(policy.rules.maxAmountMinor);
  const contractCalls = readContractCallRuleDrafts(policy.rules.allowedContractCalls);
  return [
    chains.length > 0
      ? t('policyRulesChains', { list: chains.join(', ') })
      : t('policyRulesChainsAll'),
    blockedActions.length > 0
      ? t('policyRulesBlocked', { list: blockedActions.join(', ') })
      : t('policyRulesBlockedNone'),
    contractCalls.length > 0
      ? t(
          contractCalls.length === 1
            ? 'policyRulesContractCallsOne'
            : 'policyRulesContractCallsMany',
          { count: contractCalls.length },
        )
      : t('policyRulesContractCallsAll'),
    maxAmountMinor
      ? t('policyRulesMaxAmount', { amount: maxAmountMinor })
      : t('policyRulesMaxAmountNone'),
  ].join(' | ');
}

function summarizeRuleList(values: string[], emptyLabel: string): string {
  return values.length > 0 ? values.join(', ') : emptyLabel;
}

function summarizeContractCallRules(raw: unknown): string {
  const rules = readContractCallRuleDrafts(raw);
  if (rules.length === 0) return t('policyAllowAll');
  return rules
    .map((rule) => {
      const contractAddress = normalizeDraftString(rule.contractAddress).toLowerCase();
      const functions = rule.functions.map((entry) => normalizeDraftString(entry)).filter(Boolean);
      if (functions.length === 0) {
        return t('policyContractAllFunctions', { address: contractAddress });
      }
      const preview = functions.slice(0, 2).join(', ');
      const more =
        functions.length > 2
          ? t('policyContractFunctionsMore', { count: functions.length - 2 })
          : '';
      return t('policyContractFunctions', { address: contractAddress, preview, more });
    })
    .join('; ');
}

function buildPolicyRuleReviewRows(
  liveRules: Record<string, unknown> | null,
  nextRules: Record<string, unknown>,
): PolicyRuleReviewRow[] {
  const liveBlockedActions = summarizeRuleList(
    readStringRuleList(liveRules?.blockedActions),
    t('policyNone'),
  );
  const nextBlockedActions = summarizeRuleList(
    readStringRuleList(nextRules.blockedActions),
    t('policyNone'),
  );
  const liveAllowedChains = summarizeRuleList(
    readStringRuleList(liveRules?.allowedChains),
    t('policyAllChains'),
  );
  const nextAllowedChains = summarizeRuleList(
    readStringRuleList(nextRules.allowedChains),
    t('policyAllChains'),
  );
  const liveContractCalls = summarizeContractCallRules(liveRules?.allowedContractCalls);
  const nextContractCalls = summarizeContractCallRules(nextRules.allowedContractCalls);
  const liveMaxAmountMinor = readNumberRule(liveRules?.maxAmountMinor) || t('policyNoLimit');
  const nextMaxAmountMinor = readNumberRule(nextRules.maxAmountMinor) || t('policyNoLimit');
  return [
    {
      label: t('policyRuleBlockedActions'),
      live: liveBlockedActions,
      next: nextBlockedActions,
      changed: liveBlockedActions !== nextBlockedActions,
    },
    {
      label: t('policyRuleAllowedChains'),
      live: liveAllowedChains,
      next: nextAllowedChains,
      changed: liveAllowedChains !== nextAllowedChains,
    },
    {
      label: t('policyRuleContractCalls'),
      live: liveContractCalls,
      next: nextContractCalls,
      changed: liveContractCalls !== nextContractCalls,
    },
    {
      label: t('policyRuleMaxAmount'),
      live: liveMaxAmountMinor,
      next: nextMaxAmountMinor,
      changed: liveMaxAmountMinor !== nextMaxAmountMinor,
    },
  ];
}

function PolicyReviewTable(props: {
  ariaLabel: string;
  rows: PolicyReviewTableRow[];
}): React.JSX.Element {
  return (
    <div className="dashboard-policy-go-live__table-wrap">
      <table className="dashboard-policy-go-live__table" aria-label={props.ariaLabel}>
        <tbody>
          {props.rows.map((row) => (
            <tr key={row.label}>
              <th scope="row">{row.label}</th>
              <td>{row.value}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function PolicyRuleComparisonTable(props: {
  ariaLabel: string;
  rows: PolicyRuleReviewRow[];
  nextColumnLabel: string;
  showLiveColumn: boolean;
}): React.JSX.Element {
  return (
    <div className="dashboard-policy-go-live__table-wrap">
      <table
        className="dashboard-policy-go-live__table dashboard-policy-go-live__table--comparison"
        aria-label={props.ariaLabel}
      >
        <thead>
          <tr>
            <th scope="col">{t('policyColumnRule')}</th>
            {props.showLiveColumn ? <th scope="col">{t('policyColumnLiveNow')}</th> : null}
            <th scope="col">{props.nextColumnLabel}</th>
          </tr>
        </thead>
        <tbody>
          {props.rows.map((entry) => (
            <tr
              key={entry.label}
              className={entry.changed ? 'dashboard-policy-go-live__comparison-row--changed' : ''}
            >
              <th scope="row">
                <div className="dashboard-policy-go-live__comparison-label">
                  <span>{entry.label}</span>
                  <DashboardTableBadge tone={entry.changed ? 'warning' : 'neutral'}>
                    {entry.changed ? t('policyBadgeChanged') : t('policyBadgeCurrent')}
                  </DashboardTableBadge>
                </div>
              </th>
              {props.showLiveColumn ? <td>{entry.live}</td> : null}
              <td>{entry.next}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function simulationSummary(result: DashboardConsolePolicySimulation): string {
  const chainLabel = result.normalizedRequest.chain || t('policySimAnyChain');
  const amountLabel =
    result.normalizedRequest.amountMinor == null
      ? t('policySimNoAmount')
      : `${result.normalizedRequest.amountMinor}`;
  const contractLabel = result.normalizedRequest.contractAddress
    ? result.normalizedRequest.functionSelector
      ? t('policySimContractFunction', {
          address: result.normalizedRequest.contractAddress,
          selector: result.normalizedRequest.functionSelector,
        })
      : t('policySimContract', { address: result.normalizedRequest.contractAddress })
    : '';
  const summaryParams = {
    action: result.normalizedRequest.action,
    chain: chainLabel,
    amount: amountLabel,
    contract: contractLabel,
  };
  if (result.decision === 'ALLOW') {
    return t('policySimAllowed', summaryParams);
  }
  const denySummary = result.denyReasons
    .map((entry) => `${entry.code}: ${entry.message}`)
    .join(' ');
  return t('policySimDenied', { ...summaryParams, reasons: denySummary });
}

function policyCoverageSummary(entry: DashboardPolicyCoverage['policies'][number] | null): string {
  if (!entry) return t('policyCoverageNone');
  return t('policyCoverageSummary', {
    wallets: walletCountLabel(entry.walletCount),
    balance: formatWalletBalanceMinor(entry.totalBalanceMinor),
    time: formatTimestamp(entry.lastActivityAt),
  });
}

function describePolicyDraftComparison(input: {
  policy: DashboardConsolePolicy;
  latestPublishedVersion: DashboardConsolePolicyVersion | null;
  changedRows: PolicyRuleReviewRow[];
}): string {
  if (input.policy.status === 'PUBLISHED') return t('policyDraftAlreadyLive');
  if (!input.latestPublishedVersion) return t('policyDraftNotPublished');
  if (input.changedRows.length === 0) return t('policyDraftMatchesLive');
  return t(input.changedRows.length === 1 ? 'policyDraftChangesOne' : 'policyDraftChangesMany', {
    count: input.changedRows.length,
  });
}

function readPolicyEngineRouteSelection(): {
  policyId: string;
  approvalId: string;
} {
  if (typeof window === 'undefined') {
    return {
      policyId: '',
      approvalId: '',
    };
  }
  const searchParams = new URLSearchParams(window.location.search);
  return {
    policyId: String(searchParams.get('policyId') || '').trim(),
    approvalId: String(searchParams.get('approvalId') || '').trim(),
  };
}

export function PolicyEnginePage(): React.JSX.Element {
  const session = useDashboardConsoleSession();
  const selectedContext = useDashboardSelectedContext();
  const { go } = useSiteRouter();
  const [requestedPolicyId, setRequestedPolicyId] = React.useState<string>(
    () => readPolicyEngineRouteSelection().policyId,
  );
  const [requestedApprovalId, setRequestedApprovalId] = React.useState<string>(
    () => readPolicyEngineRouteSelection().approvalId,
  );

  const orgScopeId =
    String(selectedContext.organization || session.claims?.orgId || '').trim() ||
    String(session.claims?.orgId || '').trim();
  const projectScopeId =
    String(selectedContext.project || session.claims?.projectId || '').trim() || '';
  const environmentScopeId = String(selectedContext.environment || '').trim() || '';

  const [policiesLoading, setPoliciesLoading] = React.useState<boolean>(true);
  const [policiesErrorMessage, setPoliciesErrorMessage] = React.useState<string>('');
  const [policies, setPolicies] = React.useState<DashboardConsolePolicy[]>([]);

  const [assignmentsByScope, setAssignmentsByScope] =
    React.useState<Record<PolicyScopeType, DashboardConsolePolicyAssignment | null>>(
      EMPTY_ASSIGNMENTS,
    );

  const [coverageLoading, setCoverageLoading] = React.useState<boolean>(true);
  const [coverageErrorMessage, setCoverageErrorMessage] = React.useState<string>('');
  const [coverage, setCoverage] = React.useState<DashboardPolicyCoverage | null>(null);

  const [walletsLoading, setWalletsLoading] = React.useState<boolean>(true);
  const [walletsErrorMessage, setWalletsErrorMessage] = React.useState<string>('');
  const [wallets, setWallets] = React.useState<DashboardConsoleWallet[]>([]);

  const [approvalsLoading, setApprovalsLoading] = React.useState<boolean>(true);
  const [approvalsErrorMessage, setApprovalsErrorMessage] = React.useState<string>('');
  const [approvals, setApprovals] = React.useState<DashboardConsoleApprovalRequest[]>([]);

  const [policyVersionsLoading, setPolicyVersionsLoading] = React.useState<boolean>(false);
  const [policyVersionsErrorMessage, setPolicyVersionsErrorMessage] = React.useState<string>('');
  const [activePolicyVersions, setActivePolicyVersions] = React.useState<
    DashboardConsolePolicyVersion[]
  >([]);

  const [activeModal, setActiveModal] = React.useState<PolicyModalState | null>(null);
  const [creatingNewPolicy, setCreatingNewPolicy] = React.useState<boolean>(false);
  const [policyCreateMode, setPolicyCreateMode] = React.useState<PolicyCreateMode>('STANDARD');
  const [selectedPolicyId, setSelectedPolicyId] = React.useState<string>('');
  const [policyQuery, setPolicyQuery] = React.useState<string>('');
  const [statusFilter, setStatusFilter] = React.useState<PolicyStatusFilter>('ALL');
  const [impactFilter, setImpactFilter] = React.useState<PolicyImpactFilter>('ALL');
  const [policyDraftScope, setPolicyDraftScope] = React.useState<PolicyDraftScope | null>(null);
  const [policyEditorInitialForm, setPolicyEditorInitialForm] =
    React.useState<PolicyEditorFormState>(() => createInitialPolicyEditorForm('STANDARD', ''));

  const [simulationAction, setSimulationAction] = React.useState<string>('transfer');
  const [simulationChain, setSimulationChain] = React.useState<string>('Ethereum');
  const [simulationAmountMinor, setSimulationAmountMinor] = React.useState<string>('10000');
  const [simulationContractAddress, setSimulationContractAddress] = React.useState<string>('');
  const [simulationFunctionSelector, setSimulationFunctionSelector] = React.useState<string>('');
  const [simulationBusy, setSimulationBusy] = React.useState<boolean>(false);
  const [simulationErrorMessage, setSimulationErrorMessage] = React.useState<string>('');
  const [simulationResult, setSimulationResult] =
    React.useState<DashboardConsolePolicySimulation | null>(null);

  const [approvalCreateReason, setApprovalCreateReason] = React.useState<string>(
    'Policy reviewed for publish.',
  );
  const [approvalDecisionReason, setApprovalDecisionReason] = React.useState<string>(
    'Reviewed in policy engine.',
  );
  const [selectedApprovalId, setSelectedApprovalId] = React.useState<string>('');

  const [mutationBusy, setMutationBusy] = React.useState<string>('');
  const [mutationErrorMessage, setMutationErrorMessage] = React.useState<string>('');

  React.useEffect(() => {
    if (typeof window === 'undefined') return;
    const syncRequestedRouteSelection = () => {
      const nextSelection = readPolicyEngineRouteSelection();
      setRequestedPolicyId(nextSelection.policyId);
      setRequestedApprovalId(nextSelection.approvalId);
    };
    window.addEventListener('popstate', syncRequestedRouteSelection);
    window.addEventListener('site:navigate', syncRequestedRouteSelection as EventListener);
    return () => {
      window.removeEventListener('popstate', syncRequestedRouteSelection);
      window.removeEventListener('site:navigate', syncRequestedRouteSelection as EventListener);
    };
  }, []);

  const currentContextScopeType = React.useMemo<PolicyScopeType>(() => {
    if (environmentScopeId) return 'ENVIRONMENT';
    if (projectScopeId) return 'PROJECT';
    return 'ORG';
  }, [environmentScopeId, projectScopeId]);

  const currentContextScopeId = React.useMemo(() => {
    if (currentContextScopeType === 'ENVIRONMENT') return environmentScopeId;
    if (currentContextScopeType === 'PROJECT') return projectScopeId;
    return orgScopeId;
  }, [currentContextScopeType, environmentScopeId, orgScopeId, projectScopeId]);

  const canMutatePolicies = React.useMemo(() => {
    return canDashboardEditProject(session.claims, projectScopeId);
  }, [projectScopeId, session.claims]);

  const selectedPolicy = React.useMemo(
    () => policies.find((entry) => entry.id === selectedPolicyId) || null,
    [policies, selectedPolicyId],
  );

  const policyById = React.useMemo(() => {
    const out = new Map<string, DashboardConsolePolicy>();
    for (const policy of policies) out.set(policy.id, policy);
    return out;
  }, [policies]);

  const policyEditorModalOpen = activeModal?.kind === 'create' || activeModal?.kind === 'edit';

  const policyEditorDraftIdentity = React.useMemo<DashboardDraftIdentity | null>(() => {
    if (!policyEditorModalOpen || !policyDraftScope || !activeModal) return null;
    return {
      route: '/dashboard/policy-engine',
      builderId: 'policy-engine-policy-modal',
      mode: activeModal.kind === 'edit' ? 'edit' : 'create',
      orgId: policyDraftScope.orgId,
      projectId: policyDraftScope.projectId,
      environmentId: policyDraftScope.environmentId,
      resourceId:
        activeModal.kind === 'edit'
          ? String(activeModal.policyId || selectedPolicyId || '')
          : policyCreateMode === 'WALLET_OVERRIDE'
            ? 'wallet-override'
            : 'standard',
    };
  }, [activeModal, policyCreateMode, policyDraftScope, policyEditorModalOpen, selectedPolicyId]);

  const parsePolicyEditorFormDraft = React.useCallback(
    (raw: unknown): PolicyEditorFormState | null =>
      parsePolicyEditorDraft(raw, policyEditorInitialForm),
    [policyEditorInitialForm],
  );

  const {
    form: policyEditorForm,
    setForm: setPolicyEditorForm,
    restoreState: policyEditorRestoreState,
    clearDraft: clearPolicyEditorDraft,
    resetToInitial: resetPolicyEditorDraftToInitial,
  } = useSessionDraft<PolicyEditorFormState>({
    identity: policyEditorDraftIdentity,
    initialForm: policyEditorInitialForm,
    isOpen: policyEditorModalOpen,
    parseForm: parsePolicyEditorFormDraft,
  });
  const restoredDraftToastKeyRef = React.useRef<string>('');

  const directAssignment = assignmentsByScope[currentContextScopeType];

  const effectiveAssignment = React.useMemo(() => {
    if (currentContextScopeType === 'ENVIRONMENT') {
      return assignmentsByScope.ENVIRONMENT || assignmentsByScope.PROJECT || assignmentsByScope.ORG;
    }
    if (currentContextScopeType === 'PROJECT') {
      return assignmentsByScope.PROJECT || assignmentsByScope.ORG;
    }
    return assignmentsByScope.ORG;
  }, [assignmentsByScope, currentContextScopeType]);

  const coverageByPolicyId = React.useMemo(() => {
    const out = new Map<string, DashboardPolicyCoverage['policies'][number]>();
    for (const entry of coverage?.policies || []) out.set(entry.policyId, entry);
    return out;
  }, [coverage]);

  const visiblePolicies = React.useMemo(() => {
    const scopedPolicyIds = new Set<string>();
    for (const assignment of Object.values(assignmentsByScope)) {
      if (assignment?.policyId) scopedPolicyIds.add(assignment.policyId);
    }
    for (const entry of coverage?.policies || []) {
      if (entry.policyId) scopedPolicyIds.add(entry.policyId);
    }
    if (requestedPolicyId) scopedPolicyIds.add(requestedPolicyId);
    for (const policy of policies) {
      if (policy.status === 'DRAFT') scopedPolicyIds.add(policy.id);
    }
    const rows = policies.filter((policy) => scopedPolicyIds.has(policy.id));
    return rows.length > 0 ? rows : policies;
  }, [assignmentsByScope, coverage, policies, requestedPolicyId]);

  const relevantApprovals = React.useMemo(() => {
    if (!selectedPolicyId) return [];
    return approvals.filter(
      (entry) => entry.operationType === 'POLICY_PUBLISH' && entry.resourceId === selectedPolicyId,
    );
  }, [approvals, selectedPolicyId]);

  const approvedApprovals = React.useMemo(
    () => relevantApprovals.filter((entry) => entry.status === 'APPROVED'),
    [relevantApprovals],
  );

  React.useEffect(() => {
    if (
      !policyEditorModalOpen ||
      policyEditorRestoreState !== 'restored' ||
      !policyEditorDraftIdentity
    )
      return;
    const toastKey = [
      policyEditorDraftIdentity.mode,
      policyEditorDraftIdentity.orgId,
      policyEditorDraftIdentity.projectId,
      policyEditorDraftIdentity.environmentId,
      policyEditorDraftIdentity.resourceId || '',
    ].join(':');
    if (restoredDraftToastKeyRef.current === toastKey) return;
    restoredDraftToastKeyRef.current = toastKey;
    toast(t('policyDraftRestored'), {
      id: `policy-engine-draft:${toastKey}`,
      description: null,
    });
  }, [policyEditorDraftIdentity, policyEditorModalOpen, policyEditorRestoreState]);

  React.useEffect(() => {
    if (policyEditorModalOpen) return;
    restoredDraftToastKeyRef.current = '';
  }, [policyEditorModalOpen]);

  const policyVersionsTargetId = String(activeModal?.policyId || '').trim();

  React.useEffect(() => {
    const policyId = policyVersionsTargetId;
    if (!policyId) {
      setPolicyVersionsLoading(false);
      setPolicyVersionsErrorMessage('');
      setActivePolicyVersions([]);
      return;
    }
    let cancelled = false;
    setPolicyVersionsLoading(true);
    setPolicyVersionsErrorMessage('');
    setActivePolicyVersions([]);
    listDashboardPolicyVersions(policyId)
      .then((versions) => {
        if (cancelled) return;
        setActivePolicyVersions(versions);
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setActivePolicyVersions([]);
        setPolicyVersionsErrorMessage(error instanceof Error ? error.message : String(error));
      })
      .finally(() => {
        if (cancelled) return;
        setPolicyVersionsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [policyVersionsTargetId]);

  const loadPolicies = React.useCallback(async (): Promise<void> => {
    if (!session.claims) {
      setPolicies([]);
      setPoliciesLoading(false);
      setPoliciesErrorMessage(session.errorMessage || t('policySessionUnavailable'));
      return;
    }
    setPoliciesLoading(true);
    setPoliciesErrorMessage('');
    try {
      const rows = await listDashboardPolicies({ kind: 'TRANSACTION' });
      setPolicies([...rows].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)));
    } catch (error: unknown) {
      setPolicies([]);
      setPoliciesErrorMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setPoliciesLoading(false);
    }
  }, [session.claims, session.errorMessage]);

  const loadAssignments = React.useCallback(async (): Promise<void> => {
    if (!session.claims) {
      setAssignmentsByScope(EMPTY_ASSIGNMENTS);
      return;
    }
    try {
      const nextAssignments: Record<PolicyScopeType, DashboardConsolePolicyAssignment | null> = {
        ORG: null,
        PROJECT: null,
        ENVIRONMENT: null,
        WALLET: null,
      };
      const targets: Array<{ scopeType: PolicyScopeType; scopeId: string }> = [];
      if (orgScopeId) targets.push({ scopeType: 'ORG', scopeId: orgScopeId });
      if (projectScopeId) targets.push({ scopeType: 'PROJECT', scopeId: projectScopeId });
      if (environmentScopeId)
        targets.push({ scopeType: 'ENVIRONMENT', scopeId: environmentScopeId });

      await Promise.all(
        targets.map(async (target) => {
          const rows = await listDashboardPolicyAssignments(target);
          nextAssignments[target.scopeType] =
            [...rows].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0] || null;
        }),
      );
      setAssignmentsByScope(nextAssignments);
    } catch {
      setAssignmentsByScope(EMPTY_ASSIGNMENTS);
    }
  }, [environmentScopeId, orgScopeId, projectScopeId, session.claims]);

  const loadCoverage = React.useCallback(async (): Promise<void> => {
    if (!session.claims) {
      setCoverage(null);
      setCoverageLoading(false);
      setCoverageErrorMessage(session.errorMessage || t('policySessionUnavailable'));
      return;
    }
    setCoverageLoading(true);
    setCoverageErrorMessage('');
    try {
      const next = await getDashboardPolicyCoverage({
        ...(projectScopeId ? { projectId: projectScopeId } : {}),
        ...(environmentScopeId ? { environmentId: environmentScopeId } : {}),
      });
      setCoverage(next);
    } catch (error: unknown) {
      setCoverage(null);
      setCoverageErrorMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setCoverageLoading(false);
    }
  }, [environmentScopeId, projectScopeId, session.claims, session.errorMessage]);

  const loadWallets = React.useCallback(async (): Promise<void> => {
    if (!session.claims) {
      setWallets([]);
      setWalletsLoading(false);
      setWalletsErrorMessage(session.errorMessage || t('policySessionUnavailable'));
      return;
    }
    setWalletsLoading(true);
    setWalletsErrorMessage('');
    try {
      const page = await listDashboardWallets({
        limit: 25,
        ...(projectScopeId ? { projectId: projectScopeId } : {}),
        ...(environmentScopeId ? { environmentId: environmentScopeId } : {}),
      });
      setWallets(page.wallets);
    } catch (error: unknown) {
      setWallets([]);
      setWalletsErrorMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setWalletsLoading(false);
    }
  }, [environmentScopeId, projectScopeId, session.claims, session.errorMessage]);

  const loadApprovals = React.useCallback(async (): Promise<void> => {
    if (!session.claims) {
      setApprovals([]);
      setApprovalsLoading(false);
      setApprovalsErrorMessage(session.errorMessage || t('policySessionUnavailable'));
      return;
    }
    setApprovalsLoading(true);
    setApprovalsErrorMessage('');
    try {
      const rows = await listDashboardApprovals({
        operationType: 'POLICY_PUBLISH',
        ...(projectScopeId ? { projectId: projectScopeId } : {}),
        ...(environmentScopeId ? { environmentId: environmentScopeId } : {}),
      });
      setApprovals(rows);
    } catch (error: unknown) {
      setApprovals([]);
      setApprovalsErrorMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setApprovalsLoading(false);
    }
  }, [environmentScopeId, projectScopeId, session.claims, session.errorMessage]);

  const refreshWorkspace = React.useCallback(() => {
    void Promise.all([
      loadPolicies(),
      loadAssignments(),
      loadCoverage(),
      loadWallets(),
      loadApprovals(),
    ]);
  }, [loadApprovals, loadAssignments, loadCoverage, loadPolicies, loadWallets]);

  React.useEffect(() => {
    if (session.loading) return;
    refreshWorkspace();
  }, [refreshWorkspace, session.loading]);

  React.useEffect(() => {
    if (creatingNewPolicy) return;
    if (requestedPolicyId && policies.some((entry) => entry.id === requestedPolicyId)) {
      if (selectedPolicyId !== requestedPolicyId) {
        setSelectedPolicyId(requestedPolicyId);
      }
      return;
    }
    if (selectedPolicyId && policies.some((entry) => entry.id === selectedPolicyId)) return;
    const nextPolicyId =
      directAssignment?.policyId ||
      effectiveAssignment?.policyId ||
      policies.find((entry) => entry.status === 'DRAFT')?.id ||
      policies[0]?.id ||
      '';
    setSelectedPolicyId(nextPolicyId);
  }, [
    creatingNewPolicy,
    directAssignment,
    effectiveAssignment,
    policies,
    requestedPolicyId,
    selectedPolicyId,
  ]);

  React.useEffect(() => {
    if (!selectedPolicyId) {
      const fallbackApprovalId =
        approvedApprovals.find((entry) => entry.id === requestedApprovalId)?.id ||
        approvedApprovals[0]?.id ||
        '';
      if (selectedApprovalId !== fallbackApprovalId) setSelectedApprovalId(fallbackApprovalId);
      return;
    }
    const requestedApproval =
      relevantApprovals.find((entry) => entry.id === requestedApprovalId) || null;
    if (requestedApproval?.status === 'APPROVED') {
      if (selectedApprovalId !== requestedApproval.id) setSelectedApprovalId(requestedApproval.id);
      return;
    }
    const stillSelectedApproved = approvedApprovals.some(
      (entry) => entry.id === selectedApprovalId,
    );
    if (stillSelectedApproved) return;
    setSelectedApprovalId(approvedApprovals[0]?.id || '');
  }, [
    approvedApprovals,
    relevantApprovals,
    requestedApprovalId,
    selectedApprovalId,
    selectedPolicyId,
  ]);

  React.useEffect(() => {
    if (!requestedPolicyId) {
      setPolicyQuery('');
      setActiveModal((current) => (current?.kind === 'details' ? null : current));
      return;
    }
    setPolicyQuery((current) => (current === requestedPolicyId ? current : requestedPolicyId));
    setStatusFilter('ALL');
    setImpactFilter('ALL');
    setSelectedPolicyId((current) => (current === requestedPolicyId ? current : requestedPolicyId));
    setActiveModal((current) =>
      current?.kind === 'details' && current.policyId === requestedPolicyId
        ? current
        : { kind: 'details', policyId: requestedPolicyId },
    );
  }, [requestedPolicyId]);

  const openCreatePolicyModal = React.useCallback(() => {
    setCreatingNewPolicy(true);
    setPolicyCreateMode('STANDARD');
    setSelectedPolicyId('');
    setPolicyDraftScope({
      orgId: orgScopeId,
      projectId: projectScopeId,
      environmentId: environmentScopeId,
    });
    setPolicyEditorInitialForm(createInitialPolicyEditorForm('STANDARD', ''));
    setSimulationResult(null);
    setSimulationErrorMessage('');
    setMutationErrorMessage('');
    setActiveModal({ kind: 'create' });
  }, [environmentScopeId, orgScopeId, projectScopeId]);

  /* Opened from the rail's "+", including while this route is already on
     screen. */
  useDashboardCreateIntent('/dashboard/policy-engine', canMutatePolicies, openCreatePolicyModal);

  const openCreateWalletOverrideModal = React.useCallback(() => {
    setCreatingNewPolicy(true);
    setPolicyCreateMode('WALLET_OVERRIDE');
    setSelectedPolicyId('');
    setPolicyDraftScope({
      orgId: orgScopeId,
      projectId: projectScopeId,
      environmentId: environmentScopeId,
    });
    setPolicyEditorInitialForm(createInitialPolicyEditorForm('WALLET_OVERRIDE', ''));
    setSimulationResult(null);
    setSimulationErrorMessage('');
    setMutationErrorMessage('');
    setActiveModal({ kind: 'create' });
  }, [environmentScopeId, orgScopeId, projectScopeId]);

  const setPolicyModalState = React.useCallback(
    (kind: Exclude<PolicyModalKind, 'create'>, policyId: string) => {
      setCreatingNewPolicy(false);
      setPolicyCreateMode('STANDARD');
      setSelectedPolicyId(policyId);
      if (kind === 'edit') {
        setPolicyDraftScope({
          orgId: orgScopeId,
          projectId: projectScopeId,
          environmentId: environmentScopeId,
        });
        const selected = policyById.get(policyId) || null;
        setPolicyEditorInitialForm(
          selected
            ? createPolicyEditorFormFromPolicy(selected, '')
            : createInitialPolicyEditorForm('STANDARD', ''),
        );
      } else {
        setPolicyDraftScope(null);
      }
      setSimulationResult(null);
      setSimulationErrorMessage('');
      setMutationErrorMessage('');
      setActiveModal({ kind, policyId });
    },
    [environmentScopeId, orgScopeId, policyById, projectScopeId],
  );

  const clearPolicyModalState = React.useCallback(() => {
    setActiveModal(null);
    setSimulationErrorMessage('');
    setSimulationResult(null);
    if (creatingNewPolicy) {
      setCreatingNewPolicy(false);
    }
  }, [creatingNewPolicy]);

  const closePolicyModal = React.useCallback(() => {
    clearPolicyModalState();
    if (activeModal?.kind === 'details' && requestedPolicyId) {
      go('/dashboard/policy-engine');
    }
  }, [activeModal, clearPolicyModalState, go, requestedPolicyId]);

  const selectedContextScopeKey = `${orgScopeId}:${projectScopeId}:${environmentScopeId}`;
  const previousSelectedContextScopeKeyRef = React.useRef<string>(selectedContextScopeKey);
  React.useEffect(() => {
    if (previousSelectedContextScopeKeyRef.current === selectedContextScopeKey) return;
    previousSelectedContextScopeKeyRef.current = selectedContextScopeKey;
    if (!policyEditorModalOpen) return;
    closePolicyModal();
  }, [closePolicyModal, policyEditorModalOpen, selectedContextScopeKey]);

  const savePolicy = React.useCallback(
    async (event: React.FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      if (!session.claims) {
        setMutationErrorMessage(session.errorMessage || t('policySessionUnavailable'));
        return;
      }
      if (!canMutatePolicies) {
        setMutationErrorMessage(t('policyAccessRequired'));
        return;
      }

      const trimmedName = String(policyEditorForm.policyName || '').trim();
      if (!trimmedName) {
        setMutationErrorMessage(t('policyNameRequired'));
        return;
      }
      if (
        creatingNewPolicy &&
        policyCreateMode === 'WALLET_OVERRIDE' &&
        !String(policyEditorForm.walletId || '').trim()
      ) {
        setMutationErrorMessage(t('policyWalletRequired'));
        return;
      }

      setMutationBusy('save');
      setMutationErrorMessage('');
      try {
        const nextRules: Record<string, unknown> = {};
        if (
          policyEditorForm.allowedChains.length > 0 &&
          policyEditorForm.allowedChains.length < POLICY_CHAINS.length
        ) {
          nextRules.allowedChains = policyEditorForm.allowedChains;
        }
        const nextBlockedActions = [...policyEditorForm.blockedActions];
        if (nextBlockedActions.length > 0) nextRules.blockedActions = nextBlockedActions;
        const nextContractCallRules = policyEditorForm.contractCalls.rules
          .map((entry) => ({
            contractAddress: normalizeDraftString(entry.contractAddress),
            functions: entry.functions.map((value) => normalizeDraftString(value)).filter(Boolean),
          }))
          .filter((entry) => entry.contractAddress);
        if (
          policyEditorForm.contractCalls.mode === 'ALLOWLIST' &&
          nextContractCallRules.length === 0
        ) {
          throw new Error(t('policyAllowlistNeedsContract'));
        }
        if (policyEditorForm.contractCalls.mode === 'ALLOWLIST') {
          nextRules.allowedContractCalls = nextContractCallRules;
        }
        const nextMaxAmountMinor = parseOptionalNonNegativeInt(
          policyEditorForm.maxAmountMinor,
          t('policyMaxAmountPerTransaction'),
        );
        if (nextMaxAmountMinor !== undefined) nextRules.maxAmountMinor = nextMaxAmountMinor;

        const policy =
          creatingNewPolicy || !selectedPolicyId
            ? await createDashboardPolicy({
                name: trimmedName,
                rules: nextRules,
                assignment:
                  policyCreateMode === 'WALLET_OVERRIDE'
                    ? {
                        scopeType: 'WALLET',
                        scopeId: String(policyEditorForm.walletId || '').trim(),
                      }
                    : {
                        scopeType: currentContextScopeType,
                        scopeId: currentContextScopeId,
                      },
              })
            : await updateDashboardPolicy({
                policyId: selectedPolicyId,
                name: trimmedName,
                rules: nextRules,
              });

        setCreatingNewPolicy(false);
        setSelectedPolicyId(policy.id);
        clearPolicyEditorDraft();
        setActiveModal(null);
        toast.success(
          t('policySaved', { id: policy.id, status: policy.status, version: policy.version }),
        );
        await Promise.all([loadPolicies(), loadAssignments(), loadCoverage()]);
      } catch (error: unknown) {
        setMutationErrorMessage(error instanceof Error ? error.message : String(error));
      } finally {
        setMutationBusy('');
      }
    },
    [
      canMutatePolicies,
      clearPolicyEditorDraft,
      creatingNewPolicy,
      currentContextScopeId,
      currentContextScopeType,
      loadAssignments,
      loadCoverage,
      loadPolicies,
      policyCreateMode,
      policyEditorForm,
      selectedPolicyId,
      session.claims,
      session.errorMessage,
    ],
  );

  const deleteSelectedPolicy = React.useCallback(async () => {
    if (!session.claims) {
      setMutationErrorMessage(session.errorMessage || t('policySessionUnavailable'));
      return;
    }
    if (!canMutatePolicies) {
      setMutationErrorMessage(t('policyAccessRequired'));
      return;
    }
    if (!selectedPolicyId) {
      setMutationErrorMessage(t('policySelectBeforeDelete'));
      return;
    }
    setMutationBusy('delete');
    setMutationErrorMessage('');
    try {
      const deleted = await deleteDashboardPolicy({ policyId: selectedPolicyId });
      if (deleted.removed) {
        toast.success(t('policyDeleted', { id: selectedPolicyId }));
      }
      setSelectedPolicyId('');
      setActiveModal(null);
      await Promise.all([loadPolicies(), loadAssignments(), loadCoverage()]);
    } catch (error: unknown) {
      setMutationErrorMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setMutationBusy('');
    }
  }, [
    canMutatePolicies,
    loadAssignments,
    loadCoverage,
    loadPolicies,
    selectedPolicyId,
    session.claims,
    session.errorMessage,
  ]);

  const publishSelectedPolicy = React.useCallback(async () => {
    if (!session.claims) {
      setMutationErrorMessage(session.errorMessage || t('policySessionUnavailable'));
      return;
    }
    if (!canMutatePolicies) {
      setMutationErrorMessage(t('policyAccessRequired'));
      return;
    }
    if (!selectedPolicyId) {
      setMutationErrorMessage(t('policySelectBeforePublish'));
      return;
    }

    setMutationBusy('publish');
    setMutationErrorMessage('');
    try {
      const published = await publishDashboardPolicy({
        policyId: selectedPolicyId,
        ...(selectedApprovalId ? { approvalId: selectedApprovalId } : {}),
      });
      setActiveModal(null);
      toast.success(t('policyPublished', { id: published.id, version: published.version }));
      await Promise.all([loadPolicies(), loadApprovals()]);
    } catch (error: unknown) {
      setMutationErrorMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setMutationBusy('');
    }
  }, [
    canMutatePolicies,
    loadApprovals,
    loadPolicies,
    selectedApprovalId,
    selectedPolicyId,
    session.claims,
    session.errorMessage,
  ]);

  const createPublishApproval = React.useCallback(async () => {
    if (!session.claims) {
      setMutationErrorMessage(session.errorMessage || t('policySessionUnavailable'));
      return;
    }
    if (!canMutatePolicies) {
      setMutationErrorMessage(t('policyAccessRequired'));
      return;
    }
    if (!selectedPolicyId) {
      setMutationErrorMessage(t('policySelectBeforeApproval'));
      return;
    }
    const reason = String(approvalCreateReason || '').trim();
    if (!reason) {
      setMutationErrorMessage(t('policyApprovalReasonRequired'));
      return;
    }

    setMutationBusy('approval-create');
    setMutationErrorMessage('');
    try {
      const approval = await createDashboardApproval({
        operationType: 'POLICY_PUBLISH',
        reason,
        ...(projectScopeId ? { projectId: projectScopeId } : {}),
        ...(environmentScopeId ? { environmentId: environmentScopeId } : {}),
        resourceType: 'policy',
        resourceId: selectedPolicyId,
        metadata: {
          policyId: selectedPolicyId,
          ...(selectedPolicy?.kind ? { policyKind: selectedPolicy.kind } : {}),
        },
      });
      setApprovalCreateReason('Policy reviewed for publish.');
      setSelectedApprovalId(approval.status === 'APPROVED' ? approval.id : selectedApprovalId);
      toast.success(t('policyApprovalCreated', { id: approval.id, policyId: selectedPolicyId }));
      await loadApprovals();
    } catch (error: unknown) {
      setMutationErrorMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setMutationBusy('');
    }
  }, [
    approvalCreateReason,
    canMutatePolicies,
    environmentScopeId,
    loadApprovals,
    projectScopeId,
    selectedApprovalId,
    selectedPolicy,
    selectedPolicyId,
    session.claims,
    session.errorMessage,
  ]);

  const approveRequest = React.useCallback(
    async (approval: DashboardConsoleApprovalRequest) => {
      if (!canMutatePolicies) {
        setMutationErrorMessage(t('policyAccessRequired'));
        return;
      }
      setMutationBusy(`approve:${approval.id}`);
      setMutationErrorMessage('');
      try {
        const updated = await approveDashboardApproval({
          approvalId: approval.id,
          reason: String(approvalDecisionReason || '').trim() || 'Approved in policy engine.',
        });
        if (updated.status === 'APPROVED') setSelectedApprovalId(updated.id);
        toast.success(t('policyApprovalStatusChanged', { id: updated.id, status: updated.status }));
        await loadApprovals();
      } catch (error: unknown) {
        setMutationErrorMessage(error instanceof Error ? error.message : String(error));
      } finally {
        setMutationBusy('');
      }
    },
    [approvalDecisionReason, canMutatePolicies, loadApprovals],
  );

  const rejectRequest = React.useCallback(
    async (approval: DashboardConsoleApprovalRequest) => {
      if (!canMutatePolicies) {
        setMutationErrorMessage(t('policyAccessRequired'));
        return;
      }
      setMutationBusy(`reject:${approval.id}`);
      setMutationErrorMessage('');
      try {
        const updated = await rejectDashboardApproval({
          approvalId: approval.id,
          reason: String(approvalDecisionReason || '').trim() || 'Rejected in policy engine.',
        });
        if (selectedApprovalId === updated.id) setSelectedApprovalId('');
        toast.success(t('policyApprovalStatusChanged', { id: updated.id, status: updated.status }));
        await loadApprovals();
      } catch (error: unknown) {
        setMutationErrorMessage(error instanceof Error ? error.message : String(error));
      } finally {
        setMutationBusy('');
      }
    },
    [approvalDecisionReason, canMutatePolicies, loadApprovals, selectedApprovalId],
  );

  const runSimulation = React.useCallback(async () => {
    if (!selectedPolicyId) {
      setSimulationErrorMessage(t('policySaveBeforeSimulation'));
      setSimulationResult(null);
      return;
    }
    setSimulationBusy(true);
    setSimulationErrorMessage('');
    setSimulationResult(null);
    try {
      const amountMinor = parseOptionalNonNegativeInt(
        simulationAmountMinor,
        t('policySimulationAmount'),
      );
      const result = await simulateDashboardPolicy({
        policyId: selectedPolicyId,
        action: simulationAction,
        ...(simulationChain ? { chain: simulationChain } : {}),
        ...(amountMinor !== undefined ? { amountMinor } : {}),
        ...(simulationContractAddress ? { contractAddress: simulationContractAddress.trim() } : {}),
        ...(simulationFunctionSelector
          ? { functionSelector: simulationFunctionSelector.trim() }
          : {}),
      });
      setSimulationResult(result);
    } catch (error: unknown) {
      setSimulationErrorMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setSimulationBusy(false);
    }
  }, [
    selectedPolicyId,
    simulationAction,
    simulationAmountMinor,
    simulationChain,
    simulationContractAddress,
    simulationFunctionSelector,
  ]);

  const policyScopeUsageLabels = React.useCallback(
    (policy: DashboardConsolePolicy): string[] => {
      const labels: string[] = [];
      if (assignmentsByScope.ORG?.policyId === policy.id) labels.push(t('policyScopeOrgDefault'));
      if (assignmentsByScope.PROJECT?.policyId === policy.id)
        labels.push(t('policyScopeProjectDefault'));
      if (assignmentsByScope.ENVIRONMENT?.policyId === policy.id)
        labels.push(t('policyScopeEnvironmentOverride'));
      if (assignmentsByScope.WALLET?.policyId === policy.id)
        labels.push(t('policyScopeWalletOverride'));
      return labels;
    },
    [assignmentsByScope],
  );

  const policyScopeSummary = React.useCallback(
    (policy: DashboardConsolePolicy): string => {
      const labels = policyScopeUsageLabels(policy);
      if (labels.length === 0) return t('policyScopeDraftOnly');
      const summary = labels.join(t('policyListSeparator'));
      return `${summary.charAt(0).toUpperCase()}${summary.slice(1)}`;
    },
    [policyScopeUsageLabels],
  );

  /* Search-only: folds the scope labels and wallet coverage into one haystack
     so a query like "3 wallets" still matches. Not rendered. */
  const policyContextUsage = React.useCallback(
    (policy: DashboardConsolePolicy): string => {
      const coverageEntry = coverageByPolicyId.get(policy.id);
      const walletCoverage = walletCountLabel(coverageEntry ? coverageEntry.walletCount : 0);
      return `${policyScopeSummary(policy)} ${walletCoverage}`;
    },
    [coverageByPolicyId, policyScopeSummary],
  );
  const filteredPolicies = React.useMemo(() => {
    const query = String(policyQuery || '')
      .trim()
      .toLowerCase();
    return visiblePolicies.filter((policy) => {
      if (statusFilter !== 'ALL' && policy.status !== statusFilter) return false;
      const coverageEntry = coverageByPolicyId.get(policy.id) || null;
      const used = Boolean(coverageEntry && coverageEntry.walletCount > 0);
      if (impactFilter === 'USED' && !used) return false;
      if (impactFilter === 'UNUSED' && used) return false;
      if (!query) return true;
      const haystack = [policy.id, policy.name, rulesSummary(policy), policyContextUsage(policy)]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return haystack.includes(query);
    });
  }, [
    coverageByPolicyId,
    impactFilter,
    policyContextUsage,
    policyQuery,
    statusFilter,
    visiblePolicies,
  ]);
  const activeModalPolicy = activeModal?.policyId
    ? policyById.get(activeModal.policyId) || null
    : null;
  const policiesPagination = useDashboardTablePagination(filteredPolicies, {
    disabled: policiesLoading,
    itemLabel: t('policyItemLabel'),
    itemLabelPlural: t('policyItemLabelPlural'),
  });
  const latestPublishedVersion = React.useMemo(
    () => activePolicyVersions.find((entry) => entry.status === 'PUBLISHED') || null,
    [activePolicyVersions],
  );
  const activeModalRuleReviewRows = React.useMemo(
    () =>
      activeModalPolicy
        ? buildPolicyRuleReviewRows(latestPublishedVersion?.rules || null, activeModalPolicy.rules)
        : [],
    [activeModalPolicy, latestPublishedVersion],
  );
  const changedActiveModalRuleReviewRows = React.useMemo(
    () => activeModalRuleReviewRows.filter((entry) => entry.changed),
    [activeModalRuleReviewRows],
  );
  const activeModalDraftComparisonSummary = React.useMemo(
    () =>
      activeModalPolicy
        ? describePolicyDraftComparison({
            policy: activeModalPolicy,
            latestPublishedVersion,
            changedRows: changedActiveModalRuleReviewRows,
          })
        : '',
    [activeModalPolicy, changedActiveModalRuleReviewRows, latestPublishedVersion],
  );
  const activeModalScopeUsageLabels = React.useMemo(
    () => (activeModalPolicy ? policyScopeUsageLabels(activeModalPolicy) : []),
    [activeModalPolicy, policyScopeUsageLabels],
  );
  const activeModalCoverageEntry = React.useMemo(
    () => (activeModalPolicy ? coverageByPolicyId.get(activeModalPolicy.id) || null : null),
    [activeModalPolicy, coverageByPolicyId],
  );
  const nextLiveVersion = React.useMemo(() => {
    if (!activeModalPolicy) return 0;
    if (activeModalPolicy.status === 'PUBLISHED') return activeModalPolicy.version;
    return latestPublishedVersion ? latestPublishedVersion.version + 1 : 1;
  }, [activeModalPolicy, latestPublishedVersion]);
  const activeModalReviewRows = React.useMemo<PolicyReviewTableRow[]>(
    () =>
      activeModalPolicy
        ? [
            {
              label: t('policyReviewRowPolicy'),
              value: (
                <span className="dashboard-policy-go-live__value-stack">
                  <strong>{activeModalPolicy.name || activeModalPolicy.id}</strong>
                  <code>{activeModalPolicy.id}</code>
                </span>
              ),
            },
            {
              label: t('policyReviewRowCurrentLive'),
              value: policyVersionsLoading
                ? t('policyLoadingLiveVersion')
                : policyVersionsErrorMessage
                  ? t('policyDetailsUnavailableValue', { message: policyVersionsErrorMessage })
                  : latestPublishedVersion
                    ? t('policyVersionPublished', {
                        version: latestPublishedVersion.version,
                        time: formatTimestamp(latestPublishedVersion.publishedAt),
                      })
                    : t('policyNotLiveYet'),
            },
            {
              label: t('policyReviewRowNextLive'),
              value: `v${nextLiveVersion}`,
            },
            {
              label: t('policyReviewRowScope'),
              value:
                activeModalScopeUsageLabels.length > 0
                  ? activeModalScopeUsageLabels.join(t('policyListSeparator'))
                  : t('policyNotAttached'),
            },
            {
              label: t('policyReviewRowImpact'),
              value: coverageLoading
                ? t('policyLoadingImpact')
                : coverageErrorMessage
                  ? t('policyDetailsUnavailableValue', { message: coverageErrorMessage })
                  : activeModalCoverageEntry
                    ? t('policyWalletsUsing', {
                        wallets: walletCountLabel(activeModalCoverageEntry.walletCount),
                      })
                    : t('policyUnusedInScope'),
            },
          ]
        : [],
    [
      activeModalCoverageEntry,
      activeModalPolicy,
      activeModalScopeUsageLabels,
      coverageErrorMessage,
      coverageLoading,
      latestPublishedVersion,
      nextLiveVersion,
      policyVersionsErrorMessage,
      policyVersionsLoading,
    ],
  );
  const policyActionToggleOptions = POLICY_ACTIONS.filter((entry) => entry !== 'contract_call');
  const addContractCallRule = React.useCallback(() => {
    setPolicyEditorForm((current) => ({
      ...current,
      contractCalls: {
        mode: 'ALLOWLIST',
        rules: [...current.contractCalls.rules, createEmptyContractRuleDraft()],
      },
    }));
  }, [setPolicyEditorForm]);
  const removeContractCallRule = React.useCallback(
    (ruleId: string) => {
      setPolicyEditorForm((current) => ({
        ...current,
        contractCalls: {
          ...current.contractCalls,
          rules: current.contractCalls.rules.filter((entry) => entry.id !== ruleId),
        },
      }));
    },
    [setPolicyEditorForm],
  );
  const updateContractCallRuleAddress = React.useCallback(
    (ruleId: string, value: string) => {
      setPolicyEditorForm((current) => ({
        ...current,
        contractCalls: {
          ...current.contractCalls,
          rules: current.contractCalls.rules.map((entry) =>
            entry.id === ruleId ? { ...entry, contractAddress: value } : entry,
          ),
        },
      }));
    },
    [setPolicyEditorForm],
  );
  const addContractFunction = React.useCallback(
    (ruleId: string) => {
      setPolicyEditorForm((current) => ({
        ...current,
        contractCalls: {
          ...current.contractCalls,
          rules: current.contractCalls.rules.map((entry) =>
            entry.id === ruleId ? { ...entry, functions: [...entry.functions, ''] } : entry,
          ),
        },
      }));
    },
    [setPolicyEditorForm],
  );
  const updateContractFunction = React.useCallback(
    (ruleId: string, functionIndex: number, value: string) => {
      setPolicyEditorForm((current) => ({
        ...current,
        contractCalls: {
          ...current.contractCalls,
          rules: current.contractCalls.rules.map((entry) =>
            entry.id === ruleId
              ? {
                  ...entry,
                  functions: entry.functions.map((functionEntry, index) =>
                    index === functionIndex ? value : functionEntry,
                  ),
                }
              : entry,
          ),
        },
      }));
    },
    [setPolicyEditorForm],
  );
  const removeContractFunction = React.useCallback(
    (ruleId: string, functionIndex: number) => {
      setPolicyEditorForm((current) => ({
        ...current,
        contractCalls: {
          ...current.contractCalls,
          rules: current.contractCalls.rules.map((entry) => {
            if (entry.id !== ruleId) return entry;
            const nextFunctions = entry.functions.filter((_, index) => index !== functionIndex);
            return {
              ...entry,
              functions: nextFunctions.length > 0 ? nextFunctions : [''],
            };
          }),
        },
      }));
    },
    [setPolicyEditorForm],
  );
  const renderWalletOverrideFields = (
    walletIdValue: string,
    onWalletIdChange: (nextWalletId: string) => void,
  ): React.JSX.Element => (
    <div className="dashboard-view-grid dashboard-view-grid--two dashboard-form-field dashboard-form-field--full">
      <label className="dashboard-form-field">
        <span>{t('policyWalletOverrideTarget')}</span>
        <input
          className="dashboard-input"
          list="policy-engine-wallets"
          value={walletIdValue}
          onChange={(event) => onWalletIdChange(event.target.value)}
          placeholder="wallet_..."
        />
        <datalist id="policy-engine-wallets">
          {wallets.map((wallet) => (
            <option key={wallet.id} value={wallet.id}>
              {wallet.address}
            </option>
          ))}
        </datalist>
      </label>
      <div className="dashboard-form-field">
        <span>{t('policyWalletPreview')}</span>
        {walletsLoading ? (
          <p className="dashboard-pagination-note">{t('policyWalletsLoading')}</p>
        ) : walletsErrorMessage ? (
          <p className="dashboard-pagination-note">{walletsErrorMessage}</p>
        ) : walletIdValue ? (
          <p className="dashboard-pagination-note">
            {(() => {
              const wallet = wallets.find((entry) => entry.id === walletIdValue) || null;
              if (!wallet) return t('policyWalletFallback', { id: walletIdValue });
              return `${wallet.id} (${wallet.chain}, ${wallet.address})`;
            })()}
          </p>
        ) : (
          <p className="dashboard-pagination-note">{t('policyWalletChoose')}</p>
        )}
      </div>
    </div>
  );

  const onPolicyEditorWalletIdChange = React.useCallback(
    (nextWalletId: string) => {
      setPolicyEditorForm((current) => ({
        ...current,
        walletId: nextWalletId,
      }));
    },
    [setPolicyEditorForm],
  );

  const policyEditorDraftDiffersFromInitial = React.useMemo(
    () => !arePolicyEditorFormsEqual(policyEditorForm, policyEditorInitialForm),
    [policyEditorForm, policyEditorInitialForm],
  );

  const discardPolicyEditorDraft = React.useCallback(() => {
    if (policyEditorDraftDiffersFromInitial && typeof window !== 'undefined') {
      const confirmed = window.confirm(t('policyDiscardDraftConfirm'));
      if (!confirmed) return;
    }
    resetPolicyEditorDraftToInitial();
    closePolicyModal();
  }, [closePolicyModal, policyEditorDraftDiffersFromInitial, resetPolicyEditorDraftToInitial]);

  return (
    <div className="dashboard-view" aria-label={t('policyPageLabel')}>
      <section
        className="dashboard-policy-section--plain"
        aria-label={t('policyTableSectionLabel')}
      >
        <DashboardPageActions>
          <button
            type="button"
            className="dashboard-pagination-button dashboard-pagination-button--secondary"
            onClick={openCreateWalletOverrideModal}
            disabled={!canMutatePolicies}
          >
            {t('policyCreateWalletOverride')}
          </button>
          <button
            type="button"
            className="dashboard-pagination-button dashboard-pagination-button--primary"
            onClick={openCreatePolicyModal}
            disabled={!canMutatePolicies}
          >
            {t('policyCreatePolicy')}
          </button>
        </DashboardPageActions>
        {!policyEditorModalOpen && mutationErrorMessage ? (
          <p className="dashboard-pagination-note">{mutationErrorMessage}</p>
        ) : null}
        <div
          className="dashboard-filters dashboard-policy-filters"
          aria-label={t('policyFiltersLabel')}
        >
          <label className="dashboard-search-control dashboard-search-control--compact">
            <span className="dashboard-search-icon" aria-hidden="true" />
            <input
              type="search"
              aria-label={t('policySearchLabel')}
              placeholder={t('policySearchPlaceholder')}
              value={policyQuery}
              onChange={(event) => setPolicyQuery(event.target.value)}
            />
          </label>
          <label className="dashboard-form-field dashboard-policy-filter">
            <select
              className="dashboard-input"
              aria-label={t('policyFilterStatusLabel')}
              value={statusFilter}
              onChange={(event) => setStatusFilter(event.target.value as PolicyStatusFilter)}
            >
              <option value="ALL">{t('policyFilterStatusAll')}</option>
              <option value="DRAFT">{t('policyFilterStatusDraft')}</option>
              <option value="PUBLISHED">{t('policyFilterStatusPublished')}</option>
            </select>
          </label>
          <label className="dashboard-form-field dashboard-policy-filter">
            <select
              className="dashboard-input"
              aria-label={t('policyFilterImpactLabel')}
              value={impactFilter}
              onChange={(event) => setImpactFilter(event.target.value as PolicyImpactFilter)}
            >
              <option value="ALL">{t('policyFilterImpactAll')}</option>
              <option value="USED">{t('policyFilterImpactUsed')}</option>
              <option value="UNUSED">{t('policyFilterImpactUnused')}</option>
            </select>
          </label>
        </div>
        {!coverageLoading &&
        !coverageErrorMessage &&
        coverage &&
        coverage.totals.unassignedWalletCount > 0 ? (
          <p className="dashboard-pagination-note">
            {t(
              coverage.totals.unassignedWalletCount === 1
                ? 'policyUnassignedWalletsOne'
                : 'policyUnassignedWalletsMany',
              { count: coverage.totals.unassignedWalletCount },
            )}
          </p>
        ) : null}
        <DashboardTable
          ariaLabel={t('policyRowsLabel')}
          className="dashboard-policy-table"
          columns={POLICY_TABLE_COLUMNS}
          pagination={policiesPagination.pagination}
        >
          <DashboardTableHeader className="dashboard-policy-table__header">
            <DashboardTableHeaderCell>{t('policyColumnPolicy')}</DashboardTableHeaderCell>
            <DashboardTableHeaderCell>{t('policyColumnCurrentScope')}</DashboardTableHeaderCell>
            <DashboardTableHeaderCell>{t('policyColumnUsedBy')}</DashboardTableHeaderCell>
            <DashboardTableHeaderCell>{t('policyColumnUpdated')}</DashboardTableHeaderCell>
            <DashboardTableHeaderCell>{t('policyColumnActions')}</DashboardTableHeaderCell>
          </DashboardTableHeader>
          {policiesLoading ? (
            <DashboardTableState>{t('policyLoading')}</DashboardTableState>
          ) : policiesErrorMessage ? (
            <DashboardTableState>
              {t('policyUnavailable', { message: policiesErrorMessage })}
            </DashboardTableState>
          ) : filteredPolicies.length === 0 ? (
            <DashboardTableState>{t('policyEmptyFiltered')}</DashboardTableState>
          ) : (
            <>
              {policiesPagination.rows.map((policy) => {
                const isDefaultPolicy = policy.isSystemDefault;
                const coverageEntry = coverageByPolicyId.get(policy.id) || null;
                return (
                  <React.Fragment key={policy.id}>
                    <DashboardTableRow className="dashboard-policy-table__row">
                      <DashboardTableCell
                        title={`${policy.name || policy.id} · ${policy.id} · v${policy.version}`}
                        className="dashboard-data-table__cell--lead"
                      >
                        <div className="dashboard-lead">
                          <span className="dashboard-lead__icon" aria-hidden="true">
                            <ScaleIcon size={16} />
                          </span>
                          <span className="dashboard-lead__copy">
                            <span className="dashboard-lead__title">
                              <span className="dashboard-data-table__summary">
                                {policy.name || policy.id}
                              </span>
                              <DashboardTableBadge tone={policyStatusBadgeTone(policy.status)}>
                                {formatPolicyStatusLabel(policy.status)}
                              </DashboardTableBadge>
                            </span>
                            <span className="dashboard-lead__sub">
                              {policy.id} · v{policy.version}
                            </span>
                          </span>
                        </div>
                      </DashboardTableCell>
                      <DashboardTableCell
                        title={policyScopeSummary(policy)}
                        className="dashboard-data-table__cell--nowrap"
                      >
                        {policyScopeSummary(policy)}
                      </DashboardTableCell>
                      <DashboardTableCell>
                        {coverageEntry
                          ? walletCountLabel(coverageEntry.walletCount)
                          : t('policyUnused')}
                      </DashboardTableCell>
                      <DashboardTableCell truncate>
                        {formatTimestamp(policy.updatedAt)}
                      </DashboardTableCell>
                      <DashboardTableCell>
                        <DashboardTableActionGroup>
                          <DashboardTableActionButton
                            className="dashboard-policy-table__details-button"
                            aria-haspopup="dialog"
                            onClick={() => setPolicyModalState('details', policy.id)}
                          >
                            {t('policyDetails')}
                          </DashboardTableActionButton>
                          <DashboardTableActionMenu
                            ariaLabel={t('policyMoreActionsFor', {
                              name: policy.name || policy.id,
                            })}
                            items={[
                              {
                                label: t('policyMenuEdit'),
                                onSelect: () => setPolicyModalState('edit', policy.id),
                                disabled: !canMutatePolicies,
                              },
                              {
                                label: t('policyMenuSimulate'),
                                onSelect: () => setPolicyModalState('simulate', policy.id),
                              },
                              {
                                label: t('policyMenuGoLive'),
                                onSelect: () => setPolicyModalState('publish', policy.id),
                                disabled: !canMutatePolicies,
                              },
                              {
                                label: t('policyMenuDelete'),
                                onSelect: () => setPolicyModalState('delete', policy.id),
                                tone: 'danger' as const,
                                disabled: !canMutatePolicies || isDefaultPolicy,
                                title: isDefaultPolicy
                                  ? t('policyDefaultCannotBeDeleted')
                                  : undefined,
                              },
                            ]}
                          />
                        </DashboardTableActionGroup>
                      </DashboardTableCell>
                    </DashboardTableRow>
                  </React.Fragment>
                );
              })}
            </>
          )}
        </DashboardTable>
      </section>

      {activeModal ? (
        <DashboardInlineModal
          isOpen
          onRequestClose={closePolicyModal}
          className="dashboard-modal--wide"
          ariaLabel={
            activeModal.kind === 'create'
              ? t('policyModalCreateLabel')
              : activeModal.kind === 'details'
                ? t('policyModalDetailsLabel')
                : activeModal.kind === 'edit'
                  ? t('policyModalEditLabel')
                  : activeModal.kind === 'delete'
                    ? t('policyModalDeleteLabel')
                    : activeModal.kind === 'simulate'
                      ? t('policyModalSimulateLabel')
                      : t('policyModalGoLiveLabel')
          }
        >
          {activeModal.kind === 'create' || activeModal.kind === 'edit' ? (
            <>
              <h2>
                {activeModal.kind === 'create'
                  ? policyCreateMode === 'WALLET_OVERRIDE'
                    ? t('policyCreateWalletOverride')
                    : t('policyCreatePolicy')
                  : t('policyEditTitle')}
              </h2>
              <p className="dashboard-pagination-note dashboard-policy-modal-intro">
                {activeModal.kind === 'create' && policyCreateMode === 'WALLET_OVERRIDE'
                  ? t('policyIntroWalletOverride')
                  : t('policyIntroStandard')}
              </p>
              {mutationErrorMessage ? (
                <p className="dashboard-pagination-note">{mutationErrorMessage}</p>
              ) : null}
              <form className="dashboard-view-grid dashboard-view-grid--two" onSubmit={savePolicy}>
                <div className="dashboard-policy-form-row dashboard-form-field dashboard-form-field--full">
                  <label className="dashboard-form-field dashboard-policy-form-row__field">
                    <span>{t('policyFieldName')}</span>
                    <input
                      className="dashboard-input"
                      value={policyEditorForm.policyName}
                      onChange={(event) =>
                        setPolicyEditorForm((current) => ({
                          ...current,
                          policyName: event.target.value,
                        }))
                      }
                      placeholder={defaultPolicyName(policyCreateMode)}
                      disabled={!canMutatePolicies || mutationBusy === 'save'}
                    />
                  </label>

                  <label className="dashboard-form-field dashboard-policy-form-row__field">
                    <span>{t('policyFieldMaxAmount')}</span>
                    <input
                      className="dashboard-input"
                      value={policyEditorForm.maxAmountMinor}
                      onChange={(event) =>
                        setPolicyEditorForm((current) => ({
                          ...current,
                          maxAmountMinor: event.target.value,
                        }))
                      }
                      placeholder="100000"
                      disabled={!canMutatePolicies || mutationBusy === 'save'}
                    />
                  </label>
                </div>
                {activeModal.kind === 'create' && policyCreateMode === 'WALLET_OVERRIDE'
                  ? renderWalletOverrideFields(
                      policyEditorForm.walletId,
                      onPolicyEditorWalletIdChange,
                    )
                  : null}

                <section className="dashboard-policy-rule-panel dashboard-policy-rule-panel--first dashboard-form-field dashboard-form-field--full">
                  <div className="dashboard-policy-rule-panel__header">
                    <span>{t('policyRuleBlockedActions')}</span>
                    <p className="dashboard-pagination-note">{t('policyBlockedActionsHint')}</p>
                  </div>
                  <div className="dashboard-policy-toggle-grid">
                    {policyActionToggleOptions.map((action) => {
                      const checked = policyEditorForm.blockedActions.some(
                        (entry) => entry.toLowerCase() === action.toLowerCase(),
                      );
                      return (
                        <button
                          key={action}
                          type="button"
                          aria-pressed={checked}
                          className={[
                            'dashboard-policy-segment',
                            checked ? 'dashboard-policy-segment--active' : '',
                          ]
                            .filter(Boolean)
                            .join(' ')}
                          onClick={() =>
                            setPolicyEditorForm((current) => ({
                              ...current,
                              blockedActions: toggleStringValue(current.blockedActions, action),
                            }))
                          }
                          disabled={!canMutatePolicies || mutationBusy === 'save'}
                        >
                          {formatPolicyActionLabel(action)}
                        </button>
                      );
                    })}
                  </div>
                </section>

                <section className="dashboard-policy-rule-panel dashboard-form-field dashboard-form-field--full">
                  <div className="dashboard-policy-rule-panel__header">
                    <span>{t('policyRuleAllowedChains')}</span>
                    <p className="dashboard-pagination-note">{t('policyAllowedChainsHint')}</p>
                  </div>
                  <div className="dashboard-policy-toggle-grid">
                    {POLICY_CHAINS.map((chain) => {
                      const checked = policyEditorForm.allowedChains.some(
                        (entry) => entry.toLowerCase() === chain.toLowerCase(),
                      );
                      return (
                        <button
                          key={chain}
                          type="button"
                          aria-pressed={checked}
                          className={[
                            'dashboard-policy-segment',
                            checked ? 'dashboard-policy-segment--active' : '',
                          ]
                            .filter(Boolean)
                            .join(' ')}
                          onClick={() =>
                            setPolicyEditorForm((current) => ({
                              ...current,
                              allowedChains: toggleStringValue(current.allowedChains, chain),
                            }))
                          }
                          disabled={!canMutatePolicies || mutationBusy === 'save'}
                        >
                          {chain}
                        </button>
                      );
                    })}
                  </div>
                </section>

                <section className="dashboard-policy-rule-panel dashboard-policy-rule-panel--contract-calls dashboard-form-field dashboard-form-field--full">
                  <div className="dashboard-policy-rule-panel__header">
                    <span>{t('policyRuleContractCalls')}</span>
                    <p className="dashboard-pagination-note">{t('policyContractCallsHint')}</p>
                  </div>
                  <div className="dashboard-policy-contract-call-mode">
                    <button
                      type="button"
                      aria-pressed={policyEditorForm.contractCalls.mode === 'ALLOW_ALL'}
                      className={[
                        'dashboard-policy-segment',
                        policyEditorForm.contractCalls.mode === 'ALLOW_ALL'
                          ? 'dashboard-policy-segment--active'
                          : '',
                      ]
                        .filter(Boolean)
                        .join(' ')}
                      onClick={() =>
                        setPolicyEditorForm((current) => ({
                          ...current,
                          contractCalls: {
                            ...current.contractCalls,
                            mode: 'ALLOW_ALL',
                          },
                        }))
                      }
                      disabled={!canMutatePolicies || mutationBusy === 'save'}
                    >
                      {t('policyAllowAllButton')}
                    </button>
                    <button
                      type="button"
                      aria-pressed={policyEditorForm.contractCalls.mode === 'ALLOWLIST'}
                      className={[
                        'dashboard-policy-segment',
                        policyEditorForm.contractCalls.mode === 'ALLOWLIST'
                          ? 'dashboard-policy-segment--active'
                          : '',
                      ]
                        .filter(Boolean)
                        .join(' ')}
                      onClick={() =>
                        setPolicyEditorForm((current) => ({
                          ...current,
                          contractCalls: {
                            ...current.contractCalls,
                            mode: 'ALLOWLIST',
                          },
                        }))
                      }
                      disabled={!canMutatePolicies || mutationBusy === 'save'}
                    >
                      {t('policyAllowlistButton')}
                    </button>
                  </div>

                  {policyEditorForm.contractCalls.mode === 'ALLOWLIST' ? (
                    <div className="dashboard-policy-contract-calls">
                      {policyEditorForm.contractCalls.rules.length === 0 ? (
                        <p className="dashboard-pagination-note">{t('policyAllowlistEmpty')}</p>
                      ) : null}
                      {policyEditorForm.contractCalls.rules.map((rule) => (
                        <div key={rule.id} className="dashboard-policy-contract-card">
                          <div className="dashboard-policy-contract-card__header">
                            <strong>{t('policyAllowedContract')}</strong>
                            <button
                              type="button"
                              className="dashboard-inline-link dashboard-inline-link--danger"
                              onClick={() => removeContractCallRule(rule.id)}
                              disabled={!canMutatePolicies || mutationBusy === 'save'}
                            >
                              {t('policyRemove')}
                            </button>
                          </div>
                          <label className="dashboard-form-field">
                            <span>{t('policyContractAddress')}</span>
                            <input
                              className="dashboard-input"
                              value={rule.contractAddress}
                              onChange={(event) =>
                                updateContractCallRuleAddress(rule.id, event.target.value)
                              }
                              placeholder="0x..."
                              disabled={!canMutatePolicies || mutationBusy === 'save'}
                            />
                          </label>
                          <div className="dashboard-uri-list-editor__rows">
                            {rule.functions.map((functionEntry, index) => (
                              <div
                                key={`${rule.id}:${index}`}
                                className="dashboard-uri-list-editor__row"
                              >
                                <label className="dashboard-form-field dashboard-uri-list-editor__field">
                                  <span>
                                    {index === 0
                                      ? t('policyAllowedFunctions')
                                      : t('policyFunction')}
                                  </span>
                                  <input
                                    className="dashboard-input"
                                    value={functionEntry}
                                    onChange={(event) =>
                                      updateContractFunction(rule.id, index, event.target.value)
                                    }
                                    placeholder={t('policyFunctionPlaceholder')}
                                    disabled={!canMutatePolicies || mutationBusy === 'save'}
                                  />
                                </label>
                                <div className="dashboard-uri-list-editor__actions">
                                  <button
                                    type="button"
                                    className="dashboard-pagination-button dashboard-pagination-button--secondary"
                                    onClick={() => removeContractFunction(rule.id, index)}
                                    disabled={!canMutatePolicies || mutationBusy === 'save'}
                                  >
                                    {t('policyRemove')}
                                  </button>
                                </div>
                              </div>
                            ))}
                          </div>
                          <button
                            type="button"
                            className="dashboard-inline-link"
                            onClick={() => addContractFunction(rule.id)}
                            disabled={!canMutatePolicies || mutationBusy === 'save'}
                          >
                            {t('policyAddFunction')}
                          </button>
                        </div>
                      ))}
                      <button
                        type="button"
                        className="dashboard-pagination-button dashboard-policy-contract-add-button"
                        onClick={addContractCallRule}
                        disabled={!canMutatePolicies || mutationBusy === 'save'}
                      >
                        {t('policyAddContract')}
                      </button>
                    </div>
                  ) : (
                    <p className="dashboard-pagination-note">{t('policyContractCallsOpen')}</p>
                  )}
                </section>

                <div className="dashboard-form-actions">
                  <button
                    type="button"
                    className="dashboard-pagination-button dashboard-pagination-button--secondary"
                    onClick={discardPolicyEditorDraft}
                    disabled={mutationBusy === 'save'}
                  >
                    {t('policyCancel')}
                  </button>
                  <button
                    type="submit"
                    className="dashboard-pagination-button dashboard-pagination-button--primary"
                    disabled={!canMutatePolicies || mutationBusy === 'save'}
                  >
                    {mutationBusy === 'save'
                      ? t('policySaving')
                      : activeModal.kind === 'create'
                        ? t('policyCreateDraft')
                        : t('policySaveDraft')}
                  </button>
                </div>
              </form>
            </>
          ) : null}

          {activeModal.kind === 'details' ? (
            activeModalPolicy ? (
              <>
                <h2>{t('policyDetailsTitle')}</h2>
                <p className="dashboard-pagination-note">{t('policyDetailsIntro')}</p>
                <div className="dashboard-policy-view">
                  <header className="dashboard-policy-view__hero">
                    <div className="dashboard-policy-view__hero-copy">
                      <p className="dashboard-policy-view__eyebrow">{t('policyDetailsTitle')}</p>
                      <h3>{activeModalPolicy.name || activeModalPolicy.id}</h3>
                      <p className="dashboard-pagination-note">
                        {activeModalPolicy.description
                          ? activeModalPolicy.description
                          : activeModalPolicy.isSystemDefault
                            ? t('policyDefaultLivePolicy')
                            : activeModalDraftComparisonSummary}
                      </p>
                    </div>
                    <div className="dashboard-policy-view__badges">
                      <DashboardTableBadge tone={policyStatusBadgeTone(activeModalPolicy.status)}>
                        {formatPolicyStatusLabel(activeModalPolicy.status)}
                      </DashboardTableBadge>
                      <DashboardTableBadge tone="neutral">
                        v{activeModalPolicy.version}
                      </DashboardTableBadge>
                      {activeModalPolicy.isSystemDefault ? (
                        <DashboardTableBadge tone="neutral">
                          {t('policySystemDefault')}
                        </DashboardTableBadge>
                      ) : null}
                    </div>
                  </header>

                  <DashboardTableDetailsGrid>
                    <DashboardTableDetailsItem label={t('policyDetailPolicyId')}>
                      <code>{activeModalPolicy.id}</code>
                    </DashboardTableDetailsItem>
                    <DashboardTableDetailsItem label={t('policyDetailLiveVersion')}>
                      <span>
                        {policyVersionsLoading
                          ? t('policyDetailsLoading')
                          : policyVersionsErrorMessage
                            ? t('policyDetailsUnavailableValue', {
                                message: policyVersionsErrorMessage,
                              })
                            : latestPublishedVersion
                              ? t('policyVersionPublished', {
                                  version: latestPublishedVersion.version,
                                  time: formatTimestamp(latestPublishedVersion.publishedAt),
                                })
                              : t('policyNotLiveYet')}
                      </span>
                    </DashboardTableDetailsItem>
                    <DashboardTableDetailsItem label={t('policyColumnCurrentScope')}>
                      <span>
                        {activeModalScopeUsageLabels.length > 0
                          ? activeModalScopeUsageLabels.join(t('policyListSeparator'))
                          : t('policyScopeDraftOnly')}
                      </span>
                    </DashboardTableDetailsItem>
                    <DashboardTableDetailsItem label={t('policyDetailCoverage')}>
                      <span>
                        {coverageLoading
                          ? t('policyLoadingImpact')
                          : coverageErrorMessage
                            ? t('policyDetailsUnavailableValue', { message: coverageErrorMessage })
                            : policyCoverageSummary(activeModalCoverageEntry)}
                      </span>
                    </DashboardTableDetailsItem>
                    <DashboardTableDetailsItem label={t('policyDetailPublished')}>
                      <span>{formatTimestamp(activeModalPolicy.publishedAt)}</span>
                    </DashboardTableDetailsItem>
                    <DashboardTableDetailsItem label={t('policyColumnUpdated')}>
                      <span>{formatTimestamp(activeModalPolicy.updatedAt)}</span>
                    </DashboardTableDetailsItem>
                  </DashboardTableDetailsGrid>

                  <section className="dashboard-view-card dashboard-policy-view__section">
                    <div className="dashboard-policy-view__section-header">
                      <div>
                        <h3>{t('policyRulesHeading')}</h3>
                        <p className="dashboard-pagination-note">{t('policyRulesHint')}</p>
                      </div>
                      <p className="dashboard-policy-view__summary">
                        {rulesSummary(activeModalPolicy)}
                      </p>
                    </div>
                    <div className="dashboard-policy-view__rule-grid">
                      {activeModalRuleReviewRows.map((entry) => (
                        <article
                          key={`${activeModalPolicy.id}:${entry.label}`}
                          className={`dashboard-policy-view__rule-card${
                            entry.changed ? ' dashboard-policy-view__rule-card--changed' : ''
                          }`}
                        >
                          <div className="dashboard-policy-view__rule-card-header">
                            <p className="dashboard-policy-view__rule-label">{entry.label}</p>
                            <DashboardTableBadge tone={entry.changed ? 'warning' : 'neutral'}>
                              {entry.changed ? t('policyBadgeChanged') : t('policyBadgeCurrent')}
                            </DashboardTableBadge>
                          </div>
                          <p className="dashboard-policy-view__rule-value">{entry.next}</p>
                          {activeModalPolicy.status !== 'PUBLISHED' && latestPublishedVersion ? (
                            <p className="dashboard-policy-view__rule-compare">
                              {t('policyLiveValue', { value: entry.live })}
                            </p>
                          ) : null}
                        </article>
                      ))}
                    </div>
                  </section>

                  <section className="dashboard-view-card dashboard-policy-view__section">
                    <div className="dashboard-policy-view__section-header">
                      <div>
                        <h3>{t('policyChangeSummary')}</h3>
                        <p className="dashboard-pagination-note">
                          {activeModalDraftComparisonSummary}
                        </p>
                      </div>
                    </div>
                    {activeModalPolicy.status !== 'PUBLISHED' &&
                    latestPublishedVersion &&
                    changedActiveModalRuleReviewRows.length > 0 ? (
                      <ul className="dashboard-view-list dashboard-policy-view__changes">
                        {changedActiveModalRuleReviewRows.map((entry) => (
                          <li key={`${activeModalPolicy.id}:change:${entry.label}`}>
                            <strong>{entry.label}</strong> {entry.live} {'->'} {entry.next}
                          </li>
                        ))}
                      </ul>
                    ) : null}
                  </section>
                </div>
                <div className="dashboard-form-actions">
                  <button
                    type="button"
                    className="dashboard-pagination-button dashboard-pagination-button--secondary"
                    onClick={closePolicyModal}
                  >
                    {t('policyClose')}
                  </button>
                </div>
              </>
            ) : (
              <p className="dashboard-pagination-note">{t('policyDetailsUnavailable')}</p>
            )
          ) : null}

          {activeModal.kind === 'simulate' ? (
            activeModalPolicy ? (
              <>
                <h2>{t('policySimulateTitle')}</h2>
                <p className="dashboard-pagination-note">
                  {t('policySimulateIntro', {
                    name: activeModalPolicy.name || activeModalPolicy.id,
                  })}
                </p>
                <div className="dashboard-view-grid dashboard-view-grid--two">
                  <label className="dashboard-form-field">
                    <span>{t('policySimFieldAction')}</span>
                    <select
                      className="dashboard-input"
                      value={simulationAction}
                      onChange={(event) => setSimulationAction(event.target.value)}
                    >
                      {POLICY_ACTIONS.map((action) => (
                        <option key={action} value={action}>
                          {formatPolicyActionLabel(action)}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="dashboard-form-field">
                    <span>{t('policySimFieldChain')}</span>
                    <select
                      className="dashboard-input"
                      value={simulationChain}
                      onChange={(event) => setSimulationChain(event.target.value)}
                    >
                      {POLICY_CHAINS.map((chain) => (
                        <option key={chain} value={chain}>
                          {chain}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="dashboard-form-field">
                    <span>{t('policySimFieldAmount')}</span>
                    <input
                      className="dashboard-input"
                      value={simulationAmountMinor}
                      onChange={(event) => setSimulationAmountMinor(event.target.value)}
                      placeholder="10000"
                    />
                  </label>
                  {simulationAction === 'contract_call' ? (
                    <>
                      <label className="dashboard-form-field">
                        <span>{t('policyContractAddress')}</span>
                        <input
                          className="dashboard-input"
                          value={simulationContractAddress}
                          onChange={(event) => setSimulationContractAddress(event.target.value)}
                          placeholder="0x..."
                        />
                      </label>
                      <label className="dashboard-form-field">
                        <span>{t('policySimFieldSelector')}</span>
                        <input
                          className="dashboard-input"
                          value={simulationFunctionSelector}
                          onChange={(event) => setSimulationFunctionSelector(event.target.value)}
                          placeholder={t('policyFunctionPlaceholder')}
                        />
                      </label>
                    </>
                  ) : null}
                </div>
                <div className="dashboard-form-actions">
                  <button
                    type="button"
                    className="dashboard-pagination-button dashboard-pagination-button--secondary"
                    onClick={closePolicyModal}
                    disabled={simulationBusy}
                  >
                    {t('policyClose')}
                  </button>
                  <button
                    type="button"
                    className="dashboard-pagination-button"
                    onClick={() => void runSimulation()}
                    disabled={simulationBusy || !selectedPolicyId}
                  >
                    {simulationBusy ? t('policySimRunning') : t('policySimRun')}
                  </button>
                </div>
                {simulationErrorMessage ? (
                  <p className="dashboard-pagination-note">{simulationErrorMessage}</p>
                ) : null}
                {simulationResult ? (
                  <p className="dashboard-pagination-note">
                    {t('policySimDecision', {
                      decision: simulationResult.decision,
                      policyId: simulationResult.policyId,
                      version: simulationResult.policyVersion,
                      summary: simulationSummary(simulationResult),
                    })}
                  </p>
                ) : null}
              </>
            ) : (
              <p className="dashboard-pagination-note">{t('policySimSelectPolicy')}</p>
            )
          ) : null}

          {activeModal.kind === 'delete' ? (
            activeModalPolicy ? (
              <>
                <h2>{t('policyDeleteTitle')}</h2>
                <p className="dashboard-pagination-note">
                  {renderMessageWithNodes(t('policyDeleteMessage'), {
                    name: <strong>{activeModalPolicy.name || activeModalPolicy.id}</strong>,
                  })}
                </p>
                {activeModalPolicy.isSystemDefault ? (
                  <p className="dashboard-pagination-note">{t('policyDeleteProtected')}</p>
                ) : null}
                <div className="dashboard-form-actions">
                  <button
                    type="button"
                    className="dashboard-pagination-button dashboard-pagination-button--secondary"
                    onClick={closePolicyModal}
                    disabled={mutationBusy === 'delete'}
                  >
                    {t('policyCancel')}
                  </button>
                  <button
                    type="button"
                    className="dashboard-pagination-button"
                    onClick={() => void deleteSelectedPolicy()}
                    disabled={
                      !canMutatePolicies ||
                      mutationBusy === 'delete' ||
                      activeModalPolicy.isSystemDefault
                    }
                  >
                    {mutationBusy === 'delete' ? t('policyDeleting') : t('policyDeleteTitle')}
                  </button>
                </div>
              </>
            ) : (
              <p className="dashboard-pagination-note">{t('policyDetailsUnavailable')}</p>
            )
          ) : null}

          {activeModal.kind === 'publish' ? (
            activeModalPolicy ? (
              <>
                <h2>{t('policyGoLiveTitle')}</h2>
                <p className="dashboard-pagination-note">{t('policyGoLiveIntro')}</p>
                <section className="dashboard-policy-view__section dashboard-policy-go-live__section">
                  <div className="dashboard-policy-view__section-header">
                    <div>
                      <h3>{t('policyReleaseContext')}</h3>
                      <p className="dashboard-pagination-note">{t('policyReleaseContextHint')}</p>
                    </div>
                  </div>
                  <PolicyReviewTable
                    ariaLabel={t('policyGoLiveContextLabel')}
                    rows={activeModalReviewRows}
                  />
                </section>
                <div className="dashboard-modal-divider">
                  <div className="dashboard-policy-view__section-header">
                    <div>
                      <h3>{t('policyChangeSummary')}</h3>
                      <p className="dashboard-pagination-note">
                        {activeModalDraftComparisonSummary}
                      </p>
                    </div>
                  </div>
                  {policyVersionsLoading ? (
                    <p className="dashboard-pagination-note">{t('policyLoadingComparison')}</p>
                  ) : policyVersionsErrorMessage ? (
                    <p className="dashboard-pagination-note">
                      {t('policyComparisonUnavailable', { message: policyVersionsErrorMessage })}
                    </p>
                  ) : latestPublishedVersion ? (
                    changedActiveModalRuleReviewRows.length > 0 ? (
                      <PolicyRuleComparisonTable
                        ariaLabel={t('policyGoLiveChangesLabel')}
                        rows={changedActiveModalRuleReviewRows}
                        nextColumnLabel={t('policyGoLive')}
                        showLiveColumn
                      />
                    ) : (
                      <p className="dashboard-pagination-note">{t('policyNoRuleChanges')}</p>
                    )
                  ) : (
                    <PolicyRuleComparisonTable
                      ariaLabel={t('policyInitialRuleSetLabel')}
                      rows={activeModalRuleReviewRows}
                      nextColumnLabel={t('policyGoLive')}
                      showLiveColumn={false}
                    />
                  )}
                </div>
                <div className="dashboard-modal-divider">
                  <p className="dashboard-pagination-note">{t('policyQueueApprovals')}</p>
                </div>
                <div className="dashboard-view-grid dashboard-view-grid--two">
                  <label className="dashboard-form-field">
                    <span>{t('policyApprovalReasonField')}</span>
                    <input
                      className="dashboard-input"
                      value={approvalCreateReason}
                      onChange={(event) => setApprovalCreateReason(event.target.value)}
                      placeholder="Policy reviewed for publish."
                      disabled={!canMutatePolicies || mutationBusy === 'approval-create'}
                    />
                  </label>
                  <label className="dashboard-form-field">
                    <span>{t('policyApprovalDecisionField')}</span>
                    <input
                      className="dashboard-input"
                      value={approvalDecisionReason}
                      onChange={(event) => setApprovalDecisionReason(event.target.value)}
                      placeholder="Reviewed in policy engine."
                      disabled={!canMutatePolicies}
                    />
                  </label>
                  <label className="dashboard-form-field dashboard-form-field--full">
                    <span>{t('policyApprovedRequestField')}</span>
                    <select
                      className="dashboard-input"
                      value={selectedApprovalId}
                      onChange={(event) => setSelectedApprovalId(event.target.value)}
                      disabled={approvalsLoading || approvedApprovals.length === 0}
                    >
                      <option value="">{t('policyNoApprovedRequest')}</option>
                      {approvedApprovals.map((approval) => (
                        <option key={approval.id} value={approval.id}>
                          {approval.id} ({approval.status})
                        </option>
                      ))}
                    </select>
                  </label>
                </div>

                <div className="dashboard-form-actions">
                  <button
                    type="button"
                    className="dashboard-pagination-button dashboard-pagination-button--secondary"
                    onClick={closePolicyModal}
                    disabled={mutationBusy === 'approval-create' || mutationBusy === 'publish'}
                  >
                    {t('policyClose')}
                  </button>
                  <button
                    type="button"
                    className="dashboard-pagination-button"
                    onClick={() => void createPublishApproval()}
                    disabled={
                      !canMutatePolicies || !selectedPolicyId || mutationBusy === 'approval-create'
                    }
                  >
                    {mutationBusy === 'approval-create'
                      ? t('policyCreatingRequest')
                      : t('policyCreateApprovalRequest')}
                  </button>
                  <button
                    type="button"
                    className="dashboard-pagination-button"
                    onClick={() => void publishSelectedPolicy()}
                    disabled={
                      !canMutatePolicies ||
                      !selectedPolicyId ||
                      activeModalPolicy.status === 'PUBLISHED' ||
                      mutationBusy === 'publish' ||
                      (!approvalsErrorMessage &&
                        relevantApprovals.length > 0 &&
                        approvedApprovals.length === 0)
                    }
                  >
                    {mutationBusy === 'publish' ? t('policyPublishing') : t('policyPublishLive')}
                  </button>
                </div>

                {approvalsLoading ? (
                  <p className="dashboard-pagination-note">{t('policyApprovalsLoading')}</p>
                ) : approvalsErrorMessage ? (
                  <p className="dashboard-pagination-note">
                    {t('policyApprovalsUnavailable', { message: approvalsErrorMessage })}
                  </p>
                ) : relevantApprovals.length === 0 ? (
                  <p className="dashboard-pagination-note">{t('policyApprovalsNone')}</p>
                ) : (
                  <ul className="dashboard-view-list">
                    {relevantApprovals.map((approval) => (
                      <li key={approval.id}>
                        {renderMessageWithNodes(t('policyApprovalItem'), {
                          id: <strong>{approval.id}</strong>,
                          status: approval.status,
                          user: <code>{approval.requestedByUserId}</code>,
                          time: formatTimestamp(approval.createdAt),
                        })}{' '}
                        {approval.reason}
                        {approval.id === requestedApprovalId
                          ? ` ${t('policyOpenedFromAudit')}`
                          : ''}
                        {approval.status === 'PENDING' ? (
                          <>
                            {' '}
                            <button
                              type="button"
                              className="dashboard-inline-link"
                              onClick={() => void approveRequest(approval)}
                              disabled={
                                !canMutatePolicies || mutationBusy === `approve:${approval.id}`
                              }
                            >
                              {mutationBusy === `approve:${approval.id}`
                                ? t('policyApproving')
                                : t('policyApprove')}
                            </button>{' '}
                            <button
                              type="button"
                              className="dashboard-inline-link dashboard-inline-link--danger"
                              onClick={() => void rejectRequest(approval)}
                              disabled={
                                !canMutatePolicies || mutationBusy === `reject:${approval.id}`
                              }
                            >
                              {mutationBusy === `reject:${approval.id}`
                                ? t('policyRejecting')
                                : t('policyReject')}
                            </button>
                          </>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                )}
              </>
            ) : (
              <p className="dashboard-pagination-note">{t('policySelectBeforeScheduling')}</p>
            )
          ) : null}
        </DashboardInlineModal>
      ) : null}
    </div>
  );
}

export default PolicyEnginePage;
