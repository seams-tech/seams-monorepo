import { createInitialOrganization } from './initialOrganizationApi';
import React from 'react';
import { t } from '@core/i18n';
import { Check } from 'lucide-react';
import { useSiteRouter } from '@core/router/useSiteRouter';
import { useDashboardConsoleSession } from '../../consoleSession';
import { DashboardLoadingState } from '../../components/DashboardLoadingState';
import {
  clearDashboardUiState,
  persistDashboardSelectedContext,
} from '../../useDashboardUiPreferences';
import { consoleSessionHref, walletConsoleOverviewHref } from '../../consoleNavigation';
import {
  deriveDashboardOrganizationSlug,
  isDashboardDefaultOrganizationName,
} from '../../utils/organizationIdentity';
import {
  createDashboardAccountOrganization,
  switchDashboardAccountOrganizationContext,
} from '../account-settings/consoleAccountApi';
import {
  createDashboardOnboardingOrganization,
  createDashboardOnboardingProject,
  getDashboardOnboardingState,
  buildDashboardOrganizationOnboardingState,
  DashboardConsoleApiError,
  type DashboardCreateOnboardingOrganizationResult,
  type DashboardCreateOnboardingProjectResult,
  type DashboardOnboardingState,
  type DashboardOnboardingStep,
} from './consoleOnboardingApi';

const ONBOARDING_DRAFT_STORAGE_PREFIX = 'seams-dashboard-onboarding-draft-v1:';
const ONBOARDING_STATE_UPDATED_EVENT = 'dashboard:onboarding-state-updated';
const CREATE_ORGANIZATION_QUERY_PARAM = 'createOrganization';

type OnboardingMutationAction = 'organization' | 'project';

type OnboardingDraft = {
  orgNameInput: string;
  orgNameExplicitlySelected: boolean;
  projectNameInput: string;
  projectId: string;
};

type OnboardingStepperStatus = 'current' | 'done' | 'locked';
type OnboardingVisibleStep = 'organization' | 'project';

function hasConfiguredOrganizationName(
  state: DashboardOnboardingState | null,
  orgNameExplicitlySelected: boolean,
): boolean {
  if (!state) return false;
  const organizationName = String(state.organization?.name || '').trim();
  if (!organizationName) return false;
  if (orgNameExplicitlySelected) return true;
  return !isDashboardDefaultOrganizationName({
    name: organizationName,
    orgId: String(state.orgId || '').trim(),
  });
}

function resolveCurrentStep(
  state: DashboardOnboardingState | null,
  orgNameExplicitlySelected: boolean,
): DashboardOnboardingStep {
  if (!state) return 'organization';
  if (state.currentStep === 'complete') return 'complete';
  if (!state.organizationReady || !hasConfiguredOrganizationName(state, orgNameExplicitlySelected))
    return 'organization';
  return 'project';
}

function createOnboardingProjectId(): string {
  return `proj_${crypto.randomUUID().replaceAll('-', '')}`;
}

function readOnboardingDraft(storageKey: string): OnboardingDraft | null {
  if (typeof window === 'undefined') return null;
  if (!storageKey) return null;
  try {
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    const row = parsed as Record<string, unknown>;
    return {
      orgNameInput: String(row.orgNameInput || '').trim(),
      orgNameExplicitlySelected: row.orgNameExplicitlySelected === true,
      projectNameInput: String(row.projectNameInput || '').trim(),
      projectId:
        typeof row.projectId === 'string' && /^proj_[a-f0-9]{32}$/.test(row.projectId)
          ? row.projectId
          : createOnboardingProjectId(),
    };
  } catch {
    return null;
  }
}

function writeOnboardingDraft(storageKey: string, draft: OnboardingDraft): void {
  if (typeof window === 'undefined') return;
  if (!storageKey) return;
  try {
    window.localStorage.setItem(storageKey, JSON.stringify(draft));
  } catch {}
}

