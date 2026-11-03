import React from 'react';
import { formatDashboardTimestamp } from '@core/dashboard/utils/timestamps';
import { toast } from 'sonner';
import { t } from '@core/i18n';
import { useSiteRouter } from '@core/router/useSiteRouter';
import {
  GAS_SPONSORSHIP_CHAIN_MATRIX_ROWS,
  GAS_SPONSORSHIP_CHAIN_TARGETS,
  type GasSponsorshipChainMatrixRow,
  type GasSponsorshipChainTarget,
  type GasSponsorshipTargetNetworkClass,
} from '@seams-internal/wallet-console-shared/gasSponsorshipChains';
import {
  DashboardTable,
  DashboardTableActionButton,
  DashboardTableActionGroup,
  DashboardTableActionMenu,
  DashboardTableCell,
  DashboardTableHeader,
  DashboardTableHeaderCell,
  DashboardTableRow,
  DashboardTableState,
  dashboardTableColumns,
  useDashboardTablePagination,
} from '@core/dashboard/components/DashboardTable';
import { FuelIcon } from '@core/dashboard/icons/SidebarIcons';
import { useDashboardCreateIntent } from '@core/dashboard/utils/routeCreateIntent';
import { DashboardInlineModal } from '@core/dashboard/components/DashboardInlineModal';
import { DashboardPageActions } from '@core/dashboard/components/DashboardPageActions';
import {
  listDashboardEnvironments,
  listDashboardProjects,
} from '@core/dashboard/consoleContextApi';
import {
  canDashboardEditProject,
  useDashboardConsoleSession,
} from '@core/dashboard/consoleSession';
import { useSessionDraft } from '@core/dashboard/drafts/useSessionDraft';
import type { DashboardDraftIdentity } from '@core/dashboard/drafts/sessionDraftStore';
import { useDashboardSelectedContext } from '@core/dashboard/selectedContext';
import {
  BillingMetricsGrid,
  type BillingMetric,
} from '@core/dashboard/routes/billing/billingShared';
import {
  formatUsdMinor,
  getDashboardBillingOverview,
  type DashboardBillingOverview,
} from '@core/dashboard/routes/billing/consoleBillingApi';
import {
  listDashboardSponsoredExecutionHistory,
  listDashboardSponsoredExecutionReconciliation,
  type DashboardSponsoredExecutionHistoryEntry,
  type DashboardSponsoredExecutionReconciliationPage,
} from './consoleSponsoredExecutionApi';
import {
  SponsoredExecutionHistorySection,
  SponsoredExecutionReconciliationSection,
} from './SponsoredExecutionSections';
import {
  createDashboardGasSponsorshipPolicy,
  deleteDashboardGasSponsorshipPolicy,
  listDashboardGasSponsorshipPolicies,
  setDashboardGasSponsorshipPolicyEnabled,
  updateDashboardGasSponsorshipPolicy,
  type DashboardGasSponsorshipAllowedCall,
  type DashboardGasSponsorshipAllowedDelegateAction,
  type DashboardGasSponsorshipEvmPolicy,
  type DashboardGasSponsorshipPolicy,
} from './consoleGasSponsorshipApi';

const SCOPE_TYPES = ['ORG', 'PROJECT', 'ENVIRONMENT', 'POLICY', 'WALLET_SEGMENT'] as const;
type ScopeType = (typeof SCOPE_TYPES)[number];

type GasNetworkClass = 'ANY' | 'TESTNET' | 'MAINNET';
type GasNetworkToggleClass = Exclude<GasNetworkClass, 'ANY'> & GasSponsorshipTargetNetworkClass;
const GAS_SPEND_CAP_MODES = ['NONE', 'CHAIN_TOTAL', 'WALLET_CHAIN_TOTAL'] as const;
type GasSpendCapMode = (typeof GAS_SPEND_CAP_MODES)[number];
const GAS_SPEND_CAP_PERIODS = ['WEEKLY', 'MONTHLY'] as const;
type GasSpendCapPeriod = (typeof GAS_SPEND_CAP_PERIODS)[number];
const GAS_RULE_KINDS = ['evm_call', 'near_delegate'] as const;
type GasRuleKind = (typeof GAS_RULE_KINDS)[number];
const PRODUCTION_ENVIRONMENT_KEY = 'prod';
type GasSponsorshipModalKind = 'create' | 'edit' | 'view';
type GasSponsorshipDraftScope = {
  orgId: string;
  projectId: string;
  environmentId: string;
};
type GasChainTarget = GasSponsorshipChainTarget;
type GasChainMatrixRow = GasSponsorshipChainMatrixRow;
type GasContractFunctionDraft = {
  id: string;
  functionSignature: string;
  maxGasLimit: string;
  maxValueWei: string;
};
type GasContractRuleDraft = {
  id: string;
  contractAddress: string;
  functions: GasContractFunctionDraft[];
};
type GasNearDelegateActionDraft = {
  id: string;
  receiverId: string;
  methodsText: string;
  maxDepositYocto: string;
  allowTransfers: boolean;
};

const GAS_CHAIN_MATRIX_ROWS: readonly GasChainMatrixRow[] = GAS_SPONSORSHIP_CHAIN_MATRIX_ROWS;
const GAS_CHAIN_TARGETS: readonly GasChainTarget[] = GAS_SPONSORSHIP_CHAIN_TARGETS;
const GAS_CHAIN_TARGETS_BY_ID = new Map(GAS_CHAIN_TARGETS.map((target) => [target.id, target]));
const GAS_CHAIN_TARGETS_BY_CHAIN_ID = new Map(
  GAS_CHAIN_TARGETS.map((target) => [target.chainId, target]),
);
const GAS_CHAIN_TARGET_IDS = new Set(GAS_CHAIN_TARGETS.map((target) => target.id));
const GAS_MAINNET_TARGET_IDS = GAS_CHAIN_TARGETS.filter(
  (target) => target.networkClass === 'MAINNET',
).map((target) => target.id);
const GAS_TESTNET_TARGET_IDS = GAS_CHAIN_TARGETS.filter(
  (target) => target.networkClass === 'TESTNET',
).map((target) => target.id);
const GAS_SPONSORSHIP_TABLE_COLUMNS = dashboardTableColumns(2.1, 1.05, 1, 0.9, 0.95);
const SPEND_CAP_DECIMAL_FORMATTERS = new Map<number, Intl.NumberFormat>();

type GasSponsorshipFormState = {
  name: string;
  ruleKind: GasRuleKind;
  scopeType: ScopeType;
  projectId: string;
  environmentId: string;
  scopePolicyId: string;
  walletSegmentId: string;
  enabled: boolean;
  selectedTargets: string[];
  contractCallRules: GasContractRuleDraft[];
  delegateActionRules: GasNearDelegateActionDraft[];
  spendCapMode: GasSpendCapMode;
  spendCapPeriod: GasSpendCapPeriod;
  spendCapAmountByChainName: Record<string, string>;
};

function normalizeString(value: string): string {
  return String(value || '').trim();
}

function makeDraftId(prefix: string): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}

function normalizeFunctionSignatureInput(value: string): string | null {
  const normalized = normalizeString(value);
  return /^[A-Za-z_][A-Za-z0-9_]*\([^)]*\)$/.test(normalized) ? normalized : null;
}

function parseRequiredUnsignedIntegerString(value: string, field: string): string {
  const normalized = normalizeString(value);
  if (!/^\d+$/.test(normalized)) {
    throw new Error(t('gasErrIntNonNegative', { field }));
  }
  return BigInt(normalized).toString(10);
}

function parseRequiredPositiveIntegerString(value: string, field: string): string {
  const normalized = parseRequiredUnsignedIntegerString(value, field);
  if (BigInt(normalized) <= 0n) {
    throw new Error(t('gasErrGreaterThanZero', { field }));
  }
  return normalized;
}

function createEmptyGasContractFunctionDraft(): GasContractFunctionDraft {
  return {
    id: makeDraftId('gas_function'),
    functionSignature: '',
    maxGasLimit: '',
    maxValueWei: '0',
  };
}

function createEmptyGasContractRuleDraft(): GasContractRuleDraft {
  return {
    id: makeDraftId('gas_contract'),
    contractAddress: '',
    functions: [createEmptyGasContractFunctionDraft()],
  };
}

function createEmptyNearDelegateActionDraft(): GasNearDelegateActionDraft {
  return {
    id: makeDraftId('gas_near_action'),
    receiverId: '',
    methodsText: '',
    maxDepositYocto: '0',
    allowTransfers: false,
  };
}

function formatTimestamp(value: string): string {
  return formatDashboardTimestamp(value, '—');
}

function normalizeSpendCapDisplayDecimals(value: number): number {
  if (!Number.isInteger(value) || value < 0 || value > 6) return 2;
  return value;
}

function getSpendCapMinorDivisor(displayDecimals: number): number {
  return 10 ** normalizeSpendCapDisplayDecimals(displayDecimals);
}

function getSpendCapDecimalFormatter(displayDecimals: number): Intl.NumberFormat {
  const normalizedDecimals = normalizeSpendCapDisplayDecimals(displayDecimals);
  const existing = SPEND_CAP_DECIMAL_FORMATTERS.get(normalizedDecimals);
  if (existing) return existing;
  const formatter = new Intl.NumberFormat(undefined, {
    minimumFractionDigits: normalizedDecimals,
    maximumFractionDigits: normalizedDecimals,
  });
  SPEND_CAP_DECIMAL_FORMATTERS.set(normalizedDecimals, formatter);
  return formatter;
}

function formatSpendCapInputMinor(valueMinor: number, displayDecimals: number): string {
  if (!Number.isFinite(valueMinor)) return getSpendCapDecimalFormatter(displayDecimals).format(0);
  return (valueMinor / getSpendCapMinorDivisor(displayDecimals)).toFixed(
    normalizeSpendCapDisplayDecimals(displayDecimals),
  );
}

function formatSpendCapAmountMinor(
  valueMinor: number,
  currencyCode: string,
  displayDecimals: number,
): string {
  const normalizedUnit = normalizeString(currencyCode) || t('gasUnitsFallback');
  const safeValue = Number.isFinite(valueMinor) ? valueMinor : 0;
  return `${getSpendCapDecimalFormatter(displayDecimals).format(
    safeValue / getSpendCapMinorDivisor(displayDecimals),
  )} ${normalizedUnit}`;
}

function parseSpendCapAmountToMinor(value: string, displayDecimals: number): number | null {
  const normalizedDecimals = normalizeSpendCapDisplayDecimals(displayDecimals);
  const trimmed = normalizeString(value).replace(/,/g, '');
  if (!trimmed || trimmed === '.') return null;
  const amountPattern =
    normalizedDecimals === 0
      ? /^\d+$/
      : new RegExp(`^(?:\\d+|\\d*\\.\\d{1,${normalizedDecimals}})$`);
  if (!amountPattern.test(trimmed)) {
    return null;
  }
  const normalized = trimmed.startsWith('.') ? `0${trimmed}` : trimmed;
  const [wholeRaw, fractionRaw = ''] = normalized.split('.');
  const whole = Number.parseInt(wholeRaw || '0', 10);
  const fraction = Number.parseInt(fractionRaw.padEnd(normalizedDecimals, '0') || '0', 10);
  if (!Number.isSafeInteger(whole) || !Number.isSafeInteger(fraction)) return null;
  const result = whole * getSpendCapMinorDivisor(normalizedDecimals) + fraction;
  return Number.isSafeInteger(result) ? result : null;
}

function parseRequiredSpendCapAmountToMinor(
  value: string,
  field: string,
  displayDecimals: number,
): number {
  const normalizedDecimals = normalizeSpendCapDisplayDecimals(displayDecimals);
  const parsed = parseSpendCapAmountToMinor(value, normalizedDecimals);
  if (parsed === null) {
    throw new Error(t('gasErrSpendCapAmount', { field, decimals: normalizedDecimals }));
  }
  return parsed;
}

function normalizeSpendCapAmountInput(value: string, displayDecimals: number): string {
  const parsed = parseSpendCapAmountToMinor(value, displayDecimals);
  return parsed === null
    ? normalizeString(value)
    : formatSpendCapInputMinor(parsed, displayDecimals);
}

const GAS_NEAR_DELEGATE_DRAFT_FIELDS = [
  'id',
  'receiverId',
  'methodsText',
  'maxDepositYocto',
  'allowTransfers',
] as const;
const GAS_CONTRACT_FUNCTION_DRAFT_FIELDS = [
  'id',
  'functionSignature',
  'maxGasLimit',
  'maxValueWei',
] as const;
const GAS_CONTRACT_RULE_DRAFT_FIELDS = ['id', 'contractAddress', 'functions'] as const;
const GAS_SPONSORSHIP_FORM_DRAFT_FIELDS = [
  'name',
  'ruleKind',
  'scopeType',
  'projectId',
  'environmentId',
  'scopePolicyId',
  'walletSegmentId',
  'enabled',
  'selectedTargets',
  'contractCallRules',
  'delegateActionRules',
  'spendCapMode',
  'spendCapPeriod',
  'spendCapAmountByChainName',
] as const;

function gasDraftPlainObject(raw: unknown): object | null {
  return raw !== null && typeof raw === 'object' && !Array.isArray(raw) ? raw : null;
}

function gasDraftOwnValue(raw: object, field: string): unknown {
  return Reflect.get(raw, field);
}

function gasDraftExactObject(raw: unknown, expectedFields: readonly string[]): object | null {
  const object = gasDraftPlainObject(raw);
  if (!object) return null;
  const actualFields = Object.keys(object);
  if (actualFields.length !== expectedFields.length) return null;
  return actualFields.every((field) => expectedFields.includes(field)) ? object : null;
}

