import React from 'react';
import { t } from '@core/i18n';
import { formatDashboardTimestamp } from '../../utils/timestamps';
import { toast } from 'sonner';
import { useSiteRouter } from '@core/router/useSiteRouter';
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
  dashboardTableColumns,
  type DashboardTableActionMenuItem,
} from '../../components/DashboardTable';
import { DashboardInlineModal } from '../../components/DashboardInlineModal';
import { markDashboardConsoleSignOut, useDashboardConsoleSession } from '../../consoleSession';
import { dashboardSignInLabel } from '../../utils/userIdentity';
import { ProviderMark } from '@core/auth/ProviderMark';
import { consoleSessionHref } from '../../consoleNavigation';
import { getDashboardProjectLabel } from '../../utils/scopeLabels';
import {
  clearDashboardUiState,
  persistDashboardSelectedContext,
} from '../../useDashboardUiPreferences';
import { isDashboardDefaultOrganizationName } from '../../utils/organizationIdentity';
import {
  deleteDashboardAccountOrganization,
  getDashboardAccountProfile,
  leaveDashboardAccountOrganization,
  listDashboardAccountOrganizations,
  switchDashboardAccountOrganizationContext,
  updateDashboardAccountOrganization,
  updateDashboardAccountProfile,
  type DashboardAccountOrganization,
  type DashboardAccountProfile,
} from './consoleAccountApi';
import { DashboardPageSkeleton } from '../../components/DashboardSkeleton';
import type { PlatformServiceIdV1 } from '@seams-internal/console-shared/accountPlatform';
import { ServiceProjectsSection } from './ServiceProjectsSection';

function formatTimestamp(value: string): string {
  return formatDashboardTimestamp(value, '—');
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error || t('accountUnknownError'));
}

const ACCOUNT_ORGANIZATIONS_TABLE_COLUMNS = dashboardTableColumns(1.4, 0.95, 1.05, 0.9, 0.9);

function isProvisionedPlaceholderOrganization(organization: DashboardAccountOrganization): boolean {
  if (organization.onboardingComplete) return false;
  return isDashboardDefaultOrganizationName({
    name: String(organization.name || '').trim(),
    orgId: String(organization.id || '').trim(),
  });
}