function clearOnboardingDraft(storageKey: string): void {
  if (typeof window === 'undefined') return;
  if (!storageKey) return;
  try {
    window.localStorage.removeItem(storageKey);
  } catch {}
}

function validateOrganizationName(value: string): string {
  const trimmed = String(value || '').trim();
  if (!trimmed) return t('onboardingOrgNameRequired');
  if (trimmed.length < 2) return t('onboardingOrgNameTooShort');
  if (trimmed.length > 80) return t('onboardingOrgNameTooLong');
  return '';
}

function validateProjectName(value: string): string {
  const trimmed = String(value || '').trim();
  if (!trimmed) return t('onboardingProjectNameRequired');
  if (trimmed.length > 80) return t('onboardingProjectNameTooLong');
  return '';
}

function resolveActionableMutationError(error: unknown): string {
  if (error instanceof DashboardConsoleApiError) {
    if (error.code === 'forbidden' || error.status === 403) {
      return t('onboardingPermissionMissing');
    }
    if (error.code === 'invalid_body') {
      return t('onboardingInvalidInput');
    }
    if (error.code === 'project_already_exists') {
      return t('onboardingProjectNameUsed');
    }
    if (error.code === 'organization_required') {
      return t('onboardingNameOrgFirst');
    }
    if (error.code === 'project_archived') {
      return t('onboardingNameArchived');
    }
  }

  const message =
    error instanceof Error ? String(error.message || '').trim() : String(error || '').trim();
  if (!message) return t('onboardingRequestFailed');
  if (/already exists|already used|conflict/i.test(message)) {
    return t('onboardingNameUsed');
  }
  if (/invalid|may only contain/i.test(message)) {
    return t('onboardingInvalidInput');
  }
  if (/forbidden|permission|unauthorized/i.test(message)) {
    return t('onboardingPermissionMissing');
  }
  return message;
}

/* Matches the leaving step's fade in styles.css. */
const ONBOARDING_STEP_LEAVE_MS = 220;

/* React 18 does not pass `inert` through, so set it on the leaving copy. */
function markInert(node: HTMLElement | null): void {
  node?.setAttribute('inert', '');
}

function stepperStatusLabel(status: OnboardingStepperStatus): string {
  if (status === 'current') return t('onboardingStepCurrent');
  if (status === 'done') return t('onboardingStepDone');
  return t('onboardingStepLocked');
}

const SAVED_AS_NAME_MARK = '\u0001';

/** "Saved as {name}." with the name in bold. The mark lets each language place the name. */
function savedAs(name: string): React.JSX.Element {
  const [before = '', after = ''] = t('onboardingSavedAs', { name: SAVED_AS_NAME_MARK }).split(
    SAVED_AS_NAME_MARK,
  );
  return (
    <>
      {before}
      <strong>{name}</strong>
      {after}
    </>
  );
}

function publishOnboardingStateUpdate(state: DashboardOnboardingState): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(
    new CustomEvent<DashboardOnboardingState>(ONBOARDING_STATE_UPDATED_EVENT, {
      detail: state,
    }),
  );
}

function readCreateOrganizationIntent(): boolean {
  if (typeof window === 'undefined') return false;
  const searchParams = new URLSearchParams(window.location.search);
  return String(searchParams.get(CREATE_ORGANIZATION_QUERY_PARAM) || '').trim() === '1';
}