function readEnumValue<TEnum extends readonly string[]>(
  raw: unknown,
  allowedValues: TEnum,
  fallback: TEnum[number],
): TEnum[number] {
  const value = String(raw || '')
    .trim()
    .toUpperCase();
  if (allowedValues.some((entry) => entry === value)) {
    return value as TEnum[number];
  }
  return fallback;
}

function uniqueGasTargetIds(values: readonly string[]): string[] {
  const out: string[] = [];
  for (const value of values) {
    const normalized = String(value || '').trim();
    if (!normalized || !GAS_CHAIN_TARGET_IDS.has(normalized) || out.includes(normalized)) continue;
    out.push(normalized);
  }
  return out;
}

function parseGasNearDelegateActionDraft(raw: unknown): GasNearDelegateActionDraft | null {
  const entry = gasDraftExactObject(raw, GAS_NEAR_DELEGATE_DRAFT_FIELDS);
  if (!entry) return null;
  return {
    id:
      normalizeString(String(gasDraftOwnValue(entry, 'id') || '')) ||
      makeDraftId('gas_near_action'),
    receiverId: normalizeString(String(gasDraftOwnValue(entry, 'receiverId') || '')),
    methodsText: normalizeString(String(gasDraftOwnValue(entry, 'methodsText') || '')),
    maxDepositYocto:
      normalizeString(String(gasDraftOwnValue(entry, 'maxDepositYocto') || '')) || '0',
    allowTransfers: gasDraftOwnValue(entry, 'allowTransfers') === true,
  };
}

function readNearDelegateActionDrafts(raw: unknown): GasNearDelegateActionDraft[] {
  if (!Array.isArray(raw)) return [];
  const out: GasNearDelegateActionDraft[] = [];
  for (const entry of raw) {
    const parsed = parseGasNearDelegateActionDraft(entry);
    if (parsed) out.push(parsed);
  }
  return out;
}

function splitNearMethodsInput(value: string): string[] {
  const parts = normalizeString(value)
    .split(/[\n,]+/)
    .map((entry) => normalizeString(entry))
    .filter(Boolean);
  return Array.from(new Set(parts));
}

function joinNearMethods(methods: readonly string[]): string {
  return methods.join(', ');
}

function parseGasContractFunctionDraft(raw: unknown): GasContractFunctionDraft | null {
  const entry = gasDraftExactObject(raw, GAS_CONTRACT_FUNCTION_DRAFT_FIELDS);
  if (!entry) return null;
  return {
    id: normalizeString(String(gasDraftOwnValue(entry, 'id') || '')) || makeDraftId('gas_function'),
    functionSignature: normalizeString(String(gasDraftOwnValue(entry, 'functionSignature') || '')),
    maxGasLimit: normalizeString(String(gasDraftOwnValue(entry, 'maxGasLimit') || '')),
    maxValueWei: normalizeString(String(gasDraftOwnValue(entry, 'maxValueWei') || '')) || '0',
  };
}

function parseGasContractRuleDraft(raw: unknown): GasContractRuleDraft | null {
  const entry = gasDraftExactObject(raw, GAS_CONTRACT_RULE_DRAFT_FIELDS);
  if (!entry) return null;
  const functionsRaw = gasDraftOwnValue(entry, 'functions');
  const functions: GasContractFunctionDraft[] = [];
  if (Array.isArray(functionsRaw)) {
    for (const functionRaw of functionsRaw) {
      const parsed = parseGasContractFunctionDraft(functionRaw);
      if (parsed) functions.push(parsed);
    }
  }
  return {
    id: normalizeString(String(gasDraftOwnValue(entry, 'id') || '')) || makeDraftId('gas_contract'),
    contractAddress: normalizeString(String(gasDraftOwnValue(entry, 'contractAddress') || '')),
    functions: functions.length > 0 ? functions : [createEmptyGasContractFunctionDraft()],
  };
}

function readGasContractRuleDrafts(raw: unknown): GasContractRuleDraft[] {
  if (!Array.isArray(raw)) return [];
  const out: GasContractRuleDraft[] = [];
  for (const entry of raw) {
    const parsed = parseGasContractRuleDraft(entry);
    if (parsed) out.push(parsed);
  }
  return out;
}

function readSpendCapAmountByChainName(raw: unknown): Record<string, string> {
  const object = gasDraftPlainObject(raw);
  if (!object) return {};
  const out: Record<string, string> = {};
  for (const chainNameRaw of Object.keys(object)) {
    const chainName = normalizeString(chainNameRaw);
    const value = normalizeString(String(gasDraftOwnValue(object, chainNameRaw) || ''));
    if (!chainName || !value) continue;
    out[chainName] = value;
  }
  return out;
}

function gasNetworkClassFromEnvironmentKey(environmentKey: string): GasNetworkToggleClass {
  return normalizeString(environmentKey).toLowerCase() === PRODUCTION_ENVIRONMENT_KEY
    ? 'MAINNET'
    : 'TESTNET';
}

function getGasChainTargetForNetwork(
  row: GasChainMatrixRow,
  networkClass: GasNetworkToggleClass,
): GasChainTarget | null {
  return networkClass === 'MAINNET' ? row.mainnet : row.testnet;
}

function getNearSpendCapTargetForNetwork(
  networkClass: GasNetworkToggleClass,
): GasChainTarget | null {
  const nearRow = GAS_CHAIN_MATRIX_ROWS.find((row) => row.chainName === 'NEAR') || null;
  return nearRow ? getGasChainTargetForNetwork(nearRow, networkClass) : null;
}

function remapSelectedTargetsToNetwork(
  selectedTargets: readonly string[],
  networkClass: GasNetworkToggleClass,
): string[] {
  const selectedChainNames = new Set(
    uniqueGasTargetIds(selectedTargets)
      .map((targetId) => GAS_CHAIN_TARGETS_BY_ID.get(targetId)?.chainName || '')
      .filter(Boolean),
  );
  return GAS_CHAIN_MATRIX_ROWS.map((row) =>
    selectedChainNames.has(row.chainName)
      ? getGasChainTargetForNetwork(row, networkClass)?.id || ''
      : '',
  ).filter(Boolean);
}

function groupAllowedCallsByContract(
  allowedCalls: readonly DashboardGasSponsorshipAllowedCall[],
): GasContractRuleDraft[] {
  const byContract = new Map<
    string,
    { contractAddress: string; functions: GasContractFunctionDraft[]; seen: Set<string> }
  >();
  for (const allowedCall of allowedCalls) {
    const contractKey = allowedCall.to.toLowerCase();
    const functionSignature = normalizeString(allowedCall.functionSignature);
    if (!functionSignature) continue;
    let bucket = byContract.get(contractKey);
    if (!bucket) {
      bucket = {
        contractAddress: allowedCall.to,
        functions: [],
        seen: new Set<string>(),
      };
      byContract.set(contractKey, bucket);
    }
    const functionKey = [
      functionSignature.toLowerCase(),
      normalizeString(allowedCall.maxGasLimit),
      normalizeString(allowedCall.maxValueWei),
    ].join(':');
    if (bucket.seen.has(functionKey)) continue;
    bucket.seen.add(functionKey);
    bucket.functions.push({
      id: makeDraftId('gas_function'),
      functionSignature,
      maxGasLimit: normalizeString(allowedCall.maxGasLimit),
      maxValueWei: normalizeString(allowedCall.maxValueWei) || '0',
    });
  }
  return Array.from(byContract.values()).map((entry) => ({
    id: `gas_contract_${entry.contractAddress.toLowerCase()}`,
    contractAddress: entry.contractAddress,
    functions:
      entry.functions.length > 0 ? entry.functions : [createEmptyGasContractFunctionDraft()],
  }));
}

function buildNearDelegateActionDrafts(
  allowedDelegateActions: readonly DashboardGasSponsorshipAllowedDelegateAction[],
): GasNearDelegateActionDraft[] {
  return allowedDelegateActions.map((entry) => ({
    id: makeDraftId('gas_near_action'),
    receiverId: entry.receiverId,
    methodsText: joinNearMethods(entry.methods),
    maxDepositYocto: normalizeString(entry.maxDepositYocto) || '0',
    allowTransfers: entry.allowTransfers === true,
  }));
}

function resolveSelectedTargetsOrThrow(selectedTargetIds: readonly string[]): GasChainTarget[] {
  const targets = uniqueGasTargetIds(selectedTargetIds)
    .map((targetId) => GAS_CHAIN_TARGETS_BY_ID.get(targetId) || null)
    .filter((target): target is GasChainTarget => target !== null);
  if (targets.length === 0) {
    throw new Error(t('gasErrChooseTarget'));
  }
  return targets;
}

function resolveSelectedTargetIdsFromPolicy(policy: DashboardGasSponsorshipEvmPolicy): string[] {
  const targetIdsFromCalls = policy.allowedCalls
    .map((call) => GAS_CHAIN_TARGETS.find((target) => target.chainId === call.chainId)?.id || '')
    .filter(Boolean);
  if (targetIdsFromCalls.length > 0) {
    return uniqueGasTargetIds(targetIdsFromCalls);
  }
  if (policy.networkClass === 'MAINNET') return [...GAS_MAINNET_TARGET_IDS];
  if (policy.networkClass === 'TESTNET') return [...GAS_TESTNET_TARGET_IDS];
  return [];
}

function formatSelectedTargetLabels(targetIds: readonly string[]): string {
  const labels = uniqueGasTargetIds(targetIds)
    .map((targetId) => GAS_CHAIN_TARGETS_BY_ID.get(targetId)?.chainLabel || '')
    .filter(Boolean);
  if (labels.length === 0) return t('gasNoChainTargets');
  if (labels.length <= 2) return labels.join(' / ');
  return t('gasChainTargetsMore', {
    labels: labels.slice(0, 2).join(' / '),
    count: labels.length - 2,
  });
}

function parseGasSponsorshipFormDraft(
  raw: unknown,
  fallback: GasSponsorshipFormState,
): GasSponsorshipFormState | null {
  const form = gasDraftExactObject(raw, GAS_SPONSORSHIP_FORM_DRAFT_FIELDS);
  if (!form) return null;
  const contractCallRules = readGasContractRuleDrafts(gasDraftOwnValue(form, 'contractCallRules'));
  const delegateActionRules = readNearDelegateActionDrafts(
    gasDraftOwnValue(form, 'delegateActionRules'),
  );
  const selectedTargetsRaw = gasDraftOwnValue(form, 'selectedTargets');
  const spendCapAmountByChainName = readSpendCapAmountByChainName(
    gasDraftOwnValue(form, 'spendCapAmountByChainName'),
  );
  const enabledRaw = gasDraftOwnValue(form, 'enabled');
  return {
    name: normalizeString(String(gasDraftOwnValue(form, 'name') ?? fallback.name)),
    ruleKind: readEnumValue(gasDraftOwnValue(form, 'ruleKind'), GAS_RULE_KINDS, fallback.ruleKind),
    scopeType: readEnumValue(gasDraftOwnValue(form, 'scopeType'), SCOPE_TYPES, fallback.scopeType),
    projectId: normalizeString(String(gasDraftOwnValue(form, 'projectId') ?? fallback.projectId)),
    environmentId: normalizeString(
      String(gasDraftOwnValue(form, 'environmentId') ?? fallback.environmentId),
    ),
    scopePolicyId: normalizeString(
      String(gasDraftOwnValue(form, 'scopePolicyId') ?? fallback.scopePolicyId),
    ),
    walletSegmentId: normalizeString(
      String(gasDraftOwnValue(form, 'walletSegmentId') ?? fallback.walletSegmentId),
    ),
    enabled: typeof enabledRaw === 'boolean' ? enabledRaw : fallback.enabled,
    selectedTargets: Array.isArray(selectedTargetsRaw)
      ? uniqueGasTargetIds(selectedTargetsRaw.map((value) => String(value || '')))
      : fallback.selectedTargets,
    contractCallRules:
      contractCallRules.length > 0 ? contractCallRules : fallback.contractCallRules,
    delegateActionRules:
      delegateActionRules.length > 0 ? delegateActionRules : fallback.delegateActionRules,
    spendCapMode: readEnumValue(
      gasDraftOwnValue(form, 'spendCapMode'),
      GAS_SPEND_CAP_MODES,
      fallback.spendCapMode,
    ),
    spendCapPeriod: readEnumValue(
      gasDraftOwnValue(form, 'spendCapPeriod'),
      GAS_SPEND_CAP_PERIODS,
      fallback.spendCapPeriod,
    ),
    spendCapAmountByChainName:
      Object.keys(spendCapAmountByChainName).length > 0
        ? spendCapAmountByChainName
        : fallback.spendCapAmountByChainName,
  };
}

function areGasStringListsEqual(left: readonly string[], right: readonly string[]): boolean {
  if (left.length !== right.length) return false;
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) return false;
  }
  return true;
}

function areGasContractFunctionDraftsEqual(
  left: readonly GasContractFunctionDraft[],
  right: readonly GasContractFunctionDraft[],
): boolean {
  if (left.length !== right.length) return false;
  for (let index = 0; index < left.length; index += 1) {
    const leftEntry = left[index];
    const rightEntry = right[index];
    if (
      leftEntry.id !== rightEntry.id ||
      leftEntry.functionSignature !== rightEntry.functionSignature ||
      leftEntry.maxGasLimit !== rightEntry.maxGasLimit ||
      leftEntry.maxValueWei !== rightEntry.maxValueWei
    ) {
      return false;
    }
  }
  return true;
}

function areGasContractRuleDraftsEqual(
  left: readonly GasContractRuleDraft[],
  right: readonly GasContractRuleDraft[],
): boolean {
  if (left.length !== right.length) return false;
  for (let index = 0; index < left.length; index += 1) {
    const leftEntry = left[index];
    const rightEntry = right[index];
    if (
      leftEntry.id !== rightEntry.id ||
      leftEntry.contractAddress !== rightEntry.contractAddress ||
      !areGasContractFunctionDraftsEqual(leftEntry.functions, rightEntry.functions)
    ) {
      return false;
    }
  }
  return true;
}