/** With `serviceId`, the page also lists the current organization's projects that run it. */
export function AccountSettingsPage(props: {
  readonly serviceId?: PlatformServiceIdV1;
}): React.JSX.Element {
  const { go } = useSiteRouter();
  const session = useDashboardConsoleSession();
  const signInLabel = dashboardSignInLabel(session.claims?.provider ?? null);
  const [loading, setLoading] = React.useState<boolean>(true);
  const [errorMessage, setErrorMessage] = React.useState<string>('');
  const [actionErrorMessage, setActionErrorMessage] = React.useState<string>('');
  const [profile, setProfile] = React.useState<DashboardAccountProfile | null>(null);
  const [organizations, setOrganizations] = React.useState<DashboardAccountOrganization[]>([]);

  const [displayNameDraft, setDisplayNameDraft] = React.useState<string>('');
  const [primaryEmailDraft, setPrimaryEmailDraft] = React.useState<string>('');
  const [newBackupEmail, setNewBackupEmail] = React.useState<string>('');
  const [renameDrafts, setRenameDrafts] = React.useState<Record<string, string>>({});

  const [savingProfile, setSavingProfile] = React.useState<boolean>(false);
  const [addingBackupEmail, setAddingBackupEmail] = React.useState<boolean>(false);
  const [removingBackupEmail, setRemovingBackupEmail] = React.useState<string>('');
  const [renamingOrganizationId, setRenamingOrganizationId] = React.useState<string>('');
  const [leavingOrganizationId, setLeavingOrganizationId] = React.useState<string>('');
  const [switchingOrganizationId, setSwitchingOrganizationId] = React.useState<string>('');
  const [deletingOrganizationId, setDeletingOrganizationId] = React.useState<string>('');
  const [profileModalOpen, setProfileModalOpen] = React.useState<boolean>(false);
  const [profileModalErrorMessage, setProfileModalErrorMessage] = React.useState<string>('');
  const [renameModalOrganizationId, setRenameModalOrganizationId] = React.useState<string>('');

  React.useEffect(() => {
    if (session.loading) {
      setLoading(true);
      return;
    }

    let cancelled = false;
    const run = async () => {
      try {
        if (!session.claims) {
          setProfile(null);
          setOrganizations([]);
          setErrorMessage(session.errorMessage || t('accountConsoleSessionUnavailable'));
          return;
        }
        setLoading(true);
        setErrorMessage('');
        const profileResult = await getDashboardAccountProfile();
        const organizationsResult = await listDashboardAccountOrganizations();
        if (cancelled) return;
        setProfile(profileResult);
        setOrganizations(
          organizationsResult.filter(
            (organization) => !isProvisionedPlaceholderOrganization(organization),
          ),
        );
      } catch (error: unknown) {
        if (cancelled) return;
        setProfile(null);
        setOrganizations([]);
        setErrorMessage(toErrorMessage(error));
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [session.claims, session.errorMessage, session.loading]);

  const reloadAccountSettings = React.useCallback(async () => {
    if (!session.claims) return;
    const profileResult = await getDashboardAccountProfile();
    const organizationsResult = await listDashboardAccountOrganizations();
    setProfile(profileResult);
    setOrganizations(
      organizationsResult.filter(
        (organization) => !isProvisionedPlaceholderOrganization(organization),
      ),
    );
  }, [session.claims]);

  React.useEffect(() => {
    setRenameDrafts(
      Object.fromEntries(organizations.map((organization) => [organization.id, organization.name])),
    );
  }, [organizations]);

  const renameOrganization = React.useMemo(
    () =>
      organizations.find((organization) => organization.id === renameModalOrganizationId) || null,
    [organizations, renameModalOrganizationId],
  );

  const onSaveProfile = React.useCallback(async () => {
    setSavingProfile(true);
    setProfileModalErrorMessage('');
    try {
      const nextProfile = await updateDashboardAccountProfile({
        displayName: displayNameDraft,
        ...(profile?.canEditPrimaryEmail !== false ? { primaryEmail: primaryEmailDraft } : {}),
      });
      setProfile(nextProfile);
      setProfileModalOpen(false);
      toast.success(t('accountProfileUpdated'));
    } catch (error: unknown) {
      setProfileModalErrorMessage(toErrorMessage(error));
    } finally {
      setSavingProfile(false);
    }
  }, [displayNameDraft, primaryEmailDraft, profile?.canEditPrimaryEmail]);

  const onOpenProfileModal = React.useCallback(() => {
    setDisplayNameDraft(profile?.displayName || '');
    setPrimaryEmailDraft(profile?.primaryEmail || '');
    setNewBackupEmail('');
    setProfileModalErrorMessage('');
    setProfileModalOpen(true);
  }, [profile?.displayName, profile?.primaryEmail]);

  const onCloseProfileModal = React.useCallback(() => {
    if (savingProfile || addingBackupEmail || Boolean(removingBackupEmail)) return;
    setNewBackupEmail('');
    setProfileModalErrorMessage('');
    setProfileModalOpen(false);
  }, [addingBackupEmail, removingBackupEmail, savingProfile]);

  const onAddBackupEmail = React.useCallback(async () => {
    setAddingBackupEmail(true);
    setProfileModalErrorMessage('');
    try {
      const nextProfile = await updateDashboardAccountProfile({
        addBackupEmail: newBackupEmail,
      });
      setProfile(nextProfile);
      setNewBackupEmail('');
      toast.success(t('accountBackupEmailAdded'));
    } catch (error: unknown) {
      setProfileModalErrorMessage(toErrorMessage(error));
    } finally {
      setAddingBackupEmail(false);
    }
  }, [newBackupEmail]);

  const onRemoveBackupEmail = React.useCallback(async (email: string) => {
    setRemovingBackupEmail(email);
    setProfileModalErrorMessage('');
    try {
      const nextProfile = await updateDashboardAccountProfile({
        removeBackupEmail: email,
      });
      setProfile(nextProfile);
      toast.success(t('accountBackupEmailRemoved'));
    } catch (error: unknown) {
      setProfileModalErrorMessage(toErrorMessage(error));
    } finally {
      setRemovingBackupEmail('');
    }
  }, []);

  const onCreateOrganization = React.useCallback(() => {
    setActionErrorMessage('');
    go('/dashboard/onboarding?createOrganization=1');
  }, [go]);

  const onRenameOrganization = React.useCallback(
    async (organization: DashboardAccountOrganization) => {
      const nextName = String(renameDrafts[organization.id] || '').trim();
      setRenamingOrganizationId(organization.id);
      setActionErrorMessage('');
      try {
        await updateDashboardAccountOrganization(organization.id, {
          name: nextName,
        });
        await reloadAccountSettings();
        setRenameModalOrganizationId('');
        toast.success(t('accountOrganizationUpdated', { name: organization.name }));
      } catch (error: unknown) {
        setActionErrorMessage(toErrorMessage(error));
      } finally {
        setRenamingOrganizationId('');
      }
    },
    [reloadAccountSettings, renameDrafts],
  );

  const onOpenRenameModal = React.useCallback((organization: DashboardAccountOrganization) => {
    setActionErrorMessage('');
    setRenameDrafts((current) => ({
      ...current,
      [organization.id]: organization.name,
    }));
    setRenameModalOrganizationId(organization.id);
  }, []);

  const onCloseRenameModal = React.useCallback(() => {
    setActionErrorMessage('');
    setRenameModalOrganizationId('');
  }, []);

  const onLeaveOrganization = React.useCallback(
    async (organization: DashboardAccountOrganization) => {
      if (typeof window !== 'undefined') {
        const confirmed = window.confirm(
          t('accountLeaveOrganizationConfirm', {
            name: organization.name,
          }),
        );
        if (!confirmed) return;
      }
      setLeavingOrganizationId(organization.id);
      setActionErrorMessage('');
      try {
        await leaveDashboardAccountOrganization();
        clearDashboardUiState();
        if (typeof window !== 'undefined') {
          window.location.assign('/dashboard');
          return;
        }
        go('/dashboard');
      } catch (error: unknown) {
        setActionErrorMessage(toErrorMessage(error));
      } finally {
        setLeavingOrganizationId('');
      }
    },
    [go],
  );

  const onOpenOrganization = React.useCallback(
    async (organization: DashboardAccountOrganization) => {
      setSwitchingOrganizationId(organization.id);
      setActionErrorMessage('');
      try {
        if (!organization.isCurrentOrg) {
          const nextContext = await switchDashboardAccountOrganizationContext(organization.id);
          const nextPath = nextContext.onboardingComplete ? '/dashboard' : '/dashboard/onboarding';
          clearDashboardUiState();
          // The closing dashboard still has the previous session. Broadcasting
          // this selection lets that screen restore its old account before unload.
          persistDashboardSelectedContext({
            organization: nextContext.orgId,
            project: nextContext.projectId || '',
            environment: '',
          });
          if (typeof window !== 'undefined') {
            window.location.assign(consoleSessionHref(nextPath));
            return;
          }
          go(nextPath);
          return;
        }
        go(organization.onboardingComplete ? '/dashboard' : '/dashboard/onboarding');
      } catch (error: unknown) {
        setActionErrorMessage(toErrorMessage(error));
      } finally {
        setSwitchingOrganizationId('');
      }
    },
    [go],
  );

  const onDeleteOrganization = React.useCallback(
    async (organization: DashboardAccountOrganization) => {
      if (typeof window !== 'undefined') {
        const confirmed = window.confirm(
          t('accountDeleteOrganizationConfirm', {
            name: organization.name,
          }),
        );
        if (!confirmed) return;
      }
      setDeletingOrganizationId(organization.id);
      setActionErrorMessage('');
      try {
        await deleteDashboardAccountOrganization(organization.id);
        if (organization.isCurrentOrg) {
          clearDashboardUiState();
          markDashboardConsoleSignOut();
          window.location.assign(consoleSessionHref('/dashboard/login'));
          return;
        }
        await reloadAccountSettings();
        toast.success(t('accountOrganizationDeleted', { name: organization.name }));
      } catch (error: unknown) {
        setActionErrorMessage(toErrorMessage(error));
      } finally {
        setDeletingOrganizationId('');
      }
    },
    [reloadAccountSettings],
  );

  if (loading) {
    return (
      <section className="dashboard-account-settings" aria-label={t('accountSettingsLoadingAria')}>
        <DashboardPageSkeleton
          label={t('accountSettingsLoadingLabel')}
          metrics={2}
          rows={2}
          columns={4}
        />
      </section>
    );
  }

  if (errorMessage) {
    return (
      <section className="dashboard-account-settings" aria-label={t('accountSettingsErrorAria')}>
        <p className="dashboard-form-alert" role="alert">
          {errorMessage}
        </p>
      </section>
    );
  }

  const renameModal =
    renameOrganization !== null ? (
      <DashboardInlineModal
        isOpen
        ariaLabel={t('accountRenameModalAria')}
        onRequestClose={onCloseRenameModal}
      >
        <h2>{t('accountRenameOrganizationTitle')}</h2>
        <p className="dashboard-pagination-note">
          {renameOrganization.slug || renameOrganization.id}
        </p>
        <form
          className="dashboard-view-grid"
          onSubmit={(event) => {
            event.preventDefault();
            void onRenameOrganization(renameOrganization);
          }}
        >
          <label className="dashboard-form-field">
            <span>{t('accountOrganizationName')}</span>
            <input
              className="dashboard-input"
              value={renameDrafts[renameOrganization.id] || ''}
              onChange={(event) =>
                setRenameDrafts((current) => ({
                  ...current,
                  [renameOrganization.id]: event.target.value,
                }))
              }
              disabled={renamingOrganizationId === renameOrganization.id}
              placeholder={t('accountOrganizationName')}
              autoFocus
            />
          </label>
          {actionErrorMessage ? (
            <p className="dashboard-form-alert" role="alert">
              {actionErrorMessage}
            </p>
          ) : null}
          <div className="dashboard-form-actions">
            <button
              type="button"
              className="dashboard-pagination-button dashboard-pagination-button--secondary"
              onClick={onCloseRenameModal}
              disabled={renamingOrganizationId === renameOrganization.id}
            >
              {t('accountCancel')}
            </button>
            <button
              type="submit"
              className="dashboard-pagination-button"
              disabled={
                renamingOrganizationId === renameOrganization.id ||
                !String(renameDrafts[renameOrganization.id] || '').trim()
              }
            >
              {renamingOrganizationId === renameOrganization.id
                ? t('accountSaving')
                : t('accountRename')}
            </button>
          </div>
        </form>
      </DashboardInlineModal>
    ) : null;

  const profileModal = profileModalOpen ? (
    <DashboardInlineModal
      isOpen
      ariaLabel={t('accountEditProfileModalAria')}
      onRequestClose={onCloseProfileModal}
      className="dashboard-account-profile-modal"
    >
      <h2>{t('accountEditProfileTitle')}</h2>
      <form
        className="dashboard-view-grid"
        onSubmit={(event) => {
          event.preventDefault();
          void onSaveProfile();
        }}
      >
        <div className="dashboard-view-grid dashboard-view-grid--two dashboard-account-grid">
          <label className="dashboard-form-field">
            <span>{t('accountDisplayName')}</span>
            <input
              className="dashboard-input"
              value={displayNameDraft}
              onChange={(event) => setDisplayNameDraft(event.target.value)}
              placeholder={t('accountDisplayName')}
              autoFocus
            />
          </label>
          <label className="dashboard-form-field">
            <span>
              {profile?.canEditPrimaryEmail === false
                ? t('accountPrimaryEmailReadOnly')
                : t('accountPrimaryEmail')}
            </span>
            <input
              className="dashboard-input"
              value={primaryEmailDraft}
              onChange={(event) => setPrimaryEmailDraft(event.target.value)}
              disabled={profile?.canEditPrimaryEmail === false}
              placeholder="name@example.com"
            />
            {profile?.canEditPrimaryEmail === false ? (
              <span className="dashboard-pagination-note">{t('accountPrimaryEmailManaged')}</span>
            ) : null}
          </label>
        </div>
        <div className="dashboard-account-subsection dashboard-account-subsection--compact">
          <div className="dashboard-section-toolbar dashboard-account-subsection-header">
            <div className="dashboard-section-toolbar__copy">
              <h3>{t('accountBackupEmailsHeading')}</h3>
            </div>
          </div>
          {profile?.backupEmails.length ? (
            <div className="dashboard-account-backup-list">
              {profile.backupEmails.map((backupEmail) => (
                <article className="dashboard-account-backup-item" key={backupEmail.email}>
                  <div className="dashboard-account-backup-item__content">
                    <strong>{backupEmail.email}</strong>
                    <p className="dashboard-pagination-note">
                      {t('accountBackupEmailMeta', {
                        status: backupEmail.status,
                        date: formatTimestamp(backupEmail.createdAt),
                      })}
                    </p>
                  </div>
                  <button
                    type="button"
                    className="dashboard-pagination-button dashboard-pagination-button--danger dashboard-account-backup-item__action"
                    onClick={() => void onRemoveBackupEmail(backupEmail.email)}
                    disabled={removingBackupEmail === backupEmail.email}
                  >
                    {removingBackupEmail === backupEmail.email
                      ? t('accountRemoving')
                      : t('accountRemove')}
                  </button>
                </article>
              ))}
            </div>
          ) : null}
          <div className="dashboard-account-inline-form">
            <label className="dashboard-form-field">
              <span className="dashboard-visually-hidden">{t('accountBackupEmail')}</span>
              <input
                className="dashboard-input"
                value={newBackupEmail}
                onChange={(event) => setNewBackupEmail(event.target.value)}
                placeholder="recovery@example.com"
              />
            </label>
            <button
              type="button"
              className="dashboard-pagination-button"
              onClick={() => void onAddBackupEmail()}
              disabled={addingBackupEmail}
            >
              {addingBackupEmail ? t('accountAdding') : t('accountAdd')}
            </button>
          </div>
        </div>
        {profileModalErrorMessage ? (
          <p className="dashboard-form-alert" role="alert">
            {profileModalErrorMessage}
          </p>
        ) : null}
        <div className="dashboard-form-actions">
          <button
            type="button"
            className="dashboard-pagination-button dashboard-pagination-button--secondary"
            onClick={onCloseProfileModal}
            disabled={savingProfile || addingBackupEmail || Boolean(removingBackupEmail)}
          >
            {t('accountCancel')}
          </button>
          <button type="submit" className="dashboard-pagination-button" disabled={savingProfile}>
            {savingProfile ? t('accountSaving') : t('accountSave')}
          </button>
        </div>
      </form>
    </DashboardInlineModal>
  ) : null;

  return (
    <div className="dashboard-account-settings" aria-label={t('accountSettingsPageAria')}>
      {actionErrorMessage ? (
        <p className="dashboard-form-alert" role="alert">
          {actionErrorMessage}
        </p>
      ) : null}

      <section className="dashboard-account-panel dashboard-account-panel--profile">
        <div className="dashboard-account-profile-card">
          <div className="dashboard-section-toolbar dashboard-account-section-header">
            <div className="dashboard-section-toolbar__copy">
              <h2>{t('accountProfile')}</h2>
            </div>
            <button
              type="button"
              className="dashboard-pagination-button"
              onClick={onOpenProfileModal}
            >
              {t('accountEdit')}
            </button>
          </div>
          <div className="dashboard-view-grid dashboard-view-grid--two dashboard-account-grid">
            <div className="dashboard-account-static-field">
              <span>{t('accountDisplayName')}</span>
              <div className="dashboard-account-static-value">
                {profile?.displayName || t('accountNotSet')}
              </div>
            </div>
            <div className="dashboard-account-static-field">
              <span>{t('accountPrimaryEmail')}</span>
              <div className="dashboard-account-static-value">
                {profile?.primaryEmail || t('accountNotSet')}
              </div>
              {profile?.canEditPrimaryEmail === false ? (
                <p className="dashboard-pagination-note">{t('accountPrimaryEmailManaged')}</p>
              ) : null}
            </div>
          </div>
          {signInLabel ? (
            <div className="dashboard-account-static-field">
              <span>{t('accountSignInMethod')}</span>
              <div className="dashboard-account-static-value">
                <span className="dashboard-sign-in-method">
                  <ProviderMark provider={session.claims?.provider ?? null} />
                  {signInLabel}
                </span>
              </div>
            </div>
          ) : null}
          <div className="dashboard-account-static-field">
            <span>{t('accountBackupEmailsLabel')}</span>
            <div className="dashboard-account-static-value">
              {profile?.backupEmails.length
                ? t('accountBackupEmailsConfigured', { count: profile.backupEmails.length })
                : t('accountNoneConfigured')}
            </div>
            <p className="dashboard-pagination-note">{t('accountManageBackupEmails')}</p>
          </div>
        </div>
      </section>

      {props.serviceId && session.claims?.orgId ? (
        <ServiceProjectsSection organizationId={session.claims.orgId} serviceId={props.serviceId} />
      ) : null}

      <section className="dashboard-account-panel dashboard-account-panel--organizations">
        <div className="dashboard-section-toolbar dashboard-account-section-header dashboard-account-section-header--actions-left">
          <div className="dashboard-section-toolbar__copy">
            <h2>{t('accountMyOrganizations')}</h2>
            <p className="dashboard-pagination-note">{t('accountOrganizationsHelp')}</p>
          </div>
          <button
            type="button"
            className="dashboard-pagination-button dashboard-pagination-button--primary"
            onClick={onCreateOrganization}
          >
            {t('accountCreateOrganization')}
          </button>
        </div>

        <DashboardTable
          ariaLabel={t('accountOrganizationsAria')}
          columns={ACCOUNT_ORGANIZATIONS_TABLE_COLUMNS}
          className="dashboard-account-org-table"
        >
          <DashboardTableHeader>
            <DashboardTableHeaderCell>{t('accountColOrganization')}</DashboardTableHeaderCell>
            <DashboardTableHeaderCell>{t('accountColUpdated')}</DashboardTableHeaderCell>
            <DashboardTableHeaderCell>{t('accountColScope')}</DashboardTableHeaderCell>
            <DashboardTableHeaderCell>{t('accountColStatus')}</DashboardTableHeaderCell>
            <DashboardTableHeaderCell>{t('accountColActions')}</DashboardTableHeaderCell>
          </DashboardTableHeader>
          {organizations.length ? (
            organizations.map((organization) => {
              const canRename =
                organization.role === 'OWNER' ||
                (organization.role === 'ADMIN' &&
                  organization.adminPermissions.includes('projects.manage'));
              const menuItems: DashboardTableActionMenuItem[] = [
                ...(canRename
                  ? [
                      {
                        label: t('accountRenameMenu'),
                        onSelect: () => onOpenRenameModal(organization),
                        disabled: renamingOrganizationId === organization.id,
                      },
                    ]
                  : []),
                ...(organization.role === 'OWNER'
                  ? [
                      {
                        label:
                          deletingOrganizationId === organization.id
                            ? t('accountDeleting')
                            : t('accountDelete'),
                        onSelect: () => void onDeleteOrganization(organization),
                        tone: 'danger' as const,
                        disabled: deletingOrganizationId === organization.id,
                      },
                    ]
                  : []),
                ...(organization.isCurrentOrg
                  ? [
                      {
                        label:
                          leavingOrganizationId === organization.id
                            ? t('accountLeaving')
                            : t('accountLeaveOrganization'),
                        onSelect: () => void onLeaveOrganization(organization),
                        tone: 'danger' as const,
                        disabled: leavingOrganizationId === organization.id,
                        title:
                          organization.role === 'OWNER'
                            ? t('accountLastOwnerMustRemain')
                            : undefined,
                      },
                    ]
                  : []),
              ];
              return (
                <DashboardTableRow key={organization.id}>
                  <DashboardTableCell className="dashboard-account-org-table__organization">
                    <strong className="dashboard-data-table__summary">{organization.name}</strong>
                    <span className="dashboard-pagination-note">
                      {organization.slug || organization.id}
                    </span>
                  </DashboardTableCell>
                  <DashboardTableCell className="dashboard-account-org-table__activity">
                    {formatTimestamp(organization.updatedAt)}
                  </DashboardTableCell>
                  <DashboardTableCell className="dashboard-account-org-table__scope">
                    <div className="dashboard-account-org-scope">
                      <strong>
                        {getDashboardProjectLabel({
                          projectId: organization.selectedProjectId,
                          projectName: organization.selectedProjectName,
                        })}
                      </strong>
                    </div>
                  </DashboardTableCell>
                  <DashboardTableCell>
                    {!organization.onboardingComplete ? (
                      <DashboardTableBadge tone="warning">
                        {t('accountBadgeNeedsOnboarding')}
                      </DashboardTableBadge>
                    ) : organization.isCurrentOrg ? (
                      <DashboardTableBadge>{t('accountBadgeCurrent')}</DashboardTableBadge>
                    ) : (
                      <DashboardTableBadge tone="success">
                        {t('accountBadgeReady')}
                      </DashboardTableBadge>
                    )}
                  </DashboardTableCell>
                  <DashboardTableCell>
                    <DashboardTableActionGroup className="dashboard-account-org-table__actions">
                      <DashboardTableActionButton
                        onClick={() => void onOpenOrganization(organization)}
                        disabled={switchingOrganizationId === organization.id}
                      >
                        {switchingOrganizationId === organization.id
                          ? t('accountOpening')
                          : t('accountOpen')}
                      </DashboardTableActionButton>
                      <DashboardTableActionMenu
                        ariaLabel={t('accountMoreActionsFor', { name: organization.name })}
                        items={menuItems}
                      />
                    </DashboardTableActionGroup>
                  </DashboardTableCell>
                </DashboardTableRow>
              );
            })
          ) : (
            <DashboardTableState>{t('accountNoOrganizations')}</DashboardTableState>
          )}
        </DashboardTable>
      </section>
      {profileModal}
      {renameModal}
    </div>
  );
}

export default AccountSettingsPage;