export function DashboardOnboardingPage({
  onOrganizationCreated,
}: { onOrganizationCreated?: () => void } = {}): React.JSX.Element {
  const { go } = useSiteRouter();
  const session = useDashboardConsoleSession();
  const sessionOrgId = String(session.claims?.orgId || '').trim();
  const [loading, setLoading] = React.useState<boolean>(true);
  const [state, setState] = React.useState<DashboardOnboardingState | null>(null);
  const [errorMessage, setErrorMessage] = React.useState<string>('');
  const [mutationError, setMutationError] = React.useState<string>('');
  const [lastFailedAction, setLastFailedAction] = React.useState<OnboardingMutationAction | null>(
    null,
  );
  const [submitting, setSubmitting] = React.useState<boolean>(false);
  const [organizationResult, setOrganizationResult] =
    React.useState<DashboardCreateOnboardingOrganizationResult | null>(null);
  const [projectResult, setProjectResult] =
    React.useState<DashboardCreateOnboardingProjectResult | null>(null);
  const [orgNameInput, setOrgNameInput] = React.useState<string>('');
  const [orgNameExplicitlySelected, setOrgNameExplicitlySelected] = React.useState<boolean>(false);
  const [projectNameInput, setProjectNameInput] = React.useState<string>('');
  const [projectId, setProjectId] = React.useState(createOnboardingProjectId);
  const [orgNameTouched, setOrgNameTouched] = React.useState<boolean>(false);
  const [projectNameTouched, setProjectNameTouched] = React.useState<boolean>(false);
  const [organizationSubmitAttempted, setOrganizationSubmitAttempted] =
    React.useState<boolean>(false);
  const [projectSubmitAttempted, setProjectSubmitAttempted] = React.useState<boolean>(false);
  const [visibleStep, setVisibleStep] = React.useState<OnboardingVisibleStep>('organization');
  const [manualOrganizationStepSelection, setManualOrganizationStepSelection] =
    React.useState<boolean>(false);
  const [loadedDraftStorageKey, setLoadedDraftStorageKey] = React.useState<string>('');
  const [createOrganizationIntent, setCreateOrganizationIntent] = React.useState<boolean>(() =>
    readCreateOrganizationIntent(),
  );

  React.useEffect(() => {
    if (typeof window === 'undefined') return;
    const syncCreateOrganizationIntent = () => {
      setCreateOrganizationIntent(readCreateOrganizationIntent());
    };
    window.addEventListener('popstate', syncCreateOrganizationIntent);
    window.addEventListener('site:navigate', syncCreateOrganizationIntent as EventListener);
    return () => {
      window.removeEventListener('popstate', syncCreateOrganizationIntent);
      window.removeEventListener('site:navigate', syncCreateOrganizationIntent as EventListener);
    };
  }, []);

  const draftStorageKey = React.useMemo(() => {
    if (!sessionOrgId) return '';
    return `${ONBOARDING_DRAFT_STORAGE_PREFIX}${sessionOrgId}${createOrganizationIntent ? ':create-organization' : ''}`;
  }, [createOrganizationIntent, sessionOrgId]);

  const loadState = React.useCallback(() => {
    if (onOrganizationCreated) {
      setState(null);
      setLoading(false);
      setErrorMessage('');
      return;
    }
    if (!sessionOrgId) {
      setState(null);
      setLoading(false);
      setErrorMessage(session.errorMessage || t('onboardingConsoleSessionUnavailable'));
      return;
    }
    if (createOrganizationIntent) {
      setState(buildDashboardOrganizationOnboardingState(sessionOrgId));
      setLoading(false);
      setErrorMessage('');
      return;
    }
    let cancelled = false;
    setLoading(true);
    setErrorMessage('');
    getDashboardOnboardingState()
      .then((nextState) => {
        if (cancelled) return;
        setState(nextState);
        const onboardingOrganizationName = String(nextState.organization?.name || '').trim();
        const onboardingOrganizationId = String(nextState.orgId || '').trim();
        const nextOrganizationNameInput =
          onboardingOrganizationName &&
          isDashboardDefaultOrganizationName({
            name: onboardingOrganizationName,
            orgId: onboardingOrganizationId,
          })
            ? ''
            : onboardingOrganizationName;
        setOrgNameInput((current) => {
          const currentName = String(current || '').trim();
          if (!currentName || currentName === 'Acme Corp') {
            return nextOrganizationNameInput;
          }
          return currentName;
        });
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setState(buildDashboardOrganizationOnboardingState(sessionOrgId));
        setErrorMessage(error instanceof Error ? error.message : String(error));
      })
      .finally(() => {
        if (cancelled) return;
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [createOrganizationIntent, onOrganizationCreated, session.errorMessage, sessionOrgId]);

  React.useEffect(() => {
    if (session.loading) {
      setLoading(true);
      return;
    }
    const cleanup = loadState();
    return cleanup;
  }, [loadState, session.loading]);

  React.useEffect(() => {
    setOrgNameInput('');
    setProjectNameInput('');
    setProjectId(createOnboardingProjectId());
    setOrgNameExplicitlySelected(false);
    setOrganizationResult(null);
    setProjectResult(null);
    setMutationError('');
    setLastFailedAction(null);
    setOrgNameTouched(false);
    setProjectNameTouched(false);
    setOrganizationSubmitAttempted(false);
    setProjectSubmitAttempted(false);
  }, [sessionOrgId]);

  React.useEffect(() => {
    if (!draftStorageKey) {
      setLoadedDraftStorageKey('');
      return;
    }
    if (loadedDraftStorageKey === draftStorageKey) return;
    const draft = readOnboardingDraft(draftStorageKey);
    if (draft) {
      setOrgNameInput(draft.orgNameInput);
      setOrgNameExplicitlySelected(draft.orgNameExplicitlySelected);
      setProjectNameInput(draft.projectNameInput);
      setProjectId(draft.projectId);
    }
    setLoadedDraftStorageKey(draftStorageKey);
  }, [draftStorageKey, loadedDraftStorageKey]);

  const orgNameValidationMessage = validateOrganizationName(orgNameInput);
  const orgSlugInput = React.useMemo(
    () => deriveDashboardOrganizationSlug(orgNameInput),
    [orgNameInput],
  );
  const projectNameValidationMessage = validateProjectName(projectNameInput);

  const onOrganizationNameChange = React.useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      setOrgNameInput(event.target.value);
      setOrgNameExplicitlySelected(false);
    },
    [],
  );

  const onOrganizationNameBlur = React.useCallback(() => {
    setOrgNameTouched(true);
  }, []);

  const onProjectNameChange = React.useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    setProjectNameInput(event.target.value);
  }, []);

  const onProjectNameBlur = React.useCallback(() => {
    setProjectNameTouched(true);
  }, []);

  const submitOrganizationStep = React.useCallback(async () => {
    setOrganizationSubmitAttempted(true);
    setOrgNameTouched(true);
    if (!session.claims && !onOrganizationCreated) {
      setMutationError(session.errorMessage || t('onboardingConsoleSessionUnavailable'));
      return;
    }
    if (orgNameValidationMessage) {
      setMutationError(orgNameValidationMessage);
      return;
    }
    const orgName = String(orgNameInput || '').trim();
    const orgSlug = deriveDashboardOrganizationSlug(orgName);

    setSubmitting(true);
    setMutationError('');
    try {
      if (onOrganizationCreated) {
        await createInitialOrganization(orgName, orgSlug);
        onOrganizationCreated();
        return;
      }
      if (createOrganizationIntent) {
        const createdOrganization = await createDashboardAccountOrganization({
          name: orgName,
          ...(orgSlug ? { slug: orgSlug } : {}),
        });
        const nextContext = await switchDashboardAccountOrganizationContext(createdOrganization.id);
        clearDashboardUiState();
        persistDashboardSelectedContext({
          organization: nextContext.orgId,
          project: nextContext.projectId || '',
          environment: '',
        });
        if (typeof window !== 'undefined') {
          window.location.assign(consoleSessionHref('/dashboard/onboarding'));
          return;
        }
        go('/dashboard/onboarding');
        return;
      }
      const next = await createDashboardOnboardingOrganization({
        org: { name: orgName, ...(orgSlug ? { slug: orgSlug } : {}) },
      });
      setOrganizationResult(next);
      setProjectResult(null);
      setLastFailedAction(null);
      setOrgNameExplicitlySelected(true);
      setProjectSubmitAttempted(false);
      setProjectNameTouched(false);
      setManualOrganizationStepSelection(false);
      setVisibleStep('project');
      setState(next.state);
      publishOnboardingStateUpdate(next.state);
      loadState();
    } catch (error: unknown) {
      setMutationError(resolveActionableMutationError(error));
      setLastFailedAction('organization');
    } finally {
      setSubmitting(false);
    }
  }, [
    createOrganizationIntent,
    go,
    loadState,
    orgNameInput,
    orgNameValidationMessage,
    onOrganizationCreated,
    session.claims,
    session.errorMessage,
  ]);

  const submitProjectStep = React.useCallback(async () => {
    setProjectSubmitAttempted(true);
    setProjectNameTouched(true);
    if (!session.claims) {
      setMutationError(session.errorMessage || t('onboardingConsoleSessionUnavailable'));
      return;
    }
    if (
      !state?.organizationReady ||
      !hasConfiguredOrganizationName(state, orgNameExplicitlySelected)
    ) {
      setMutationError(t('onboardingCompleteOrgFirst'));
      return;
    }
    if (projectNameValidationMessage) {
      setMutationError(projectNameValidationMessage);
      return;
    }
    if (!draftStorageKey || loadedDraftStorageKey !== draftStorageKey) return;

    const projectName = String(projectNameInput || '').trim();
    writeOnboardingDraft(draftStorageKey, {
      orgNameInput,
      orgNameExplicitlySelected,
      projectNameInput: projectName,
      projectId,
    });

    setSubmitting(true);
    setMutationError('');
    try {
      const next = await createDashboardOnboardingProject({
        project: {
          id: projectId,
          name: projectName,
        },
      });
      setProjectResult(next);
      setLastFailedAction(null);
      setState(next.state);
      publishOnboardingStateUpdate(next.state);
      loadState();
    } catch (error: unknown) {
      setMutationError(resolveActionableMutationError(error));
      setLastFailedAction('project');
    } finally {
      setSubmitting(false);
    }
  }, [
    loadState,
    draftStorageKey,
    loadedDraftStorageKey,
    orgNameInput,
    orgNameExplicitlySelected,
    projectId,
    projectNameInput,
    projectNameValidationMessage,
    session.claims,
    session.errorMessage,
    state,
  ]);

  const onSubmitOrganization = React.useCallback(
    (event: React.FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      void submitOrganizationStep();
    },
    [submitOrganizationStep],
  );

  const onSubmitProjectStep = React.useCallback(
    (event: React.FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      void submitProjectStep();
    },
    [submitProjectStep],
  );

  const onRetryFailedMutation = React.useCallback(() => {
    if (lastFailedAction === 'organization') {
      void submitOrganizationStep();
      return;
    }
    if (lastFailedAction === 'project') {
      void submitProjectStep();
    }
  }, [lastFailedAction, submitOrganizationStep, submitProjectStep]);

  const onBackToOrganizationStep = React.useCallback(() => {
    if (submitting) return;
    setMutationError('');
    setLastFailedAction(null);
    setManualOrganizationStepSelection(true);
    setVisibleStep('organization');
  }, [submitting]);

  const onboardingComplete = state?.currentStep === 'complete';

  React.useEffect(() => {
    if (!draftStorageKey) return;
    if (onboardingComplete) {
      clearOnboardingDraft(draftStorageKey);
      return;
    }
    if (loadedDraftStorageKey !== draftStorageKey) return;
    writeOnboardingDraft(draftStorageKey, {
      orgNameInput: String(orgNameInput || '').trim(),
      orgNameExplicitlySelected,
      projectNameInput: String(projectNameInput || '').trim(),
      projectId,
    });
  }, [
    draftStorageKey,
    loadedDraftStorageKey,
    onboardingComplete,
    orgNameExplicitlySelected,
    orgNameInput,
    projectNameInput,
    projectId,
  ]);

  const currentStep = resolveCurrentStep(state, orgNameExplicitlySelected);
  const organizationProfileReady =
    state?.organizationReady === true &&
    hasConfiguredOrganizationName(state, orgNameExplicitlySelected);
  const projectStepLocked = !organizationProfileReady;
  const projectProfileReady = state?.projectReady === true;
  const completionProjectId = String(
    state?.selectedProjectId || projectResult?.project.id || '',
  ).trim();
  const completionOrgId = String(state?.orgId || session.claims?.orgId || '').trim();

  React.useEffect(() => {
    setVisibleStep('organization');
    setManualOrganizationStepSelection(false);
  }, [createOrganizationIntent, sessionOrgId]);

  React.useEffect(() => {
    if (onboardingComplete) return;
    if (currentStep === 'organization') {
      setVisibleStep('organization');
      setManualOrganizationStepSelection(false);
      return;
    }
    if (!manualOrganizationStepSelection) {
      setVisibleStep('project');
    }
  }, [currentStep, manualOrganizationStepSelection, onboardingComplete]);

  React.useEffect(() => {
    if (!onboardingComplete) return;
    persistDashboardSelectedContext({
      organization: completionOrgId,
      project: completionProjectId,
      environment: '',
    });
    go(
      import.meta.env.MODE === 'platform'
        ? walletConsoleOverviewHref({ organization: completionOrgId, project: completionProjectId })
        : '/dashboard/overview',
    );
  }, [completionOrgId, completionProjectId, go, onboardingComplete]);

  const showOrganizationStep = !onboardingComplete && visibleStep === 'organization';
  const showProjectStep = !onboardingComplete && visibleStep === 'project';
  const showOrganizationNameValidation = orgNameTouched || organizationSubmitAttempted;
  const orgNameValidationMessageForUi = showOrganizationNameValidation
    ? orgNameValidationMessage
    : '';
  const showProjectNameValidation =
    !projectStepLocked && (projectNameTouched || projectSubmitAttempted);
  const projectNameValidationMessageForUi = showProjectNameValidation
    ? projectNameValidationMessage
    : '';

  const stepper: Array<{
    key: DashboardOnboardingStep;
    label: string;
    status: OnboardingStepperStatus;
  }> = [
    {
      key: 'organization',
      label: t('onboardingStepOrganization'),
      status: organizationProfileReady
        ? visibleStep === 'organization'
          ? 'current'
          : 'done'
        : 'current',
    },
    {
      key: 'project',
      label: t('onboardingStepProject'),
      status: projectProfileReady ? 'done' : visibleStep === 'project' ? 'current' : 'locked',
    },
  ];

  const organizationSubmitDisabled = submitting;
  const projectSubmitDisabled = submitting || projectStepLocked || state?.projectReady === true;

  const statusMessage =
    session.loading || loading
      ? t('onboardingLoadingStatus')
      : !session.claims && !onOrganizationCreated
        ? t('onboardingUnavailable', {
            reason: session.errorMessage || t('onboardingUnauthorized'),
          })
        : errorMessage
          ? t('onboardingStatusUnavailable', { message: errorMessage })
          : '';

  /* The step that just left stays a moment as an inert copy, so the two steps
     crossfade while the card morphs to the new step's height. */
  const shownStep: OnboardingVisibleStep | null = showProjectStep
    ? 'project'
    : showOrganizationStep
      ? 'organization'
      : null;
  const [leavingStep, setLeavingStep] = React.useState<OnboardingVisibleStep | null>(null);
  const lastStepRef = React.useRef(shownStep);
  React.useEffect(() => {
    const last = lastStepRef.current;
    lastStepRef.current = shownStep;
    if (!last || !shownStep || last === shownStep) return;
    setLeavingStep(last);
    const timer = window.setTimeout(() => {
      setLeavingStep(null);
      setStepMorphing(false);
    }, ONBOARDING_STEP_LEAVE_MS);
    return () => window.clearTimeout(timer);
  }, [shownStep]);

  const stepsRef = React.useRef<HTMLDivElement | null>(null);
  const [stepsHeight, setStepsHeight] = React.useState<number | null>(null);
  /* Only a step change morphs the height; loading and first paint snap. */
  const [stepMorphing, setStepMorphing] = React.useState(false);
  const measuredStepRef = React.useRef(shownStep);
  // A step change sets the new height before paint, so the morph starts at once.
  React.useLayoutEffect(() => {
    const element = stepsRef.current;
    if (!element) return;
    const previous = measuredStepRef.current;
    measuredStepRef.current = shownStep;
    if (previous && shownStep && previous !== shownStep) setStepMorphing(true);
    setStepsHeight(element.offsetHeight);
  }, [shownStep, statusMessage, mutationError]);
  React.useEffect(() => {
    const element = stepsRef.current;
    if (!element) return;
    const observer = new ResizeObserver(() => setStepsHeight(element.offsetHeight));
    observer.observe(element);
    return () => observer.disconnect();
  }, [onboardingComplete]);

  const stepForm = (step: OnboardingVisibleStep): React.JSX.Element =>
    step === 'organization' ? (
      <form
        className="dashboard-onboarding-form dashboard-onboarding-form--organization"
        aria-label={t('onboardingCreateOrganizationAria')}
        onSubmit={onSubmitOrganization}
      >
        <div className="dashboard-onboarding-form__head">
          <h2>{t('onboardingNameYourOrganization')}</h2>
          <p>{t('onboardingNameVisibleHint')}</p>
        </div>
        <label className="dashboard-form-field">
          <span>{t('onboardingOrganizationName')}</span>
          <input
            className="dashboard-input"
            type="text"
            name="organizationName"
            autoComplete="organization"
            value={orgNameInput}
            onChange={onOrganizationNameChange}
            onBlur={onOrganizationNameBlur}
            placeholder="Acme Wallets"
            aria-invalid={Boolean(orgNameValidationMessageForUi)}
          />
          {orgNameValidationMessageForUi ? (
            <p className="dashboard-form-hint dashboard-form-hint--error">
              {orgNameValidationMessageForUi}
            </p>
          ) : (
            <p className="dashboard-form-hint">
              {t('onboardingHandle')} <code>{orgSlugInput || 'acme-wallets'}</code>
            </p>
          )}
        </label>
        <div className="dashboard-onboarding-form__actions">
          <button
            type="submit"
            className="dashboard-pagination-button dashboard-pagination-button--primary"
            disabled={organizationSubmitDisabled}
          >
            {submitting ? t('onboardingSavingOrganization') : t('onboardingContinue')}
          </button>
        </div>
        {organizationResult ? (
          <p className="dashboard-pagination-note">
            {savedAs(organizationResult.organization.name)}
          </p>
        ) : null}
      </form>
    ) : (
      <form
        className="dashboard-onboarding-form dashboard-onboarding-form--project"
        aria-label={t('onboardingCreateProjectAria')}
        onSubmit={onSubmitProjectStep}
      >
        <fieldset className="dashboard-onboarding-form__fieldset" disabled={projectStepLocked}>
          <div className="dashboard-onboarding-form__head">
            <h2>{t('onboardingCreateFirstProject')}</h2>
            <p>{t('onboardingProjectHelp')}</p>
          </div>
          <label className="dashboard-form-field">
            <span>{t('onboardingProjectName')}</span>
            <input
              className="dashboard-input"
              type="text"
              name="projectName"
              autoComplete="off"
              value={projectNameInput}
              onChange={onProjectNameChange}
              onBlur={onProjectNameBlur}
              placeholder="Consumer App"
              aria-invalid={Boolean(projectNameValidationMessageForUi)}
            />
            <p
              className={`dashboard-form-hint${projectNameValidationMessageForUi ? ' dashboard-form-hint--error' : ''}`}
            >
              {projectNameValidationMessageForUi || t('onboardingRenameLater')}
            </p>
          </label>
          <div className="dashboard-onboarding-form__actions">
            <button
              type="button"
              className="dashboard-pagination-button dashboard-pagination-button--secondary"
              onClick={onBackToOrganizationStep}
              disabled={submitting}
            >
              {t('onboardingBack')}
            </button>
            <button
              type="submit"
              className="dashboard-pagination-button dashboard-pagination-button--primary"
              disabled={projectSubmitDisabled}
            >
              {submitting ? t('onboardingCreatingProject') : t('onboardingCreateProject')}
            </button>
          </div>
        </fieldset>
        {projectResult ? (
          <p className="dashboard-pagination-note">{savedAs(projectResult.project.name)}</p>
        ) : null}
      </form>
    );

  if (onboardingComplete) {
    return (
      <div className="dashboard-view" aria-label={t('onboardingWizardPageAria')}>
        <DashboardLoadingState title={t('onboardingOpeningOverview')} />
      </div>
    );
  }

  /* One card: a light slate band with the two steps, then one question per step. */
  return (
    <div className="dashboard-view dashboard-onboarding" aria-label={t('onboardingWizardPageAria')}>
      <section className="dashboard-onboarding-card" aria-label={t('onboardingSetUpWorkspace')}>
        <header className="dashboard-onboarding-card__band">
          <p className="dashboard-onboarding-card__eyebrow">{t('onboardingSetUpWorkspace')}</p>
          <ol className="dashboard-onboarding-stepper" aria-label={t('onboardingProgressAria')}>
            {stepper.map((entry, index) => (
              <li
                key={entry.key}
                className={`dashboard-onboarding-stepper__item dashboard-onboarding-stepper__item--${entry.status}`}
                aria-current={entry.status === 'current' ? 'step' : undefined}
              >
                <span className="dashboard-onboarding-stepper__index" aria-hidden="true">
                  {entry.status === 'done' ? <Check size={13} strokeWidth={2.5} /> : index + 1}
                </span>
                <span className="dashboard-onboarding-stepper__label">{entry.label}</span>
                <span className="dashboard-visually-hidden">
                  {stepperStatusLabel(entry.status)}
                </span>
              </li>
            ))}
          </ol>
        </header>

        <div className="dashboard-onboarding-card__body">
          <div
            className={`dashboard-onboarding-card__steps${stepMorphing ? ' dashboard-onboarding-card__steps--morphing' : ''}`}
            style={stepsHeight === null ? undefined : { height: stepsHeight }}
          >
            <div ref={stepsRef} className="dashboard-onboarding-card__step">
              {statusMessage ? <p className="dashboard-pagination-note">{statusMessage}</p> : null}
              {shownStep ? stepForm(shownStep) : null}
              {mutationError ? (
                <div className="dashboard-form-alert" role="alert">
                  <span>{mutationError}</span>
                  {lastFailedAction ? (
                    <button
                      type="button"
                      className="dashboard-inline-link"
                      onClick={onRetryFailedMutation}
                      disabled={submitting}
                    >
                      {submitting ? t('onboardingRetrying') : t('onboardingRetry')}
                    </button>
                  ) : null}
                </div>
              ) : null}
            </div>
            {leavingStep ? (
              <div
                ref={markInert}
                className="dashboard-onboarding-card__step dashboard-onboarding-card__step--leaving"
                aria-hidden="true"
              >
                {stepForm(leavingStep)}
              </div>
            ) : null}
          </div>
        </div>
      </section>
    </div>
  );
}

export default DashboardOnboardingPage;