function areGasDelegateActionDraftsEqual(
  left: readonly GasNearDelegateActionDraft[],
  right: readonly GasNearDelegateActionDraft[],
): boolean {
  if (left.length !== right.length) return false;
  for (let index = 0; index < left.length; index += 1) {
    const leftEntry = left[index];
    const rightEntry = right[index];
    if (
      leftEntry.id !== rightEntry.id ||
      leftEntry.receiverId !== rightEntry.receiverId ||
      leftEntry.methodsText !== rightEntry.methodsText ||
      leftEntry.maxDepositYocto !== rightEntry.maxDepositYocto ||
      leftEntry.allowTransfers !== rightEntry.allowTransfers
    ) {
      return false;
    }
  }
  return true;
}

function areGasSpendCapAmountsEqual(
  left: Readonly<Record<string, string>>,
  right: Readonly<Record<string, string>>,
): boolean {
  const leftKeys = Object.keys(left);
  const rightKeys = Object.keys(right);
  if (leftKeys.length !== rightKeys.length) return false;
  for (const key of leftKeys) {
    if (!Object.prototype.hasOwnProperty.call(right, key) || left[key] !== right[key]) {
      return false;
    }
  }
  return true;
}

function areGasSponsorshipFormsEqual(
  left: GasSponsorshipFormState,
  right: GasSponsorshipFormState,
): boolean {
  return (
    left.name === right.name &&
    left.ruleKind === right.ruleKind &&
    left.scopeType === right.scopeType &&
    left.projectId === right.projectId &&
    left.environmentId === right.environmentId &&
    left.scopePolicyId === right.scopePolicyId &&
    left.walletSegmentId === right.walletSegmentId &&
    left.enabled === right.enabled &&
    areGasStringListsEqual(left.selectedTargets, right.selectedTargets) &&
    areGasContractRuleDraftsEqual(left.contractCallRules, right.contractCallRules) &&
    areGasDelegateActionDraftsEqual(left.delegateActionRules, right.delegateActionRules) &&
    left.spendCapMode === right.spendCapMode &&
    left.spendCapPeriod === right.spendCapPeriod &&
    areGasSpendCapAmountsEqual(left.spendCapAmountByChainName, right.spendCapAmountByChainName)
  );
}

function resolveDefaultScopeType(projectId: string, environmentId: string): ScopeType {
  if (normalizeString(environmentId)) return 'ENVIRONMENT';
  if (normalizeString(projectId)) return 'PROJECT';
  return 'ORG';
}

function createInitialFormState(projectId: string, environmentId: string): GasSponsorshipFormState {
  return {
    name: 'Project gas sponsorship',
    ruleKind: 'evm_call',
    scopeType: resolveDefaultScopeType(projectId, environmentId),
    projectId,
    environmentId,
    scopePolicyId: '',
    walletSegmentId: '',
    enabled: true,
    selectedTargets: [],
    contractCallRules: [],
    delegateActionRules: [],
    spendCapMode: 'NONE',
    spendCapPeriod: 'MONTHLY',
    spendCapAmountByChainName: {},
  };
}

function buildFormStateFromPolicy(
  policy: DashboardGasSponsorshipPolicy,
  projectId: string,
  environmentId: string,
): GasSponsorshipFormState {
  const spendCapAmountByChainName = policy.spendCap.capsByChain.reduce<Record<string, string>>(
    (accumulator, entry) => {
      const target = GAS_CHAIN_TARGETS_BY_CHAIN_ID.get(entry.chainId);
      if (!target) return accumulator;
      accumulator[target.chainName] = formatSpendCapInputMinor(
        entry.capMinor,
        target.spendCapDisplayDecimals,
      );
      return accumulator;
    },
    {},
  );
  return {
    name: policy.name,
    ruleKind: policy.kind,
    scopeType: String(policy.scopeType || 'ENVIRONMENT').toUpperCase() as ScopeType,
    projectId: policy.projectId || projectId,
    environmentId: policy.environmentId || environmentId,
    scopePolicyId: policy.scopePolicyId || '',
    walletSegmentId: policy.walletSegmentId || '',
    enabled: policy.enabled,
    selectedTargets: policy.kind === 'evm_call' ? resolveSelectedTargetIdsFromPolicy(policy) : [],
    contractCallRules:
      policy.kind === 'evm_call' ? groupAllowedCallsByContract(policy.allowedCalls) : [],
    delegateActionRules:
      policy.kind === 'near_delegate'
        ? buildNearDelegateActionDrafts(policy.allowedDelegateActions)
        : [],
    spendCapMode: policy.spendCap.mode,
    spendCapPeriod: policy.spendCap.period,
    spendCapAmountByChainName,
  };
}

function buildScopePayload(form: GasSponsorshipFormState): Record<string, string> {
  const projectId = normalizeString(form.projectId);
  const environmentId = normalizeString(form.environmentId);
  const scopePolicyId = normalizeString(form.scopePolicyId);
  const walletSegmentId = normalizeString(form.walletSegmentId);
  if (form.scopeType === 'PROJECT' && !projectId) {
    throw new Error(t('gasErrProjectScope'));
  }
  if (form.scopeType === 'ENVIRONMENT' && !environmentId) {
    throw new Error(t('gasErrEnvironmentScope'));
  }
  if (form.scopeType === 'POLICY' && !scopePolicyId) {
    throw new Error(t('gasErrPolicyScope'));
  }
  if (form.scopeType === 'WALLET_SEGMENT' && !walletSegmentId) {
    throw new Error(t('gasErrWalletSegmentScope'));
  }
  return {
    scopeType: form.scopeType,
    ...(projectId ? { projectId } : {}),
    ...(environmentId ? { environmentId } : {}),
    ...(scopePolicyId ? { scopePolicyId } : {}),
    ...(walletSegmentId ? { walletSegmentId } : {}),
  };
}

function buildSpendCap(form: GasSponsorshipFormState, selectedTargets: readonly GasChainTarget[]) {
  if (form.spendCapMode === 'NONE') {
    return {
      mode: 'NONE' as const,
      period: form.spendCapPeriod,
      capsByChain: [],
    };
  }
  return {
    mode: form.spendCapMode,
    period: form.spendCapPeriod,
    capsByChain: selectedTargets.flatMap((target) => {
      const rawCapAmount = normalizeString(form.spendCapAmountByChainName[target.chainName] || '');
      if (!rawCapAmount) return [];
      return [
        {
          chainId: target.chainId,
          capMinor: parseRequiredSpendCapAmountToMinor(
            rawCapAmount,
            t('gasFieldSpendCap', { chain: target.chainLabel }),
            target.spendCapDisplayDecimals,
          ),
        },
      ];
    }),
  };
}

function buildAllowedCalls(
  form: GasSponsorshipFormState,
  selectedTargets: readonly GasChainTarget[],
) {
  if (selectedTargets.length === 0) {
    throw new Error(t('gasErrChooseTarget'));
  }
  if (form.contractCallRules.length === 0) {
    throw new Error(t('gasErrAddContract'));
  }
  const out = new Map<
    string,
    {
      chainId: number;
      to: string;
      functionSignature: string;
      maxGasLimit: string;
      maxValueWei: string;
    }
  >();
  for (const rule of form.contractCallRules) {
    const contractAddress = normalizeString(rule.contractAddress);
    if (!/^0x[0-9a-fA-F]{40}$/.test(contractAddress)) {
      throw new Error(t('gasErrContractAddress'));
    }
    const functions = rule.functions.filter(
      (entry) =>
        normalizeString(entry.functionSignature) ||
        normalizeString(entry.maxGasLimit) ||
        normalizeString(entry.maxValueWei),
    );
    if (functions.length === 0) {
      throw new Error(t('gasErrContractNeedsFunction'));
    }
    for (const functionEntry of functions) {
      const functionSignature = normalizeFunctionSignatureInput(functionEntry.functionSignature);
      if (!functionSignature) {
        throw new Error(t('gasErrFunctionSignature'));
      }
      const maxGasLimit = parseRequiredPositiveIntegerString(
        functionEntry.maxGasLimit,
        t('gasFieldMaxGasLimit', { signature: functionSignature }),
      );
      const maxValueWei = parseRequiredUnsignedIntegerString(
        functionEntry.maxValueWei,
        t('gasFieldMaxValue', { signature: functionSignature }),
      );
      for (const target of selectedTargets) {
        out.set(
          `${target.chainId}:${contractAddress.toLowerCase()}:${functionSignature.toLowerCase()}`,
          {
            chainId: target.chainId,
            to: contractAddress,
            functionSignature,
            maxGasLimit,
            maxValueWei,
          },
        );
      }
    }
  }
  return Array.from(out.values());
}

function buildAllowedDelegateActions(
  form: GasSponsorshipFormState,
): DashboardGasSponsorshipAllowedDelegateAction[] {
  const populatedRules = form.delegateActionRules.filter(
    (entry) =>
      normalizeString(entry.receiverId) ||
      normalizeString(entry.methodsText) ||
      normalizeString(entry.maxDepositYocto) ||
      entry.allowTransfers,
  );
  if (populatedRules.length === 0) {
    throw new Error(t('gasErrAddDelegateAction'));
  }
  const out = new Map<string, DashboardGasSponsorshipAllowedDelegateAction>();
  for (const rule of populatedRules) {
    const receiverId = normalizeString(rule.receiverId);
    if (!receiverId) {
      throw new Error(t('gasErrReceiverRequired'));
    }
    const maxDepositYocto = parseRequiredUnsignedIntegerString(
      rule.maxDepositYocto,
      t('gasFieldMaxDeposit', { receiver: receiverId }),
    );
    const methods = splitNearMethodsInput(rule.methodsText);
    const dedupeKey = [
      receiverId.toLowerCase(),
      methods.join(','),
      rule.allowTransfers ? '1' : '0',
      maxDepositYocto,
    ].join(':');
    out.set(dedupeKey, {
      receiverId,
      methods,
      maxDepositYocto,
      allowTransfers: rule.allowTransfers === true,
    });
  }
  return Array.from(out.values());
}

function buildGasSponsorshipRequest(
  form: GasSponsorshipFormState,
  networkClass: GasNetworkToggleClass,
): Record<string, unknown> {
  if (form.ruleKind === 'near_delegate') {
    const nearTarget = getNearSpendCapTargetForNetwork(networkClass);
    if (form.spendCapMode !== 'NONE' && !nearTarget) {
      throw new Error(
        t('gasErrNearCapTarget', {
          network: t(
            networkClass === 'MAINNET' ? 'gasNetworkMainnet' : 'gasNetworkTestnet',
          ).toLowerCase(),
        }),
      );
    }
    return {
      ...buildScopePayload(form),
      name: normalizeString(form.name) || 'Gas Sponsorship Policy',
      kind: 'near_delegate',
      executionMode: 'near_delegate',
      networkClass,
      enabled: form.enabled,
      spendCap:
        form.spendCapMode === 'NONE' || !nearTarget
          ? {
              mode: 'NONE' as const,
              period: form.spendCapPeriod,
              capsByChain: [],
            }
          : buildSpendCap(form, [nearTarget]),
      allowedDelegateActions: buildAllowedDelegateActions(form),
    };
  }
  const selectedTargets = resolveSelectedTargetsOrThrow(
    remapSelectedTargetsToNetwork(form.selectedTargets, networkClass),
  );
  return {
    ...buildScopePayload(form),
    name: normalizeString(form.name) || 'Gas Sponsorship Policy',
    kind: 'evm_call',
    executionMode: 'evm_eoa',
    networkClass,
    enabled: form.enabled,
    spendCap: buildSpendCap(form, selectedTargets),
    allowedCalls: buildAllowedCalls(form, selectedTargets),
  };
}

function describeCoverageProjectLabel(input: {
  projectName?: string;
  projectId?: string | null;
}): string {
  return (
    normalizeString(String(input.projectName || '')) ||
    normalizeString(String(input.projectId || '')) ||
    '-'
  );
}

function describeCoverageEnvironmentLabel(input: {
  environmentName?: string;
  environmentKey?: string;
  environmentId?: string | null;
}): string {
  const explicitName = normalizeString(String(input.environmentName || ''));
  if (explicitName) return explicitName.toLowerCase();
  const environmentKey = normalizeString(String(input.environmentKey || '')).toLowerCase();
  if (environmentKey === 'dev') return t('gasEnvDevelopment');
  if (environmentKey === 'prod') return t('gasEnvProduction');
  if (environmentKey === 'staging') return t('gasEnvStaging');
  return normalizeString(String(input.environmentId || '')) || '-';
}

function describeSpendCapMode(
  mode: GasSpendCapMode | DashboardGasSponsorshipPolicy['spendCap']['mode'],
): string {
  if (mode === 'CHAIN_TOTAL') return t('gasSpendCapPerChain');
  if (mode === 'WALLET_CHAIN_TOTAL') return t('gasSpendCapPerWalletChain');
  return t('gasSpendCapNone');
}

function describeSpendCapPeriodInline(period: GasSpendCapPeriod): string {
  return period === 'WEEKLY' ? t('gasPeriodWeeklyInline') : t('gasPeriodMonthlyInline');
}

function describeSpendCapPeriodOption(period: GasSpendCapPeriod): string {
  return period === 'WEEKLY' ? t('gasPeriodWeekly') : t('gasPeriodMonthly');
}

function formatSpendCapCoverageEntry(input: {
  chainId: number;
  capMinor: number;
  mode: DashboardGasSponsorshipPolicy['spendCap']['mode'];
  period: DashboardGasSponsorshipPolicy['spendCap']['period'];
}): string {
  const target = GAS_CHAIN_TARGETS_BY_CHAIN_ID.get(input.chainId);
  const chainLabel = target?.chainLabel || t('gasChainFallback', { chainId: input.chainId });
  const scopeLabel =
    input.mode === 'CHAIN_TOTAL' ? t('gasCapScopeTotal') : t('gasCapScopePerWallet');
  return t('gasCapCoverageEntry', {
    chain: chainLabel,
    period: describeSpendCapPeriodInline(input.period),
    amount: formatSpendCapAmountMinor(
      input.capMinor,
      target?.spendCapCurrencyCode || t('gasUnitsFallback'),
      target?.spendCapDisplayDecimals ?? 2,
    ),
    scope: scopeLabel,
  });
}

function formatSpendCapSummary(policy: DashboardGasSponsorshipPolicy): string {
  if (policy.spendCap.mode === 'NONE') return t('gasSpendCapNone');
  const firstCap = policy.spendCap.capsByChain[0];
  if (!firstCap) {
    return t('gasSpendCapModePeriod', {
      mode: describeSpendCapMode(policy.spendCap.mode),
      period: describeSpendCapPeriodInline(policy.spendCap.period),
    });
  }
  if (policy.spendCap.capsByChain.length > 1) {
    return t('gasSpendCapMultiple', {
      count: policy.spendCap.capsByChain.length,
      period: describeSpendCapPeriodInline(policy.spendCap.period),
      mode: describeSpendCapMode(policy.spendCap.mode).toLowerCase(),
    });
  }
  return formatSpendCapCoverageEntry({
    chainId: firstCap.chainId,
    capMinor: firstCap.capMinor,
    mode: policy.spendCap.mode,
    period: policy.spendCap.period,
  });
}

function formatAllowedFunctionSummary(input: {
  functionSignature: string;
  maxGasLimit: string;
  maxValueWei: string;
}): string {
  return t('gasAllowedFunctionSummary', {
    signature: input.functionSignature,
    gas: input.maxGasLimit,
    value: input.maxValueWei,
  });
}

function formatAllowedDelegateActionSummary(
  action: DashboardGasSponsorshipAllowedDelegateAction,
): string {
  const methodsLabel = action.methods.length > 0 ? action.methods.join(', ') : t('gasAnyMethod');
  return t('gasDelegateActionSummary', {
    receiver: action.receiverId,
    methods: methodsLabel,
    deposit: action.maxDepositYocto,
    transfers: action.allowTransfers ? t('gasTransfersAllowed') : t('gasTransfersBlocked'),
  });
}

function formatAllowedRuleSummary(policy: DashboardGasSponsorshipPolicy): string {
  if (policy.kind === 'near_delegate') {
    const actionCount = policy.allowedDelegateActions.length;
    if (actionCount === 0) return t('gasNoDelegateActionAllowed');
    return t(actionCount === 1 ? 'gasDelegateActionCountOne' : 'gasDelegateActionCountOther', {
      count: actionCount,
    });
  }
  const groupedRules = groupAllowedCallsByContract(policy.allowedCalls);
  const contractCount = groupedRules.length;
  const functionCount = groupedRules.reduce((sum, rule) => sum + rule.functions.length, 0);
  if (contractCount === 0 || functionCount === 0) return t('gasNoAllowedCallRule');
  const contractsLabel = t(contractCount === 1 ? 'gasContractCountOne' : 'gasContractCountOther', {
    count: contractCount,
  });
  const functionsLabel = t(functionCount === 1 ? 'gasFunctionCountOne' : 'gasFunctionCountOther', {
    count: functionCount,
  });
  return `${contractsLabel} / ${functionsLabel}`;
}

function formatNetworkClassLabel(
  networkClass: DashboardGasSponsorshipPolicy['networkClass'],
): string {
  if (networkClass === 'MAINNET') return t('gasNetworkMainnet');
  if (networkClass === 'TESTNET') return t('gasNetworkTestnet');
  return t('gasNetworkAny');
}

function formatRuleSummary(policy: DashboardGasSponsorshipPolicy): string {
  if (policy.kind === 'near_delegate') {
    return [
      formatNetworkClassLabel(policy.networkClass),
      (policy.enabled ? t('gasEnabled') : t('gasDisabled')).toLowerCase(),
    ].join(' / ');
  }
  return [
    formatSelectedTargetLabels(resolveSelectedTargetIdsFromPolicy(policy)),
    (policy.enabled ? t('gasEnabled') : t('gasDisabled')).toLowerCase(),
  ].join(' / ');
}

function isGasSponsorshipPolicyEnabled(policy: DashboardGasSponsorshipPolicy): boolean {
  return policy.publicationStatus === 'PUBLISHED' && policy.enabled;
}

function closePolicyView(modal: GasSponsorshipModalKind | null): GasSponsorshipModalKind | null {
  return modal === 'view' ? null : modal;
}

export function GasSponsorshipPage(): React.JSX.Element {
  const { go } = useSiteRouter();
  const session = useDashboardConsoleSession();
  const selectedContext = useDashboardSelectedContext();
  const selectedOrgId = normalizeString(
    selectedContext.organization || session.claims?.orgId || '',
  );
  const selectedProjectId = normalizeString(
    selectedContext.project || session.claims?.projectId || '',
  );
  const selectedEnvironmentId = normalizeString(selectedContext.environment || '');

  const [loading, setLoading] = React.useState<boolean>(true);
  const [errorMessage, setErrorMessage] = React.useState<string>('');
  const [billingOverview, setBillingOverview] = React.useState<DashboardBillingOverview | null>(
    null,
  );
  const [billingOverviewLoading, setBillingOverviewLoading] = React.useState<boolean>(false);
  const [billingOverviewError, setBillingOverviewError] = React.useState<string>('');
  const [sponsoredHistory, setSponsoredHistory] = React.useState<
    DashboardSponsoredExecutionHistoryEntry[]
  >([]);
  const [sponsoredHistoryError, setSponsoredHistoryError] = React.useState('');
  const [reconciliationPage, setReconciliationPage] =
    React.useState<DashboardSponsoredExecutionReconciliationPage | null>(null);
  const [reconciliationError, setReconciliationError] = React.useState('');
  const [mutationError, setMutationError] = React.useState<string>('');
  const [mutating, setMutating] = React.useState<boolean>(false);
  const [activeModal, setActiveModal] = React.useState<GasSponsorshipModalKind | null>(null);
  const [editingPolicyId, setEditingPolicyId] = React.useState<string>('');
  const [selectedPolicyId, setSelectedPolicyId] = React.useState<string>('');
  const [gasPolicies, setGasPolicies] = React.useState<DashboardGasSponsorshipPolicy[]>([]);
  const [modalScope, setModalScope] = React.useState<GasSponsorshipDraftScope | null>(null);
  const [selectedProjectName, setSelectedProjectName] = React.useState<string>('');
  const [selectedEnvironmentKey, setSelectedEnvironmentKey] = React.useState<string>('');
  const [selectedEnvironmentName, setSelectedEnvironmentName] = React.useState<string>('');
  const [, setProjectNamesById] = React.useState<Record<string, string>>({});
  const [, setEnvironmentNamesById] = React.useState<Record<string, string>>({});
  const [modalInitialForm, setModalInitialForm] = React.useState<GasSponsorshipFormState>(() =>
    createInitialFormState(selectedProjectId, selectedEnvironmentId),
  );

  const policyModalOpen = activeModal === 'create' || activeModal === 'edit';
  const selectedEnvironmentNetworkClass = React.useMemo(
    () => gasNetworkClassFromEnvironmentKey(selectedEnvironmentKey),
    [selectedEnvironmentKey],
  );
  const activeChainColumnLabel =
    selectedEnvironmentNetworkClass === 'MAINNET' ? t('gasNetworkMainnet') : t('gasNetworkTestnet');
  const activeTargetGroupIds =
    selectedEnvironmentNetworkClass === 'MAINNET' ? GAS_MAINNET_TARGET_IDS : GAS_TESTNET_TARGET_IDS;
  const activeTargetGroupLabel =
    selectedEnvironmentNetworkClass === 'MAINNET' ? t('gasAllMainnets') : t('gasAllTestnets');

  const draftIdentity = React.useMemo<DashboardDraftIdentity | null>(() => {
    if (!policyModalOpen || !modalScope) return null;
    return {
      route: '/dashboard/gas-sponsorship',
      builderId: 'gas-sponsorship-policy-modal',
      mode: activeModal === 'edit' ? 'edit' : 'create',
      orgId: modalScope.orgId,
      projectId: modalScope.projectId,
      environmentId: modalScope.environmentId,
      resourceId: activeModal === 'edit' ? editingPolicyId : '',
    };
  }, [activeModal, editingPolicyId, modalScope, policyModalOpen]);

  const parseDraftForm = React.useCallback(
    (raw: unknown): GasSponsorshipFormState | null =>
      parseGasSponsorshipFormDraft(raw, modalInitialForm),
    [modalInitialForm],
  );

  const { form, setForm, restoreState, clearDraft, resetToInitial } =
    useSessionDraft<GasSponsorshipFormState>({
      identity: draftIdentity,
      initialForm: modalInitialForm,
      isOpen: policyModalOpen,
      parseForm: parseDraftForm,
    });
  const restoredDraftToastKeyRef = React.useRef<string>('');

  const currentScopeKey = `${selectedOrgId}:${selectedProjectId}:${selectedEnvironmentId}`;
  const previousScopeKeyRef = React.useRef<string>(currentScopeKey);
  React.useEffect(() => {
    if (previousScopeKeyRef.current === currentScopeKey) return;
    previousScopeKeyRef.current = currentScopeKey;
    if (!policyModalOpen) return;
    setEditingPolicyId('');
    setSelectedPolicyId('');
    setActiveModal(null);
    setMutationError('');
  }, [currentScopeKey, policyModalOpen]);

  React.useEffect(() => {
    if (!policyModalOpen || restoreState !== 'restored' || !draftIdentity) return;
    const toastKey = [
      draftIdentity.mode,
      draftIdentity.orgId,
      draftIdentity.projectId,
      draftIdentity.environmentId,
      draftIdentity.resourceId || '',
    ].join(':');
    if (restoredDraftToastKeyRef.current === toastKey) return;
    restoredDraftToastKeyRef.current = toastKey;
    toast(t('gasDraftRestored'), {
      id: `gas-sponsorship-draft:${toastKey}`,
      description: null,
    });
  }, [draftIdentity, policyModalOpen, restoreState]);

  React.useEffect(() => {
    if (policyModalOpen) return;
    restoredDraftToastKeyRef.current = '';
  }, [policyModalOpen]);

  React.useEffect(() => {
    if (!policyModalOpen) return;
    setForm((current) => {
      const nextSelectedTargets = remapSelectedTargetsToNetwork(
        current.selectedTargets,
        selectedEnvironmentNetworkClass,
      );
      if (
        nextSelectedTargets.length === current.selectedTargets.length &&
        nextSelectedTargets.every((targetId, index) => current.selectedTargets[index] === targetId)
      ) {
        return current;
      }
      return {
        ...current,
        selectedTargets: nextSelectedTargets,
      };
    });
  }, [policyModalOpen, selectedEnvironmentNetworkClass, setForm]);

  React.useEffect(() => {
    if (!policyModalOpen) return;
    setForm((current) => {
      const selectedChainNames = new Set(
        current.ruleKind === 'near_delegate'
          ? [
              getNearSpendCapTargetForNetwork(selectedEnvironmentNetworkClass)?.chainName || '',
            ].filter(Boolean)
          : uniqueGasTargetIds(current.selectedTargets)
              .map((targetId) => GAS_CHAIN_TARGETS_BY_ID.get(targetId)?.chainName || '')
              .filter(Boolean),
      );
      const nextSpendCapAmountByChainName = Object.fromEntries(
        Object.entries(current.spendCapAmountByChainName).filter(([chainName]) =>
          selectedChainNames.has(chainName),
        ),
      );
      if (
        Object.keys(nextSpendCapAmountByChainName).length ===
          Object.keys(current.spendCapAmountByChainName).length &&
        Object.entries(nextSpendCapAmountByChainName).every(
          ([chainName, value]) => current.spendCapAmountByChainName[chainName] === value,
        )
      ) {
        return current;
      }
      return {
        ...current,
        spendCapAmountByChainName: nextSpendCapAmountByChainName,
      };
    });
  }, [policyModalOpen, selectedEnvironmentNetworkClass, setForm]);

  const canMutatePolicy = React.useMemo(
    () => canDashboardEditProject(session.claims, selectedProjectId),
    [selectedProjectId, session.claims],
  );

  const selectedPolicy = React.useMemo(
    () => gasPolicies.find((policy) => policy.id === selectedPolicyId) || null,
    [gasPolicies, selectedPolicyId],
  );
  const gasPoliciesPagination = useDashboardTablePagination(gasPolicies, {
    disabled: session.loading || loading,
    itemLabel: t('gasPolicyItem'),
    itemLabelPlural: t('gasPolicyItemPlural'),
  });

  React.useEffect(() => {
    if (!session.claims) {
      setSelectedProjectName('');
      setSelectedEnvironmentKey('');
      setSelectedEnvironmentName('');
      setProjectNamesById({});
      setEnvironmentNamesById({});
      return;
    }
    let cancelled = false;
    Promise.all([
      listDashboardProjects({ status: 'ACTIVE' }),
      selectedProjectId
        ? listDashboardEnvironments({ projectId: selectedProjectId })
        : Promise.resolve([]),
    ])
      .then(([projects, environments]) => {
        if (cancelled) return;
        const selectedProject = projects.find((entry) => entry.id === selectedProjectId) || null;
        const selectedEnvironment =
          environments.find((entry) => entry.id === selectedEnvironmentId) || null;
        setProjectNamesById(
          Object.fromEntries(projects.map((entry) => [entry.id, String(entry.name || '')])),
        );
        setEnvironmentNamesById(
          Object.fromEntries(environments.map((entry) => [entry.id, String(entry.name || '')])),
        );
        setSelectedProjectName(String(selectedProject?.name || ''));
        setSelectedEnvironmentKey(String(selectedEnvironment?.key || ''));
        setSelectedEnvironmentName(String(selectedEnvironment?.name || ''));
      })
      .catch(() => {
        if (cancelled) return;
        setSelectedProjectName('');
        setSelectedEnvironmentKey('');
        setSelectedEnvironmentName('');
        setProjectNamesById({});
        setEnvironmentNamesById({});
      });
    return () => {
      cancelled = true;
    };
  }, [selectedEnvironmentId, selectedProjectId, session.claims]);

  const loadBillingOverview = React.useCallback(() => {
    if (!session.claims) {
      setBillingOverview(null);
      setBillingOverviewError(session.errorMessage || t('gasSessionUnavailable'));
      setBillingOverviewLoading(false);
      setSponsoredHistory([]);
      setReconciliationPage(null);
      return;
    }
    let cancelled = false;
    setBillingOverviewLoading(true);
    setBillingOverviewError('');
    setSponsoredHistoryError('');
    setReconciliationError('');
    Promise.allSettled([
      getDashboardBillingOverview(),
      listDashboardSponsoredExecutionHistory({
        environmentId: selectedEnvironmentId,
        limit: 12,
        lookbackDays: 90,
      }),
      listDashboardSponsoredExecutionReconciliation({
        environmentId: selectedEnvironmentId,
        limit: 12,
        lookbackDays: 90,
      }),
    ])
      .then(([overviewResult, historyResult, reconciliationResult]) => {
        if (cancelled) return;
        if (overviewResult.status === 'fulfilled') {
          setBillingOverview(overviewResult.value);
        } else {
          setBillingOverview(null);
          setBillingOverviewError(
            overviewResult.reason instanceof Error
              ? overviewResult.reason.message
              : String(overviewResult.reason),
          );
        }
        if (historyResult.status === 'fulfilled') {
          setSponsoredHistory(historyResult.value.items);
        } else {
          setSponsoredHistory([]);
          setSponsoredHistoryError(
            historyResult.reason instanceof Error
              ? historyResult.reason.message
              : String(historyResult.reason),
          );
        }
        if (reconciliationResult.status === 'fulfilled') {
          setReconciliationPage(reconciliationResult.value);
        } else {
          setReconciliationPage(null);
          setReconciliationError(
            reconciliationResult.reason instanceof Error
              ? reconciliationResult.reason.message
              : String(reconciliationResult.reason),
          );
        }
      })
      .finally(() => {
        if (cancelled) return;
        setBillingOverviewLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedEnvironmentId, session.claims, session.errorMessage]);

  // Awaitable so mutation handlers can `await loadGasPolicies()` and have the
  // list reflect the change before they finish; a monotonic request id ensures
  // only the newest refresh applies (rapid env switches / back-to-back saves).
  const loadRequestRef = React.useRef(0);
  const loadGasPolicies = React.useCallback(async (): Promise<void> => {
    if (!session.claims) {
      setLoading(false);
      setErrorMessage(session.errorMessage || t('gasSessionUnavailable'));
      setGasPolicies([]);
      return;
    }
    const requestId = loadRequestRef.current + 1;
    loadRequestRef.current = requestId;
    const query = {
      ...(selectedProjectId ? { projectId: selectedProjectId } : {}),
      ...(selectedEnvironmentId ? { environmentId: selectedEnvironmentId } : {}),
    };
    setLoading(true);
    setErrorMessage('');
    try {
      const rows = await listDashboardGasSponsorshipPolicies(query);
      if (loadRequestRef.current !== requestId) return;
      setGasPolicies([...rows].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)));
    } catch (error: unknown) {
      if (loadRequestRef.current !== requestId) return;
      setGasPolicies([]);
      setErrorMessage(error instanceof Error ? error.message : String(error));
    } finally {
      if (loadRequestRef.current === requestId) setLoading(false);
    }
  }, [selectedEnvironmentId, selectedProjectId, session.claims, session.errorMessage]);

  React.useEffect(() => {
    if (session.loading) {
      setLoading(true);
      return;
    }
    void loadGasPolicies();
  }, [loadGasPolicies, session.loading]);

  React.useEffect(() => {
    if (session.loading) {
      setBillingOverviewLoading(true);
      return;
    }
    const cleanup = loadBillingOverview();
    return cleanup;
  }, [loadBillingOverview, session.loading]);

  const onResetForm = React.useCallback(() => {
    setEditingPolicyId('');
    setSelectedPolicyId('');
    setModalScope(null);
    setActiveModal(null);
    setMutationError('');
    setModalInitialForm(createInitialFormState(selectedProjectId, selectedEnvironmentId));
    if (new URLSearchParams(window.location.search).has('policyId')) {
      go('/dashboard/gas-sponsorship');
    }
  }, [go, selectedEnvironmentId, selectedProjectId]);

  const openPolicyFromRoute = React.useCallback(() => {
    if (window.location.pathname !== '/dashboard/gas-sponsorship') return;
    const policyId = new URLSearchParams(window.location.search).get('policyId')?.trim();
    if (!policyId) {
      setActiveModal(closePolicyView);
      return;
    }
    setEditingPolicyId('');
    setSelectedPolicyId(policyId);
    setModalScope(null);
    setActiveModal('view');
    setMutationError('');
  }, []);

  React.useEffect(() => {
    openPolicyFromRoute();
    window.addEventListener('popstate', openPolicyFromRoute);
    window.addEventListener('site:navigate', openPolicyFromRoute);
    return () => {
      window.removeEventListener('popstate', openPolicyFromRoute);
      window.removeEventListener('site:navigate', openPolicyFromRoute);
    };
  }, [openPolicyFromRoute]);

  const openCreateModal = React.useCallback(() => {
    setEditingPolicyId('');
    setSelectedPolicyId('');
    setModalScope({
      orgId: selectedOrgId,
      projectId: selectedProjectId,
      environmentId: selectedEnvironmentId,
    });
    setModalInitialForm(createInitialFormState(selectedProjectId, selectedEnvironmentId));
    setActiveModal('create');
    setMutationError('');
  }, [selectedEnvironmentId, selectedOrgId, selectedProjectId]);

  /* Opened from the rail's "+", including while this route is already on
     screen. */
  useDashboardCreateIntent('/dashboard/gas-sponsorship', canMutatePolicy, openCreateModal);

  const onEditPolicy = React.useCallback(
    (policy: DashboardGasSponsorshipPolicy) => {
      setEditingPolicyId(policy.id);
      setSelectedPolicyId(policy.id);
      setModalScope({
        orgId: selectedOrgId,
        projectId: selectedProjectId,
        environmentId: selectedEnvironmentId,
      });
      setModalInitialForm(
        buildFormStateFromPolicy(policy, selectedProjectId, selectedEnvironmentId),
      );
      setActiveModal('edit');
      setMutationError('');
    },
    [selectedEnvironmentId, selectedOrgId, selectedProjectId],
  );

  const onViewPolicy = React.useCallback((policy: DashboardGasSponsorshipPolicy) => {
    setEditingPolicyId('');
    setSelectedPolicyId(policy.id);
    setModalScope(null);
    setActiveModal('view');
    setMutationError('');
  }, []);

  const onSetTargetEnabled = React.useCallback(
    (targetId: string, enabled: boolean) => {
      setForm((current) => {
        const target = GAS_CHAIN_TARGETS_BY_ID.get(targetId);
        if (!target) return current;
        const hasTarget = current.selectedTargets.includes(targetId);
        if (enabled && hasTarget) return current;
        if (!enabled && !hasTarget) return current;
        const nextSpendCapAmountByChainName = { ...current.spendCapAmountByChainName };
        if (!enabled) {
          delete nextSpendCapAmountByChainName[target.chainName];
        }
        return {
          ...current,
          selectedTargets: enabled
            ? uniqueGasTargetIds([...current.selectedTargets, targetId])
            : current.selectedTargets.filter((entry) => entry !== targetId),
          spendCapAmountByChainName: nextSpendCapAmountByChainName,
        };
      });
    },
    [setForm],
  );

  const onToggleTargetGroup = React.useCallback(
    (networkClass: GasNetworkToggleClass) => {
      const groupTargetIds =
        networkClass === 'MAINNET' ? GAS_MAINNET_TARGET_IDS : GAS_TESTNET_TARGET_IDS;
      setForm((current) => {
        const hasEntireGroup = groupTargetIds.every((targetId) =>
          current.selectedTargets.includes(targetId),
        );
        const nextSpendCapAmountByChainName = { ...current.spendCapAmountByChainName };
        if (hasEntireGroup) {
          groupTargetIds.forEach((targetId) => {
            const target = GAS_CHAIN_TARGETS_BY_ID.get(targetId);
            if (!target) return;
            delete nextSpendCapAmountByChainName[target.chainName];
          });
        }
        const nextSelectedTargets = hasEntireGroup
          ? current.selectedTargets.filter((targetId) => !groupTargetIds.includes(targetId))
          : uniqueGasTargetIds([...current.selectedTargets, ...groupTargetIds]);
        return {
          ...current,
          selectedTargets: nextSelectedTargets,
          spendCapAmountByChainName: nextSpendCapAmountByChainName,
        };
      });
    },
    [setForm],
  );

  const addContractCallRule = React.useCallback(() => {
    setForm((current) => ({
      ...current,
      contractCallRules: [...current.contractCallRules, createEmptyGasContractRuleDraft()],
    }));
  }, [setForm]);

  const removeContractCallRule = React.useCallback(
    (ruleId: string) => {
      setForm((current) => ({
        ...current,
        contractCallRules: current.contractCallRules.filter((entry) => entry.id !== ruleId),
      }));
    },
    [setForm],
  );

  const updateContractCallRuleAddress = React.useCallback(
    (ruleId: string, contractAddress: string) => {
      setForm((current) => ({
        ...current,
        contractCallRules: current.contractCallRules.map((entry) =>
          entry.id === ruleId ? { ...entry, contractAddress } : entry,
        ),
      }));
    },
    [setForm],
  );

  const addContractFunction = React.useCallback(
    (ruleId: string) => {
      setForm((current) => ({
        ...current,
        contractCallRules: current.contractCallRules.map((entry) =>
          entry.id === ruleId
            ? {
                ...entry,
                functions: [...entry.functions, createEmptyGasContractFunctionDraft()],
              }
            : entry,
        ),
      }));
    },
    [setForm],
  );

  const removeContractFunction = React.useCallback(
    (ruleId: string, functionId: string) => {
      setForm((current) => ({
        ...current,
        contractCallRules: current.contractCallRules.map((entry) => {
          if (entry.id !== ruleId) return entry;
          const nextFunctions = entry.functions.filter(
            (functionEntry) => functionEntry.id !== functionId,
          );
          return {
            ...entry,
            functions:
              nextFunctions.length > 0 ? nextFunctions : [createEmptyGasContractFunctionDraft()],
          };
        }),
      }));
    },
    [setForm],
  );

  const updateContractFunction = React.useCallback(
    (ruleId: string, functionId: string, patch: Partial<Omit<GasContractFunctionDraft, 'id'>>) => {
      setForm((current) => ({
        ...current,
        contractCallRules: current.contractCallRules.map((entry) =>
          entry.id === ruleId
            ? {
                ...entry,
                functions: entry.functions.map((functionEntry) =>
                  functionEntry.id === functionId
                    ? {
                        ...functionEntry,
                        ...patch,
                      }
                    : functionEntry,
                ),
              }
            : entry,
        ),
      }));
    },
    [setForm],
  );

  const addDelegateActionRule = React.useCallback(() => {
    setForm((current) => ({
      ...current,
      delegateActionRules: [...current.delegateActionRules, createEmptyNearDelegateActionDraft()],
    }));
  }, [setForm]);

  const removeDelegateActionRule = React.useCallback(
    (ruleId: string) => {
      setForm((current) => ({
        ...current,
        delegateActionRules: current.delegateActionRules.filter((entry) => entry.id !== ruleId),
      }));
    },
    [setForm],
  );

  const updateDelegateActionRule = React.useCallback(
    (ruleId: string, patch: Partial<Omit<GasNearDelegateActionDraft, 'id'>>) => {
      setForm((current) => ({
        ...current,
        delegateActionRules: current.delegateActionRules.map((entry) =>
          entry.id === ruleId
            ? {
                ...entry,
                ...patch,
              }
            : entry,
        ),
      }));
    },
    [setForm],
  );

  const selectedTargetIds = React.useMemo(
    () => uniqueGasTargetIds(form.selectedTargets),
    [form.selectedTargets],
  );
  const allActiveTargetsSelected = React.useMemo(
    () =>
      activeTargetGroupIds.length > 0 &&
      activeTargetGroupIds.every((targetId) => selectedTargetIds.includes(targetId)),
    [activeTargetGroupIds, selectedTargetIds],
  );

  const onSubmit = React.useCallback(
    async (event: React.FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      if (!session.claims) {
        setMutationError(session.errorMessage || t('gasSessionUnavailable'));
        return;
      }
      if (!canMutatePolicy) {
        setMutationError(t('gasAccessRequired'));
        return;
      }
      setMutating(true);
      setMutationError('');
      try {
        const request = buildGasSponsorshipRequest(form, selectedEnvironmentNetworkClass);
        if (editingPolicyId) {
          await updateDashboardGasSponsorshipPolicy(editingPolicyId, request);
          toast.success(t('gasPolicyUpdated'));
        } else {
          await createDashboardGasSponsorshipPolicy(request);
          toast.success(t('gasPolicyCreated'));
        }
        await loadGasPolicies();
        clearDraft();
        onResetForm();
      } catch (error: unknown) {
        setMutationError(error instanceof Error ? error.message : String(error));
      } finally {
        setMutating(false);
      }
    },
    [
      canMutatePolicy,
      editingPolicyId,
      form,
      clearDraft,
      loadGasPolicies,
      onResetForm,
      selectedEnvironmentNetworkClass,
      session.claims,
      session.errorMessage,
    ],
  );

  const formDiffersFromInitial = React.useMemo(
    () => !areGasSponsorshipFormsEqual(form, modalInitialForm),
    [form, modalInitialForm],
  );

  // Reuse the exact submit-time builder so the inline hint matches what a submit
  // would reject. Returns the first missing/invalid-field message, or null when
  // the form is complete.
  const formValidationError = React.useMemo<string | null>(() => {
    try {
      buildGasSponsorshipRequest(form, selectedEnvironmentNetworkClass);
      return null;
    } catch (error: unknown) {
      return error instanceof Error ? error.message : String(error);
    }
  }, [form, selectedEnvironmentNetworkClass]);

  const onDiscardDraft = React.useCallback(() => {
    if (formDiffersFromInitial && typeof window !== 'undefined') {
      const confirmed = window.confirm(t('gasConfirmDiscardDraft'));
      if (!confirmed) return;
    }
    resetToInitial();
    onResetForm();
  }, [formDiffersFromInitial, onResetForm, resetToInitial]);

  const onToggleEnabled = React.useCallback(
    async (policy: DashboardGasSponsorshipPolicy) => {
      if (!session.claims) {
        setMutationError(session.errorMessage || t('gasSessionUnavailable'));
        return;
      }
      if (!canMutatePolicy) {
        setMutationError(t('gasAccessRequired'));
        return;
      }
      setMutating(true);
      setMutationError('');
      try {
        const enabled = !isGasSponsorshipPolicyEnabled(policy);
        await setDashboardGasSponsorshipPolicyEnabled(policy.id, enabled);
        await loadGasPolicies();
        toast.success(
          t(enabled ? 'gasToastEnabled' : 'gasToastDisabled', { name: policy.name || policy.id }),
        );
      } catch (error: unknown) {
        setMutationError(error instanceof Error ? error.message : String(error));
      } finally {
        setMutating(false);
      }
    },
    [canMutatePolicy, loadGasPolicies, session.claims, session.errorMessage],
  );

  const onDeletePolicy = React.useCallback(
    async (policy: DashboardGasSponsorshipPolicy) => {
      if (!session.claims) {
        setMutationError(session.errorMessage || t('gasSessionUnavailable'));
        return;
      }
      if (!canMutatePolicy) {
        setMutationError(t('gasAccessRequired'));
        return;
      }
      if (typeof window !== 'undefined') {
        const confirmed = window.confirm(
          t('gasConfirmDeletePolicy', { name: policy.name || policy.id }),
        );
        if (!confirmed) return;
      }
      setMutating(true);
      setMutationError('');
      try {
        await deleteDashboardGasSponsorshipPolicy(policy.id);
        await loadGasPolicies();
        toast.success(t('gasToastDeleted', { name: policy.name || policy.id }));
      } catch (error: unknown) {
        setMutationError(error instanceof Error ? error.message : String(error));
      } finally {
        setMutating(false);
      }
    },
    [canMutatePolicy, loadGasPolicies, session.claims, session.errorMessage],
  );

  const gasBalanceMetrics = React.useMemo<BillingMetric[]>(() => {
    if (!billingOverview) return [];
    return [
      {
        label: t('gasBalanceOrgPrepaid'),
        value: formatUsdMinor(billingOverview.creditBalanceMinor),
        hint:
          billingOverview.creditBalanceMinor <= 0
            ? t('gasBalanceBlockedHint')
            : billingOverview.creditBalanceMinor <= billingOverview.lowBalanceThresholdMinor
              ? t('gasBalanceWarningHint', {
                  amount: formatUsdMinor(billingOverview.lowBalanceThresholdMinor),
                })
              : t('gasBalanceHealthyHint'),
      },
      {
        label: t('gasBalanceReserved'),
        value: formatUsdMinor(billingOverview.reservedMinor),
        hint: t(
          billingOverview.activeReservationCount === 1
            ? 'gasReservationsOne'
            : 'gasReservationsOther',
          { count: billingOverview.activeReservationCount },
        ),
      },
      {
        label: t('gasBalanceSpend30'),
        value: formatUsdMinor(billingOverview.trailing30DaySponsoredSpendMinor),
        hint: t(
          billingOverview.trailing30DaySponsoredExecutionCount === 1
            ? 'gasRecentExecutionsOne'
            : 'gasRecentExecutionsOther',
          { count: billingOverview.trailing30DaySponsoredExecutionCount },
        ),
      },
      {
        label: t('gasBalanceSpend90'),
        value: formatUsdMinor(billingOverview.trailing90DaySponsoredSpendMinor),
        hint: t(
          billingOverview.trailing90DaySponsoredExecutionCount === 1
            ? 'gasLookbackExecutionsOne'
            : 'gasLookbackExecutionsOther',
          { count: billingOverview.trailing90DaySponsoredExecutionCount },
        ),
      },
    ];
  }, [billingOverview]);

  const gasBalanceNotice = React.useMemo(() => {
    if (!billingOverview) return null;
    if (billingOverview.creditBalanceMinor <= 0) {
      return {
        tone: 'warning' as const,
        message: t('gasNoticeDepleted'),
      };
    }
    if (billingOverview.creditBalanceMinor <= billingOverview.lowBalanceThresholdMinor) {
      return {
        tone: 'info' as const,
        message: t('gasNoticeLow', {
          threshold: formatUsdMinor(billingOverview.lowBalanceThresholdMinor),
        }),
      };
    }
    /* Healthy state: no banner. The section intro already explains that policy
       caps and prepaid balance are independent — repeating it in a banner was
       pure duplication. */
    return null;
  }, [billingOverview]);

  return (
    <div className="dashboard-view dashboard-gas-sponsorship-view" aria-label={t('gasPageLabel')}>
      {mutationError ? (
        <section className="dashboard-view__section" aria-label={t('gasErrorLabel')}>
          <p className="dashboard-pagination-note" role="alert">
            {mutationError}
          </p>
        </section>
      ) : null}

      {session.loading || loading ? (
        <section className="dashboard-view__section">
          <p>{t('gasLoadingPolicies')}</p>
        </section>
      ) : !session.claims ? (
        <section className="dashboard-view__section">
          <p>
            {t('gasDataUnavailableSession', {
              reason: session.errorMessage || t('gasUnauthorized'),
            })}
          </p>
        </section>
      ) : errorMessage ? (
        <section className="dashboard-view__section">
          <p>{t('gasDataUnavailable', { reason: errorMessage })}</p>
        </section>
      ) : (
        <>
          <section
            className="dashboard-view__section dashboard-gas-sponsorship-view__readiness"
            aria-label={t('gasReadinessLabel')}
          >
            <h2>{t('gasReadinessTitle')}</h2>
            <p>{t('gasReadinessIntro')}</p>
            {billingOverviewLoading ? (
              <p>{t('gasLoadingBalance')}</p>
            ) : billingOverviewError ? (
              <p className="dashboard-pagination-note">
                {t('gasBalanceUnavailable', { reason: billingOverviewError })}
              </p>
            ) : billingOverview ? (
              <>
                {gasBalanceNotice ? (
                  gasBalanceNotice.tone === 'warning' ? (
                    <div className="dashboard-warning-banner" role="alert">
                      <p>{gasBalanceNotice.message}</p>
                      <button
                        type="button"
                        className="dashboard-warning-banner__dismiss"
                        onClick={() => go('/dashboard/billing/account')}
                      >
                        {t('gasTopUp')}
                      </button>
                    </div>
                  ) : (
                    <div className="dashboard-gas-sponsorship-info-banner">
                      <p>{gasBalanceNotice.message}</p>
                      <button
                        type="button"
                        className="dashboard-pagination-button"
                        onClick={() => go('/dashboard/billing/account')}
                      >
                        {t('gasOpenBilling')}
                      </button>
                    </div>
                  )
                ) : null}
                <BillingMetricsGrid
                  metrics={gasBalanceMetrics}
                  ariaLabel={t('gasReadinessMetricsLabel')}
                />
              </>
            ) : null}
          </section>

          <section
            className="dashboard-view__section dashboard-view__section--plain dashboard-gas-sponsorship-view__policies"
            aria-label={t('gasPoliciesLabel')}
          >
            <h2>{t('gasPolicies')}</h2>
            <DashboardPageActions>
              <button
                type="button"
                className="dashboard-pagination-button dashboard-pagination-button--primary"
                onClick={openCreateModal}
                disabled={!canMutatePolicy || mutating}
              >
                {t('gasCreatePolicy')}
              </button>
            </DashboardPageActions>
            <DashboardTable
              ariaLabel={t('gasRowsLabel')}
              className="dashboard-gas-sponsorship-table"
              columns={GAS_SPONSORSHIP_TABLE_COLUMNS}
              pagination={gasPoliciesPagination.pagination}
            >
              <DashboardTableHeader className="dashboard-gas-sponsorship-table__header">
                <DashboardTableHeaderCell>{t('gasPolicy')}</DashboardTableHeaderCell>
                <DashboardTableHeaderCell>{t('gasBehavior')}</DashboardTableHeaderCell>
                <DashboardTableHeaderCell>{t('gasSpendCap')}</DashboardTableHeaderCell>
                <DashboardTableHeaderCell>{t('gasUpdated')}</DashboardTableHeaderCell>
                <DashboardTableHeaderCell>{t('gasActions')}</DashboardTableHeaderCell>
              </DashboardTableHeader>
              {gasPolicies.length === 0 ? (
                <DashboardTableState>{t('gasNoPolicies')}</DashboardTableState>
              ) : (
                gasPoliciesPagination.rows.map((policy) => {
                  const enabled = isGasSponsorshipPolicyEnabled(policy);
                  return (
                    <DashboardTableRow
                      className={`dashboard-gas-sponsorship-table__row${
                        enabled ? '' : ' dashboard-gas-sponsorship-table__row--disabled'
                      }`}
                      key={policy.id}
                    >
                      <DashboardTableCell
                        title={`${policy.name || policy.id} · ${formatAllowedRuleSummary(policy)}`}
                        className="dashboard-data-table__cell--lead"
                      >
                        <div className="dashboard-lead">
                          <span className="dashboard-lead__icon" aria-hidden="true">
                            <FuelIcon size={16} />
                          </span>
                          <span className="dashboard-lead__copy">
                            <span className="dashboard-lead__title">
                              <span className="dashboard-data-table__summary">
                                {policy.name || policy.id}
                              </span>
                              <span
                                className={`dashboard-data-table__badge ${
                                  enabled
                                    ? 'dashboard-data-table__badge--success'
                                    : 'dashboard-data-table__badge--neutral'
                                }`}
                              >
                                {enabled ? t('gasEnabled') : t('gasDisabled')}
                              </span>
                            </span>
                            <span className="dashboard-lead__sub">
                              {formatAllowedRuleSummary(policy)}
                            </span>
                          </span>
                        </div>
                      </DashboardTableCell>
                      <DashboardTableCell
                        title={formatRuleSummary(policy)}
                        className="dashboard-data-table__cell--nowrap"
                      >
                        {formatRuleSummary(policy)}
                      </DashboardTableCell>
                      <DashboardTableCell
                        title={formatSpendCapSummary(policy)}
                        className="dashboard-data-table__cell--nowrap"
                      >
                        {formatSpendCapSummary(policy)}
                      </DashboardTableCell>
                      <DashboardTableCell truncate>
                        {formatTimestamp(policy.updatedAt)}
                      </DashboardTableCell>
                      <DashboardTableCell className="dashboard-gas-sponsorship-table__actions-cell">
                        <DashboardTableActionGroup>
                          <DashboardTableActionButton
                            onClick={() => onViewPolicy(policy)}
                            disabled={mutating}
                          >
                            {t('gasView')}
                          </DashboardTableActionButton>
                          <DashboardTableActionMenu
                            ariaLabel={t('gasMoreActionsFor', { name: policy.name || policy.id })}
                            items={[
                              {
                                label: t('gasEdit'),
                                onSelect: () => onEditPolicy(policy),
                                disabled: mutating,
                              },
                              {
                                label: enabled ? t('gasDisable') : t('gasEnable'),
                                onSelect: () => onToggleEnabled(policy),
                                disabled: !canMutatePolicy || mutating,
                              },
                              {
                                label: t('gasDelete'),
                                onSelect: () => onDeletePolicy(policy),
                                tone: 'danger' as const,
                                disabled: !canMutatePolicy || mutating,
                              },
                            ]}
                          />
                        </DashboardTableActionGroup>
                      </DashboardTableCell>
                    </DashboardTableRow>
                  );
                })
              )}
            </DashboardTable>
          </section>
          <section
            id="sponsored-history"
            className="dashboard-view__section dashboard-view__section--plain"
          >
            <SponsoredExecutionHistorySection
              entries={sponsoredHistory}
              loading={billingOverviewLoading}
              error={sponsoredHistoryError}
              scopeDescription={t('gasHistoryScope', { environmentId: selectedEnvironmentId })}
            />
          </section>
          <SponsoredExecutionReconciliationSection
            sectionId="sponsored-reconciliation"
            page={reconciliationPage}
            loading={billingOverviewLoading}
            error={reconciliationError}
          />
        </>
      )}
      {activeModal ? (
        <DashboardInlineModal
          isOpen
          onRequestClose={onResetForm}
          className="dashboard-modal--wide"
          ariaLabel={
            activeModal === 'create'
              ? t('gasModalCreateLabel')
              : activeModal === 'edit'
                ? t('gasModalEditLabel')
                : t('gasModalViewLabel')
          }
        >
          {activeModal === 'view' ? (
            <>
              <h2>{t('gasCoverage')}</h2>
              <p className="dashboard-pagination-note dashboard-gas-coverage__subtitle">
                {selectedPolicy?.name || selectedPolicy?.id || t('gasSelectedPolicyFallback')}
              </p>
              {selectedPolicy ? (
                <>
                  <div className="dashboard-gas-coverage__stats">
                    <div className="dashboard-gas-coverage__stat">
                      <span>{t('gasEnvironment')}</span>
                      <strong className="dashboard-gas-coverage__scope-value">
                        <span>
                          {t('gasScopeProject', {
                            name: describeCoverageProjectLabel({
                              projectName: selectedProjectName,
                              projectId: selectedPolicy.projectId,
                            }),
                          })}
                        </span>
                        <span>
                          {t('gasScopeEnvironment', {
                            name: describeCoverageEnvironmentLabel({
                              environmentName: selectedEnvironmentName,
                              environmentKey: selectedEnvironmentKey,
                              environmentId: selectedPolicy.environmentId,
                            }),
                          })}
                        </span>
                      </strong>
                    </div>
                    <div className="dashboard-gas-coverage__stat">
                      <span>{t('gasStatus')}</span>
                      <strong>
                        {isGasSponsorshipPolicyEnabled(selectedPolicy)
                          ? t('gasEnabled')
                          : t('gasDisabled')}
                      </strong>
                    </div>
                    <div className="dashboard-gas-coverage__stat">
                      <span>
                        {selectedPolicy.kind === 'near_delegate'
                          ? t('gasDelegateActions')
                          : t('gasRules')}
                      </span>
                      <strong>{formatAllowedRuleSummary(selectedPolicy)}</strong>
                    </div>
                    <div className="dashboard-gas-coverage__stat">
                      <span>{t('gasExecutionMode')}</span>
                      <strong>{selectedPolicy.executionMode}</strong>
                    </div>
                    <div className="dashboard-gas-coverage__stat">
                      <span>{t('gasSpendCap')}</span>
                      <strong>{describeSpendCapMode(selectedPolicy.spendCap.mode)}</strong>
                    </div>
                  </div>
                  <section className="dashboard-gas-coverage__section">
                    <div className="dashboard-gas-coverage__section-header">
                      <span>{t('gasPolicyBehavior')}</span>
                    </div>
                    <p className="dashboard-pagination-note">{formatRuleSummary(selectedPolicy)}</p>
                  </section>
                  <section className="dashboard-gas-coverage__section">
                    <div className="dashboard-gas-coverage__section-header">
                      <span>
                        {selectedPolicy.kind === 'near_delegate'
                          ? t('gasDelegateActions')
                          : t('gasContractCalls')}
                      </span>
                    </div>
                    {selectedPolicy.kind === 'near_delegate' ? (
                      selectedPolicy.allowedDelegateActions.length > 0 ? (
                        <div className="dashboard-gas-coverage__function-list">
                          {selectedPolicy.allowedDelegateActions.map((action) => (
                            <span
                              className="dashboard-gas-coverage__function-chip"
                              key={[
                                action.receiverId,
                                action.maxDepositYocto,
                                action.allowTransfers ? '1' : '0',
                                action.methods.join(','),
                              ].join(':')}
                            >
                              {formatAllowedDelegateActionSummary(action)}
                            </span>
                          ))}
                        </div>
                      ) : (
                        <p className="dashboard-pagination-note dashboard-gas-coverage__empty">
                          {t('gasNoDelegateRules')}
                        </p>
                      )
                    ) : selectedPolicy.allowedCalls.length > 0 ? (
                      <div className="dashboard-gas-coverage__contracts">
                        {groupAllowedCallsByContract(selectedPolicy.allowedCalls).map((rule) => (
                          <div key={rule.id} className="dashboard-gas-coverage__contract">
                            <div className="dashboard-gas-coverage__contract-header">
                              <strong>{rule.contractAddress}</strong>
                            </div>
                            <div className="dashboard-gas-coverage__function-list">
                              {rule.functions.map((functionEntry) => (
                                <span
                                  className="dashboard-gas-coverage__function-chip"
                                  key={functionEntry.id}
                                >
                                  {formatAllowedFunctionSummary(functionEntry)}
                                </span>
                              ))}
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="dashboard-pagination-note dashboard-gas-coverage__empty">
                        {t('gasNoAllowedCallRules')}
                      </p>
                    )}
                  </section>
                  <section className="dashboard-gas-coverage__section dashboard-gas-coverage__section--spend-caps">
                    <div className="dashboard-gas-coverage__section-header">
                      <span>{t('gasSpendCaps')}</span>
                    </div>
                    {selectedPolicy.spendCap.capsByChain.length > 0 ? (
                      <div className="dashboard-gas-coverage__function-list">
                        {selectedPolicy.spendCap.capsByChain.map((cap) => (
                          <span
                            className="dashboard-gas-coverage__function-chip"
                            key={`${cap.chainId}:${selectedPolicy.spendCap.period}`}
                          >
                            {formatSpendCapCoverageEntry({
                              chainId: cap.chainId,
                              capMinor: cap.capMinor,
                              mode: selectedPolicy.spendCap.mode,
                              period: selectedPolicy.spendCap.period,
                            })}
                          </span>
                        ))}
                      </div>
                    ) : (
                      <p className="dashboard-pagination-note dashboard-gas-coverage__empty">
                        {selectedPolicy.spendCap.mode === 'NONE'
                          ? t('gasNoSpendCapConfigured')
                          : t('gasNoPerChainCaps')}
                      </p>
                    )}
                  </section>
                </>
              ) : (
                <p className="dashboard-pagination-note">
                  {loading ? t('gasLoadingPolicy') : errorMessage || t('gasPolicyUnavailable')}
                </p>
              )}
              <div className="dashboard-form-actions">
                <button type="button" className="dashboard-pagination-button" onClick={onResetForm}>
                  {t('gasClose')}
                </button>
              </div>
            </>
          ) : (
            <>
              <h2>{activeModal === 'create' ? t('gasCreatePolicy') : t('gasEditPolicyTitle')}</h2>
              <p className="dashboard-pagination-note">{t('gasFormIntro')}</p>
              {mutationError ? <p className="dashboard-pagination-note">{mutationError}</p> : null}
              <form className="dashboard-view-grid dashboard-view-grid--two" onSubmit={onSubmit}>
                <section className="dashboard-policy-rule-panel dashboard-form-field dashboard-form-field--full">
                  <div className="dashboard-policy-rule-panel__header">
                    <span>{t('gasPolicy')}</span>
                  </div>
                  <div className="dashboard-view-grid dashboard-view-grid--two">
                    <label className="dashboard-form-field">
                      <span>{t('gasPolicyName')}</span>
                      <input
                        className="dashboard-input"
                        value={form.name}
                        onChange={(event) =>
                          setForm((current) => ({ ...current, name: event.target.value }))
                        }
                        placeholder={t('gasPolicyNamePlaceholder')}
                        disabled={mutating}
                      />
                    </label>
                    <div className="dashboard-form-field">
                      <span>{t('gasRuleKind')}</span>
                      <div className="dashboard-policy-contract-call-mode">
                        <button
                          type="button"
                          aria-pressed={form.ruleKind === 'evm_call'}
                          className={[
                            'dashboard-policy-segment',
                            form.ruleKind === 'evm_call' ? 'dashboard-policy-segment--active' : '',
                          ]
                            .filter(Boolean)
                            .join(' ')}
                          onClick={() =>
                            setForm((current) => ({
                              ...current,
                              ruleKind: 'evm_call',
                            }))
                          }
                          disabled={mutating}
                        >
                          {t('gasRuleKindEvm')}
                        </button>
                        <button
                          type="button"
                          aria-pressed={form.ruleKind === 'near_delegate'}
                          className={[
                            'dashboard-policy-segment',
                            form.ruleKind === 'near_delegate'
                              ? 'dashboard-policy-segment--active'
                              : '',
                          ]
                            .filter(Boolean)
                            .join(' ')}
                          onClick={() =>
                            setForm((current) => ({
                              ...current,
                              ruleKind: 'near_delegate',
                            }))
                          }
                          disabled={mutating}
                        >
                          {t('gasRuleKindNear')}
                        </button>
                      </div>
                    </div>
                    <label className="dashboard-form-field">
                      <span>{t('gasSpendCapPeriod')}</span>
                      <select
                        className="dashboard-input"
                        value={form.spendCapPeriod}
                        onChange={(event) =>
                          setForm((current) => ({
                            ...current,
                            spendCapPeriod: event.target.value as GasSpendCapPeriod,
                          }))
                        }
                        disabled={mutating || form.spendCapMode === 'NONE'}
                      >
                        {GAS_SPEND_CAP_PERIODS.map((period) => (
                          <option key={period} value={period}>
                            {describeSpendCapPeriodOption(period)}
                          </option>
                        ))}
                      </select>
                    </label>
                    <div className="dashboard-form-field dashboard-form-field--full">
                      <span>{t('gasSpendCap')}</span>
                      <div className="dashboard-policy-contract-call-mode">
                        <button
                          type="button"
                          aria-pressed={form.spendCapMode === 'NONE'}
                          className={[
                            'dashboard-policy-segment',
                            form.spendCapMode === 'NONE' ? 'dashboard-policy-segment--active' : '',
                          ]
                            .filter(Boolean)
                            .join(' ')}
                          onClick={() =>
                            setForm((current) => ({
                              ...current,
                              spendCapMode: 'NONE',
                            }))
                          }
                          disabled={mutating}
                        >
                          {t('gasSpendCapNone')}
                        </button>
                        <button
                          type="button"
                          aria-pressed={form.spendCapMode === 'CHAIN_TOTAL'}
                          className={[
                            'dashboard-policy-segment',
                            form.spendCapMode === 'CHAIN_TOTAL'
                              ? 'dashboard-policy-segment--active'
                              : '',
                          ]
                            .filter(Boolean)
                            .join(' ')}
                          onClick={() =>
                            setForm((current) => ({
                              ...current,
                              spendCapMode: 'CHAIN_TOTAL',
                            }))
                          }
                          disabled={mutating}
                        >
                          {t('gasSpendCapPerChain')}
                        </button>
                        <button
                          type="button"
                          aria-pressed={form.spendCapMode === 'WALLET_CHAIN_TOTAL'}
                          className={[
                            'dashboard-policy-segment',
                            form.spendCapMode === 'WALLET_CHAIN_TOTAL'
                              ? 'dashboard-policy-segment--active'
                              : '',
                          ]
                            .filter(Boolean)
                            .join(' ')}
                          onClick={() =>
                            setForm((current) => ({
                              ...current,
                              spendCapMode: 'WALLET_CHAIN_TOTAL',
                            }))
                          }
                          disabled={mutating}
                        >
                          {t('gasSpendCapPerWalletChain')}
                        </button>
                      </div>
                    </div>
                    {form.ruleKind === 'evm_call' ? (
                      <div className="dashboard-form-field dashboard-form-field--full">
                        <div className="dashboard-gas-target-matrix">
                          <div className="dashboard-gas-target-matrix__header">
                            <span>{t('gasChain')}</span>
                            <span>{activeChainColumnLabel}</span>
                            <span>{t('gasSpendCap')}</span>
                          </div>
                          {GAS_CHAIN_MATRIX_ROWS.map((row) => (
                            <div className="dashboard-gas-target-matrix__row" key={row.chainName}>
                              <div className="dashboard-gas-target-matrix__chain">
                                {row.chainName}
                              </div>
                              {(() => {
                                const target = getGasChainTargetForNetwork(
                                  row,
                                  selectedEnvironmentNetworkClass,
                                );
                                if (!target) {
                                  return (
                                    <>
                                      <span className="dashboard-gas-target-matrix__cell">
                                        <span className="dashboard-gas-target-pill dashboard-gas-target-pill--unavailable">
                                          {t('gasNotAvailable')}
                                        </span>
                                      </span>
                                      <span className="dashboard-gas-target-matrix__cap">
                                        <span className="dashboard-gas-target-cap__empty">-</span>
                                      </span>
                                    </>
                                  );
                                }
                                const pressed = selectedTargetIds.includes(target.id);
                                return (
                                  <>
                                    <span className="dashboard-gas-target-matrix__cell">
                                      <span
                                        className="dashboard-gas-target-toggle"
                                        role="group"
                                        aria-label={target.chainLabel}
                                      >
                                        <button
                                          type="button"
                                          aria-pressed={pressed}
                                          className={[
                                            'dashboard-gas-target-toggle__option',
                                            pressed
                                              ? 'dashboard-gas-target-toggle__option--active'
                                              : '',
                                          ]
                                            .filter(Boolean)
                                            .join(' ')}
                                          onClick={() => onSetTargetEnabled(target.id, true)}
                                          disabled={mutating}
                                        >
                                          {t('gasOn')}
                                        </button>
                                        <button
                                          type="button"
                                          aria-pressed={!pressed}
                                          className={[
                                            'dashboard-gas-target-toggle__option',
                                            !pressed
                                              ? 'dashboard-gas-target-toggle__option--active'
                                              : '',
                                          ]
                                            .filter(Boolean)
                                            .join(' ')}
                                          onClick={() => onSetTargetEnabled(target.id, false)}
                                          disabled={mutating}
                                        >
                                          {t('gasOff')}
                                        </button>
                                      </span>
                                    </span>
                                    <span className="dashboard-gas-target-matrix__cap">
                                      {form.spendCapMode === 'NONE' ? (
                                        <span className="dashboard-gas-target-cap__empty">
                                          {t('gasNoCap')}
                                        </span>
                                      ) : !pressed ? (
                                        <span className="dashboard-gas-target-cap__empty">
                                          {t('gasTurnOnChain')}
                                        </span>
                                      ) : (
                                        <span className="dashboard-gas-target-cap__input">
                                          <input
                                            className="dashboard-input"
                                            aria-label={t('gasFieldSpendCap', {
                                              chain: target.chainLabel,
                                            })}
                                            inputMode="decimal"
                                            value={
                                              form.spendCapAmountByChainName[target.chainName] || ''
                                            }
                                            onChange={(event) =>
                                              setForm((current) => ({
                                                ...current,
                                                spendCapAmountByChainName: {
                                                  ...current.spendCapAmountByChainName,
                                                  [target.chainName]: event.target.value,
                                                },
                                              }))
                                            }
                                            onBlur={(event) =>
                                              setForm((current) => ({
                                                ...current,
                                                spendCapAmountByChainName: {
                                                  ...current.spendCapAmountByChainName,
                                                  [target.chainName]: normalizeSpendCapAmountInput(
                                                    event.target.value,
                                                    target.spendCapDisplayDecimals,
                                                  ),
                                                },
                                              }))
                                            }
                                            placeholder="0.00"
                                            disabled={mutating}
                                          />
                                          <span className="dashboard-gas-target-cap__unit">
                                            {target.spendCapCurrencyCode}
                                          </span>
                                        </span>
                                      )}
                                    </span>
                                  </>
                                );
                              })()}
                            </div>
                          ))}
                        </div>
                        <div className="dashboard-gas-target-bulk">
                          <button
                            type="button"
                            aria-pressed={allActiveTargetsSelected}
                            className={[
                              'dashboard-policy-segment',
                              allActiveTargetsSelected ? 'dashboard-policy-segment--active' : '',
                            ]
                              .filter(Boolean)
                              .join(' ')}
                            onClick={() => onToggleTargetGroup(selectedEnvironmentNetworkClass)}
                            disabled={mutating}
                          >
                            {activeTargetGroupLabel}
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="dashboard-form-field dashboard-form-field--full">
                        <p className="dashboard-pagination-note">
                          {t('gasNearFollowsNetwork', {
                            network: formatNetworkClassLabel(selectedEnvironmentNetworkClass),
                          })}
                        </p>
                        {(() => {
                          const nearTarget = getNearSpendCapTargetForNetwork(
                            selectedEnvironmentNetworkClass,
                          );
                          if (!nearTarget) return null;
                          return (
                            <div className="dashboard-gas-target-matrix">
                              <div className="dashboard-gas-target-matrix__header">
                                <span>{t('gasChain')}</span>
                                <span>{t('gasNetwork')}</span>
                                <span>{t('gasSpendCap')}</span>
                              </div>
                              <div className="dashboard-gas-target-matrix__row">
                                <div className="dashboard-gas-target-matrix__chain">NEAR</div>
                                <span className="dashboard-gas-target-matrix__cell">
                                  <span className="dashboard-gas-target-pill">
                                    {nearTarget.chainLabel}
                                  </span>
                                </span>
                                <span className="dashboard-gas-target-matrix__cap">
                                  {form.spendCapMode === 'NONE' ? (
                                    <span className="dashboard-gas-target-cap__empty">
                                      {t('gasNoCap')}
                                    </span>
                                  ) : (
                                    <span className="dashboard-gas-target-cap__input">
                                      <input
                                        className="dashboard-input"
                                        aria-label={t('gasFieldSpendCap', {
                                          chain: nearTarget.chainLabel,
                                        })}
                                        inputMode="decimal"
                                        value={
                                          form.spendCapAmountByChainName[nearTarget.chainName] || ''
                                        }
                                        onChange={(event) =>
                                          setForm((current) => ({
                                            ...current,
                                            spendCapAmountByChainName: {
                                              ...current.spendCapAmountByChainName,
                                              [nearTarget.chainName]: event.target.value,
                                            },
                                          }))
                                        }
                                        onBlur={(event) =>
                                          setForm((current) => ({
                                            ...current,
                                            spendCapAmountByChainName: {
                                              ...current.spendCapAmountByChainName,
                                              [nearTarget.chainName]: normalizeSpendCapAmountInput(
                                                event.target.value,
                                                nearTarget.spendCapDisplayDecimals,
                                              ),
                                            },
                                          }))
                                        }
                                        placeholder="0.00"
                                        disabled={mutating}
                                      />
                                      <span className="dashboard-gas-target-cap__unit">
                                        {nearTarget.spendCapCurrencyCode}
                                      </span>
                                    </span>
                                  )}
                                </span>
                              </div>
                            </div>
                          );
                        })()}
                      </div>
                    )}
                  </div>
                </section>

                <section className="dashboard-policy-rule-panel dashboard-form-field dashboard-form-field--full">
                  <div className="dashboard-policy-rule-panel__header">
                    <span>
                      {form.ruleKind === 'near_delegate'
                        ? t('gasDelegateActions')
                        : t('gasContractCalls')}
                    </span>
                    <p className="dashboard-pagination-note">
                      {form.ruleKind === 'near_delegate'
                        ? t('gasDefineDelegate')
                        : t('gasDefineContracts')}
                    </p>
                  </div>
                  {form.ruleKind === 'near_delegate' ? (
                    <div className="dashboard-policy-contract-calls">
                      <p className="dashboard-pagination-note">{t('gasExecutionModeNear')}</p>
                      {form.delegateActionRules.length === 0 ? (
                        <p className="dashboard-pagination-note">{t('gasAddDelegateHint')}</p>
                      ) : null}
                      {form.delegateActionRules.map((rule) => (
                        <div key={rule.id} className="dashboard-policy-contract-card">
                          <div className="dashboard-policy-contract-card__header">
                            <strong>{t('gasAllowedDelegateAction')}</strong>
                            <button
                              type="button"
                              className="dashboard-inline-link dashboard-inline-link--danger"
                              onClick={() => removeDelegateActionRule(rule.id)}
                              disabled={mutating}
                            >
                              {t('gasRemove')}
                            </button>
                          </div>
                          <div className="dashboard-view-grid dashboard-view-grid--two">
                            <label className="dashboard-form-field">
                              <span>{t('gasReceiverId')}</span>
                              <input
                                className="dashboard-input"
                                value={rule.receiverId}
                                onChange={(event) =>
                                  updateDelegateActionRule(rule.id, {
                                    receiverId: event.target.value,
                                  })
                                }
                                placeholder="guest-book.testnet"
                                disabled={mutating}
                              />
                            </label>
                            <label className="dashboard-form-field">
                              <span>{t('gasMaxDepositYocto')}</span>
                              <input
                                className="dashboard-input"
                                value={rule.maxDepositYocto}
                                onChange={(event) =>
                                  updateDelegateActionRule(rule.id, {
                                    maxDepositYocto: event.target.value,
                                  })
                                }
                                placeholder="0"
                                inputMode="numeric"
                                disabled={mutating}
                              />
                            </label>
                            <label className="dashboard-form-field dashboard-form-field--full">
                              <span>{t('gasAllowedMethods')}</span>
                              <textarea
                                className="dashboard-input"
                                value={rule.methodsText}
                                onChange={(event) =>
                                  updateDelegateActionRule(rule.id, {
                                    methodsText: event.target.value,
                                  })
                                }
                                placeholder="add_message, vote"
                                disabled={mutating}
                                rows={3}
                              />
                            </label>
                            <label className="dashboard-form-field dashboard-form-field--full">
                              <span className="dashboard-policy-inline-checkbox">
                                <input
                                  type="checkbox"
                                  checked={rule.allowTransfers}
                                  onChange={(event) =>
                                    updateDelegateActionRule(rule.id, {
                                      allowTransfers: event.target.checked,
                                    })
                                  }
                                  disabled={mutating}
                                />
                                {t('gasAllowNativeTransfers')}
                              </span>
                            </label>
                          </div>
                        </div>
                      ))}
                      <button
                        type="button"
                        className="dashboard-pagination-button dashboard-policy-contract-add-button"
                        onClick={addDelegateActionRule}
                        disabled={mutating}
                      >
                        {t('gasAddDelegateAction')}
                      </button>
                    </div>
                  ) : (
                    <div className="dashboard-policy-contract-calls">
                      <p className="dashboard-pagination-note">{t('gasExecutionModeEvm')}</p>
                      {form.contractCallRules.length === 0 ? (
                        <p className="dashboard-pagination-note">{t('gasAddContractHint')}</p>
                      ) : null}
                      {form.contractCallRules.map((rule) => (
                        <div key={rule.id} className="dashboard-policy-contract-card">
                          <div className="dashboard-policy-contract-card__header">
                            <strong>{t('gasAllowedContract')}</strong>
                            <button
                              type="button"
                              className="dashboard-inline-link dashboard-inline-link--danger"
                              onClick={() => removeContractCallRule(rule.id)}
                              disabled={mutating}
                            >
                              {t('gasRemove')}
                            </button>
                          </div>
                          <label className="dashboard-form-field">
                            <span>{t('gasContractAddress')}</span>
                            <input
                              className="dashboard-input"
                              value={rule.contractAddress}
                              onChange={(event) =>
                                updateContractCallRuleAddress(rule.id, event.target.value)
                              }
                              placeholder="0x..."
                              disabled={mutating}
                            />
                          </label>
                          <div className="dashboard-uri-list-editor__rows">
                            {rule.functions.map((functionEntry, index) => (
                              <div
                                key={functionEntry.id}
                                className="dashboard-uri-list-editor__row"
                              >
                                <label className="dashboard-form-field dashboard-uri-list-editor__field">
                                  <span className={index === 0 ? '' : 'dashboard-visually-hidden'}>
                                    {t('gasFunctionSignature')}
                                  </span>
                                  <input
                                    className="dashboard-input"
                                    value={functionEntry.functionSignature}
                                    onChange={(event) =>
                                      updateContractFunction(rule.id, functionEntry.id, {
                                        functionSignature: event.target.value,
                                      })
                                    }
                                    placeholder="transfer(address,uint256)"
                                    disabled={mutating}
                                  />
                                </label>
                                <label className="dashboard-form-field dashboard-uri-list-editor__field">
                                  <span className={index === 0 ? '' : 'dashboard-visually-hidden'}>
                                    {t('gasMaxGasLimit')}
                                  </span>
                                  <input
                                    className="dashboard-input"
                                    value={functionEntry.maxGasLimit}
                                    onChange={(event) =>
                                      updateContractFunction(rule.id, functionEntry.id, {
                                        maxGasLimit: event.target.value,
                                      })
                                    }
                                    placeholder="300000"
                                    inputMode="numeric"
                                    disabled={mutating}
                                  />
                                </label>
                                <label className="dashboard-form-field dashboard-uri-list-editor__field">
                                  <span className={index === 0 ? '' : 'dashboard-visually-hidden'}>
                                    {t('gasMaxValueWei')}
                                  </span>
                                  <input
                                    className="dashboard-input"
                                    value={functionEntry.maxValueWei}
                                    onChange={(event) =>
                                      updateContractFunction(rule.id, functionEntry.id, {
                                        maxValueWei: event.target.value,
                                      })
                                    }
                                    placeholder="0"
                                    inputMode="numeric"
                                    disabled={mutating}
                                  />
                                </label>
                                <div className="dashboard-uri-list-editor__actions">
                                  <button
                                    type="button"
                                    className="dashboard-pagination-button dashboard-pagination-button--secondary"
                                    onClick={() =>
                                      removeContractFunction(rule.id, functionEntry.id)
                                    }
                                    disabled={mutating}
                                  >
                                    {t('gasRemove')}
                                  </button>
                                </div>
                              </div>
                            ))}
                          </div>
                          <button
                            type="button"
                            className="dashboard-inline-link"
                            onClick={() => addContractFunction(rule.id)}
                            disabled={mutating}
                          >
                            {t('gasAddFunction')}
                          </button>
                        </div>
                      ))}
                      <button
                        type="button"
                        className="dashboard-pagination-button dashboard-policy-contract-add-button"
                        onClick={addContractCallRule}
                        disabled={mutating}
                      >
                        {t('gasAddContract')}
                      </button>
                    </div>
                  )}
                </section>

                <div className="dashboard-modal-divider" aria-hidden="true" />

                {formValidationError ? (
                  <p className="dashboard-form-error" role="alert">
                    {formValidationError}
                  </p>
                ) : null}

                <div className="dashboard-form-actions">
                  <button
                    type="button"
                    className="dashboard-pagination-button dashboard-pagination-button--secondary"
                    onClick={onDiscardDraft}
                    disabled={mutating}
                  >
                    {t('gasDiscardDraft')}
                  </button>
                  <button
                    type="submit"
                    className="dashboard-pagination-button"
                    disabled={!canMutatePolicy || mutating || formValidationError !== null}
                    title={formValidationError || undefined}
                  >
                    {mutating
                      ? t('gasSaving')
                      : editingPolicyId
                        ? t('gasSavePolicy')
                        : t('gasCreateSponsorshipPolicy')}
                  </button>
                  <button
                    type="button"
                    className="dashboard-pagination-button"
                    onClick={onResetForm}
                    disabled={mutating}
                  >
                    {t('gasCancel')}
                  </button>
                </div>
              </form>
            </>
          )}
        </DashboardInlineModal>
      ) : null}
    </div>
  );
}

export default GasSponsorshipPage;
