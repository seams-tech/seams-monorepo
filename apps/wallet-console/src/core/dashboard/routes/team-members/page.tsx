import React from 'react';
import { t } from '@core/i18n';
import { toast } from 'sonner';
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
import { dashboardStatusLabel, dashboardStatusTone } from '../../utils/statusTone';
import { DashboardInlineModal } from '../../components/DashboardInlineModal';
import { DashboardPageActions } from '../../components/DashboardPageActions';
import type { PlatformServiceIdV1 } from '@seams-internal/console-shared/accountPlatform';
import { listDashboardProjects, type DashboardConsoleProject } from '../../consoleContextApi';
import { listServiceProjects, platformServiceLabel } from '../services/serviceProjects';
import { useDashboardConsoleSession } from '../../consoleSession';
import { formatDashboardTimestamp } from '../../utils/timestamps';
import {
  changeDashboardOrganizationMembershipRole,
  DASHBOARD_ORGANIZATION_ADMIN_PERMISSIONS,
  inviteDashboardOrganizationMember,
  listDashboardOrganizationInvitations,
  listDashboardOrganizationMemberships,
  reactivateDashboardOrganizationMembership,
  removeDashboardProjectMemberAccess,
  removeDashboardOrganizationMembership,
  resendDashboardOrganizationInvitation,
  revokeDashboardOrganizationInvitation,
  setDashboardOrganizationAdminPermissions,
  setDashboardProjectMemberAccess,
  suspendDashboardOrganizationMembership,
  type DashboardOrganizationAdminPermission,
  type DashboardOrganizationGrant,
  type DashboardOrganizationInvitation,
  type DashboardOrganizationMembership,
  type DashboardOrganizationRole,
  type DashboardProjectAccessAssignment,
  type DashboardProjectAccessLevel,
} from './consoleTeamRbacApi';
import { DashboardTableSkeletonRows } from '../../components/DashboardSkeleton';

const MEMBERSHIP_COLUMNS = dashboardTableColumns(2, 1.25, 0.8, 1.05);
const INVITATION_COLUMNS = dashboardTableColumns(2, 1.2, 0.9, 1.05);

interface GrantEditorProps {
  grant: DashboardOrganizationGrant;
  projects: DashboardConsoleProject[];
  allowPrivilegedRoles: boolean;
  disabled: boolean;
  onChange(grant: DashboardOrganizationGrant): void;
}

function defaultGrant(): DashboardOrganizationGrant {
  return { role: 'MEMBER', projectAccess: [] };
}

function grantFromMembership(
  membership: DashboardOrganizationMembership,
): DashboardOrganizationGrant {
  switch (membership.role) {
    case 'OWNER':
      return { role: membership.role };
    case 'ADMIN':
      return {
        role: membership.role,
        adminPermissions: [...membership.adminPermissions],
      };
    case 'MEMBER':
      return {
        role: membership.role,
        projectAccess: membership.projectAccess.map((assignment) => ({ ...assignment })),
      };
  }
}

function grantForRole(role: DashboardOrganizationRole): DashboardOrganizationGrant {
  switch (role) {
    case 'OWNER':
      return { role };
    case 'ADMIN':
      return { role, adminPermissions: [] };
    case 'MEMBER':
      return { role, projectAccess: [] };
  }
}

function toggleAdminPermission(
  grant: Extract<DashboardOrganizationGrant, { role: 'ADMIN' }>,
  permission: DashboardOrganizationAdminPermission,
  checked: boolean,
): DashboardOrganizationGrant {
  const permissions = new Set(grant.adminPermissions);
  if (checked) permissions.add(permission);
  else permissions.delete(permission);
  if (permissions.has('billing.manage')) permissions.add('billing.view');
  if (permission === 'billing.view' && !checked) permissions.delete('billing.manage');
  return {
    role: grant.role,
    adminPermissions: DASHBOARD_ORGANIZATION_ADMIN_PERMISSIONS.filter((entry) =>
      permissions.has(entry),
    ),
  };
}

function updateProjectAccess(
  grant: Extract<DashboardOrganizationGrant, { role: 'MEMBER' }>,
  projectId: string,
  accessLevel: DashboardProjectAccessLevel | 'none',
): DashboardOrganizationGrant {
  const assignments = new Map<string, DashboardProjectAccessAssignment>();
  for (const assignment of grant.projectAccess) {
    assignments.set(assignment.projectId, assignment);
  }
  if (accessLevel === 'none') assignments.delete(projectId);
  else assignments.set(projectId, { projectId, accessLevel });
  return {
    role: grant.role,
    projectAccess: Array.from(assignments.values()).sort((left, right) =>
      left.projectId.localeCompare(right.projectId),
    ),
  };
}

function projectAccessLevel(
  assignments: DashboardProjectAccessAssignment[],
  projectId: string,
): DashboardProjectAccessLevel | 'none' {
  return (
    assignments.find((assignment) => assignment.projectId === projectId)?.accessLevel ?? 'none'
  );
}

function permissionLabel(permission: DashboardOrganizationAdminPermission): string {
  switch (permission) {
    case 'members.manage':
      return t('teamPermManageMembers');
    case 'projects.manage':
      return t('teamPermManageProjects');
    case 'billing.view':
      return t('teamPermViewBilling');
    case 'billing.manage':
      return t('teamPermManageBilling');
  }
}

/** The projects of one service. Members outside it are listed only on request. */
interface ServiceScope {
  readonly label: string;
  readonly projectIds: ReadonlySet<string>;
}

function scopedAccess(
  assignments: readonly DashboardProjectAccessAssignment[],
  scope: ServiceScope | null,
): readonly DashboardProjectAccessAssignment[] {
  return scope
    ? assignments.filter((assignment) => scope.projectIds.has(assignment.projectId))
    : assignments;
}

function projectAccessSummary(
  assignments: readonly DashboardProjectAccessAssignment[],
  scope: ServiceScope | null,
): string {
  const count = scopedAccess(assignments, scope).length;
  if (!scope) {
    if (count === 0) return t('teamNoProjectAccess');
    return count === 1 ? t('teamProjectCountOne') : t('teamProjectCountMany', { count });
  }
  const label = scope.label;
  if (count === 0) {
    return t('teamNoScopedProjectAccess', { label });
  }
  return count === 1
    ? t('teamScopedProjectCountOne', { label })
    : t('teamScopedProjectCountMany', { count, label });
}

/** Owners and administrators reach every project, so every scope includes them. */
function inServiceScope(
  grant: {
    readonly role: string;
    readonly projectAccess: readonly DashboardProjectAccessAssignment[];
  },
  scope: ServiceScope | null,
): boolean {
  return !scope || grant.role !== 'MEMBER' || scopedAccess(grant.projectAccess, scope).length > 0;
}

function roleSummary(
  membership: DashboardOrganizationMembership,
  scope: ServiceScope | null,
): string {
  if (membership.role === 'OWNER') return t('teamFullOrganizationAccess');
  if (membership.role === 'ADMIN') {
    if (membership.adminPermissions.length === 0) return t('teamReadOnlyAdministrator');
    return membership.adminPermissions.map(permissionLabel).join(', ');
  }
  return projectAccessSummary(membership.projectAccess, scope);
}

function invitationSummary(
  invitation: DashboardOrganizationInvitation,
  scope: ServiceScope | null,
): string {
  if (invitation.role === 'OWNER') return t('teamFullOrganizationAccess');
  if (invitation.role === 'ADMIN') {
    return invitation.adminPermissions.length
      ? invitation.adminPermissions.map(permissionLabel).join(', ')
      : t('teamReadOnlyAdministrator');
  }
  return projectAccessSummary(invitation.projectAccess, scope);
}

function membershipMatchesQuery(
  membership: DashboardOrganizationMembership,
  queryRaw: string,
  scope: ServiceScope | null,
): boolean {
  const query = queryRaw.trim().toLowerCase();
  if (!query) return true;
  return [
    membership.email,
    membership.displayName,
    membership.userId,
    membership.role,
    membership.kind,
    roleSummary(membership, scope),
  ].some((value) =>
    String(value ?? '')
      .toLowerCase()
      .includes(query),
  );
}

function roleFromSelect(value: string): DashboardOrganizationRole {
  if (value === 'OWNER' || value === 'ADMIN') return value;
  return 'MEMBER';
}

function GrantEditor(props: GrantEditorProps): React.JSX.Element {
  const adminGrant = props.grant.role === 'ADMIN' ? props.grant : null;
  const memberGrant = props.grant.role === 'MEMBER' ? props.grant : null;
  const onRoleChange = React.useCallback(
    (event: React.ChangeEvent<HTMLSelectElement>) => {
      props.onChange(grantForRole(roleFromSelect(event.target.value)));
    },
    [props],
  );

  return (
    <div className="dashboard-team-members-permission-editor dashboard-form-field--full">
      <label className="dashboard-form-field">
        <span>{t('teamOrganizationRole')}</span>
        <select
          className="dashboard-input"
          value={props.grant.role}
          onChange={onRoleChange}
          disabled={props.disabled}
        >
          <option value="MEMBER">{t('teamRoleMember')}</option>
          {props.allowPrivilegedRoles ? (
            <option value="ADMIN">{t('teamRoleAdministrator')}</option>
          ) : null}
          {props.allowPrivilegedRoles ? <option value="OWNER">{t('teamRoleOwner')}</option> : null}
        </select>
      </label>

      {props.grant.role === 'OWNER' ? (
        <p className="dashboard-pagination-note">{t('teamOwnersFullAccess')}</p>
      ) : null}

      {adminGrant ? (
        <section className="dashboard-team-members-permission-editor__section">
          <p className="dashboard-team-members-permission-editor__title">
            {t('teamAdministratorPermissions')}
          </p>
          <div className="dashboard-team-members-permission-flags">
            {DASHBOARD_ORGANIZATION_ADMIN_PERMISSIONS.map((permission) => (
              <label className="dashboard-team-members-permission-flag__toggle" key={permission}>
                <input
                  type="checkbox"
                  checked={adminGrant.adminPermissions.includes(permission)}
                  onChange={(event) =>
                    props.onChange(
                      toggleAdminPermission(adminGrant, permission, event.target.checked),
                    )
                  }
                  disabled={
                    props.disabled ||
                    (permission === 'billing.view' &&
                      adminGrant.adminPermissions.includes('billing.manage'))
                  }
                />
                <span className="dashboard-team-members-permission-flag__label">
                  {permissionLabel(permission)}
                </span>
              </label>
            ))}
          </div>
        </section>
      ) : null}

      {memberGrant ? (
        <section className="dashboard-team-members-permission-editor__section">
          <p className="dashboard-team-members-permission-editor__title">
            {t('teamProjectAccess')}
          </p>
          {props.projects.length === 0 ? (
            <p className="dashboard-pagination-note">{t('teamNoActiveProjects')}</p>
          ) : (
            <div className="dashboard-team-members-access-list">
              {props.projects.map((project) => (
                <label className="dashboard-team-members-access-item" key={project.id}>
                  <span>{project.name}</span>
                  <select
                    className="dashboard-input"
                    value={projectAccessLevel(memberGrant.projectAccess, project.id)}
                    onChange={(event) =>
                      props.onChange(
                        updateProjectAccess(
                          memberGrant,
                          project.id,
                          event.target.value as DashboardProjectAccessLevel | 'none',
                        ),
                      )
                    }
                    disabled={props.disabled}
                  >
                    <option value="none">{t('teamAccessNone')}</option>
                    <option value="viewer">{t('teamAccessViewer')}</option>
                    <option value="editor">{t('teamAccessEditor')}</option>
                  </select>
                </label>
              ))}
            </div>
          )}
        </section>
      ) : null}
    </div>
  );
}

/** With `serviceId`, project access covers that service's projects only. */
export function TeamMembersPage(props: {
  readonly serviceId?: PlatformServiceIdV1;
}): React.JSX.Element {
  const { serviceId } = props;
  const session = useDashboardConsoleSession();
  const [showOutsideScope, setShowOutsideScope] = React.useState(false);
  const [memberships, setMemberships] = React.useState<DashboardOrganizationMembership[]>([]);
  const [invitations, setInvitations] = React.useState<DashboardOrganizationInvitation[]>([]);
  const [projects, setProjects] = React.useState<DashboardConsoleProject[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [errorMessage, setErrorMessage] = React.useState('');
  const [mutationError, setMutationError] = React.useState('');
  const [query, setQuery] = React.useState('');
  const [busyId, setBusyId] = React.useState('');
  const [modal, setModal] = React.useState<'invite' | 'edit' | null>(null);
  const [inviteEmail, setInviteEmail] = React.useState('');
  const [inviteGrant, setInviteGrant] = React.useState<DashboardOrganizationGrant>(defaultGrant);
  const [editingMembershipId, setEditingMembershipId] = React.useState('');
  const [editingGrant, setEditingGrant] = React.useState<DashboardOrganizationGrant>(defaultGrant);

  const role = session.claims?.role;
  const adminPermissions = session.claims?.adminPermissions ?? [];
  const isOwner = role === 'OWNER';
  const canManageMembers =
    isOwner || (role === 'ADMIN' && adminPermissions.includes('members.manage'));
  const canManageProjects =
    isOwner || (role === 'ADMIN' && adminPermissions.includes('projects.manage'));
  const canOpenTeamPage = canManageMembers || canManageProjects;

  const reload = React.useCallback(() => {
    if (!session.claims || !canOpenTeamPage) {
      setMemberships([]);
      setInvitations([]);
      setProjects([]);
      setLoading(false);
      return;
    }
    let canceled = false;
    setLoading(true);
    setErrorMessage('');
    const orgId = session.claims.orgId;
    Promise.all([
      listDashboardOrganizationMemberships('all'),
      listDashboardOrganizationInvitations('pending'),
      serviceId
        ? listServiceProjects(orgId, serviceId).then((rows) => rows.map((row) => row.project))
        : listDashboardProjects({ status: 'ACTIVE' }),
    ])
      .then(([nextMemberships, nextInvitations, nextProjects]) => {
        if (canceled) return;
        setMemberships(nextMemberships);
        setInvitations(nextInvitations);
        setProjects(nextProjects);
      })
      .catch((error: unknown) => {
        if (canceled) return;
        setErrorMessage(error instanceof Error ? error.message : String(error));
      })
      .finally(() => {
        if (!canceled) setLoading(false);
      });
    return () => {
      canceled = true;
    };
  }, [canOpenTeamPage, serviceId, session.claims]);

  React.useEffect(() => {
    if (session.loading) return;
    return reload();
  }, [reload, session.loading]);

  const scope = React.useMemo<ServiceScope | null>(
    () =>
      serviceId
        ? {
            label: platformServiceLabel(serviceId),
            projectIds: new Set(projects.map((project) => project.id)),
          }
        : null,
    [projects, serviceId],
  );
  const outsideScopeCount =
    memberships.filter((membership) => !inServiceScope(membership, scope)).length +
    invitations.filter((invitation) => !inServiceScope(invitation, scope)).length;
  const visibleInvitations = showOutsideScope
    ? invitations
    : invitations.filter((invitation) => inServiceScope(invitation, scope));
  const activeMemberships = React.useMemo(
    () =>
      memberships
        .filter((membership) => showOutsideScope || inServiceScope(membership, scope))
        .filter((membership) => membershipMatchesQuery(membership, query, scope))
        .sort((left, right) => {
          if (left.role === 'OWNER' && right.role !== 'OWNER') return -1;
          if (right.role === 'OWNER' && left.role !== 'OWNER') return 1;
          return left.email.localeCompare(right.email);
        }),
    [memberships, query, scope, showOutsideScope],
  );
  const pagination = useDashboardTablePagination(activeMemberships, {
    disabled: loading || session.loading,
    itemLabel: t('teamMembershipItem'),
    itemLabelPlural: t('teamMembershipItemPlural'),
  });
  const ownerCount = memberships.filter(
    (membership) => membership.kind === 'active' && membership.role === 'OWNER',
  ).length;
  const editingMembership =
    memberships.find((membership) => membership.id === editingMembershipId) ?? null;

  const closeModal = React.useCallback(() => {
    setModal(null);
    setMutationError('');
    setInviteEmail('');
    setInviteGrant(defaultGrant());
    setEditingMembershipId('');
    setEditingGrant(defaultGrant());
  }, []);

  const openInviteModal = React.useCallback(() => {
    setMutationError('');
    setInviteGrant(defaultGrant());
    setModal('invite');
  }, []);

  const openEditModal = React.useCallback((membership: DashboardOrganizationMembership) => {
    setMutationError('');
    setEditingMembershipId(membership.id);
    setEditingGrant(grantFromMembership(membership));
    setModal('edit');
  }, []);

  const submitInvitation = React.useCallback(
    async (event: React.FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      if (!canManageMembers) return;
      setBusyId('invite');
      setMutationError('');
      try {
        await inviteDashboardOrganizationMember({
          email: inviteEmail,
          ...inviteGrant,
        });
        toast.success(t('teamInvitationSentTo', { email: inviteEmail.trim().toLowerCase() }));
        closeModal();
        reload();
      } catch (error: unknown) {
        setMutationError(error instanceof Error ? error.message : String(error));
      } finally {
        setBusyId('');
      }
    },
    [canManageMembers, closeModal, inviteEmail, inviteGrant, reload],
  );

  const submitMembership = React.useCallback(
    async (event: React.FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      if (!editingMembership) return;
      setBusyId(editingMembership.id);
      setMutationError('');
      try {
        if (editingMembership.role !== editingGrant.role) {
          await changeDashboardOrganizationMembershipRole(editingMembership.id, editingGrant);
        } else if (editingGrant.role === 'ADMIN') {
          await setDashboardOrganizationAdminPermissions(
            editingMembership.id,
            editingGrant.adminPermissions,
          );
        } else if (editingGrant.role === 'MEMBER') {
          const existing = new Map(
            editingMembership.projectAccess.map((assignment) => [
              assignment.projectId,
              assignment.accessLevel,
            ]),
          );
          for (const assignment of editingGrant.projectAccess) {
            if (existing.get(assignment.projectId) === assignment.accessLevel) continue;
            await setDashboardProjectMemberAccess({
              projectId: assignment.projectId,
              membershipId: editingMembership.id,
              accessLevel: assignment.accessLevel,
            });
          }
          const nextProjectIds = new Set(
            editingGrant.projectAccess.map((assignment) => assignment.projectId),
          );
          for (const assignment of editingMembership.projectAccess) {
            if (nextProjectIds.has(assignment.projectId)) continue;
            await removeDashboardProjectMemberAccess({
              projectId: assignment.projectId,
              membershipId: editingMembership.id,
            });
          }
        }
        toast.success(t('teamMembershipUpdated', { email: editingMembership.email }));
        closeModal();
        reload();
      } catch (error: unknown) {
        setMutationError(error instanceof Error ? error.message : String(error));
      } finally {
        setBusyId('');
      }
    },
    [closeModal, editingGrant, editingMembership, reload],
  );

  const mutateMembershipLifecycle = React.useCallback(
    async (
      membership: DashboardOrganizationMembership,
      action: 'suspend' | 'reactivate' | 'remove',
    ) => {
      if (
        action === 'remove' &&
        !window.confirm(t('teamRemoveMemberConfirm', { email: membership.email }))
      ) {
        return;
      }
      setBusyId(membership.id);
      setMutationError('');
      try {
        if (action === 'suspend') {
          await suspendDashboardOrganizationMembership(membership.id);
        } else if (action === 'reactivate') {
          await reactivateDashboardOrganizationMembership(membership.id);
        } else {
          await removeDashboardOrganizationMembership(membership.id);
        }
        const done =
          action === 'suspend'
            ? t('teamMemberSuspended', { email: membership.email })
            : action === 'reactivate'
              ? t('teamMemberReactivated', { email: membership.email })
              : t('teamMemberRemoved', { email: membership.email });
        toast.success(done);
        reload();
      } catch (error: unknown) {
        setMutationError(error instanceof Error ? error.message : String(error));
      } finally {
        setBusyId('');
      }
    },
    [reload],
  );

  const mutateInvitation = React.useCallback(
    async (invitation: DashboardOrganizationInvitation, action: 'resend' | 'revoke') => {
      setBusyId(invitation.id);
      setMutationError('');
      try {
        if (action === 'resend') {
          await resendDashboardOrganizationInvitation(invitation.id);
          toast.success(t('teamInvitationResent', { email: invitation.email }));
        } else {
          await revokeDashboardOrganizationInvitation(invitation.id);
          toast.success(t('teamInvitationRevoked', { email: invitation.email }));
        }
        reload();
      } catch (error: unknown) {
        setMutationError(error instanceof Error ? error.message : String(error));
      } finally {
        setBusyId('');
      }
    },
    [reload],
  );

  const inviteModal =
    modal === 'invite' ? (
      <DashboardInlineModal isOpen ariaLabel={t('teamInviteModalAria')} onRequestClose={closeModal}>
        <h2>{t('teamInviteMember')}</h2>
        <form className="dashboard-view-grid" onSubmit={submitInvitation}>
          <label className="dashboard-form-field">
            <span>{t('teamVerifiedEmail')}</span>
            <input
              className="dashboard-input"
              type="email"
              required
              value={inviteEmail}
              onChange={(event) => setInviteEmail(event.target.value)}
              disabled={busyId === 'invite'}
            />
          </label>
          <GrantEditor
            grant={inviteGrant}
            projects={projects}
            allowPrivilegedRoles={isOwner}
            disabled={busyId === 'invite'}
            onChange={setInviteGrant}
          />
          {mutationError ? (
            <p className="dashboard-form-alert" role="alert">
              {mutationError}
            </p>
          ) : null}
          <div className="dashboard-form-actions">
            <button
              type="button"
              className="dashboard-pagination-button dashboard-pagination-button--secondary"
              onClick={closeModal}
              disabled={busyId === 'invite'}
            >
              {t('teamCancel')}
            </button>
            <button
              type="submit"
              className="dashboard-pagination-button dashboard-pagination-button--primary"
              disabled={busyId === 'invite'}
            >
              {busyId === 'invite' ? t('teamSending') : t('teamSendInvitation')}
            </button>
          </div>
        </form>
      </DashboardInlineModal>
    ) : null;

  const editModal =
    modal === 'edit' && editingMembership ? (
      <DashboardInlineModal isOpen ariaLabel={t('teamEditModalAria')} onRequestClose={closeModal}>
        <h2>{t('teamEditMembership')}</h2>
        <p className="dashboard-pagination-note">{editingMembership.email}</p>
        <form className="dashboard-view-grid" onSubmit={submitMembership}>
          <GrantEditor
            grant={editingGrant}
            projects={projects}
            allowPrivilegedRoles={isOwner}
            disabled={
              busyId === editingMembership.id || editingMembership.userId === session.claims?.userId
            }
            onChange={setEditingGrant}
          />
          {editingMembership.userId === session.claims?.userId ? (
            <p className="dashboard-pagination-note">{t('teamUseLeaveOrganization')}</p>
          ) : null}
          {mutationError ? (
            <p className="dashboard-form-alert" role="alert">
              {mutationError}
            </p>
          ) : null}
          <div className="dashboard-form-actions">
            <button
              type="button"
              className="dashboard-pagination-button dashboard-pagination-button--secondary"
              onClick={closeModal}
            >
              {t('teamCancel')}
            </button>
            <button
              type="submit"
              className="dashboard-pagination-button dashboard-pagination-button--primary"
              disabled={
                busyId === editingMembership.id ||
                editingMembership.userId === session.claims?.userId
              }
            >
              {busyId === editingMembership.id ? t('teamSaving') : t('teamSave')}
            </button>
          </div>
        </form>
      </DashboardInlineModal>
    ) : null;

  return (
    <div className="dashboard-view dashboard-team-members-view" aria-label={t('teamPageAria')}>
      <section className="dashboard-team-members-view__intro">
        <DashboardPageActions>
          <button
            type="button"
            className="dashboard-pagination-button dashboard-pagination-button--primary"
            onClick={openInviteModal}
            disabled={!canManageMembers}
          >
            {t('teamInviteMember')}
          </button>
        </DashboardPageActions>
        {ownerCount < 2 ? (
          <p className="dashboard-form-alert dashboard-form-alert--notice" role="status">
            {t('teamAddSecondOwner')}
          </p>
        ) : null}
        {mutationError && !modal ? (
          <p className="dashboard-form-alert" role="alert">
            {mutationError}
          </p>
        ) : null}
        {scope ? (
          <p className="dashboard-pagination-note">
            {t('teamScopeNote', { label: scope.label })}
            {outsideScopeCount > 0 ? (
              <>
                {' '}
                <button
                  type="button"
                  className="dashboard-inline-link-button"
                  onClick={() => setShowOutsideScope((current) => !current)}
                >
                  {showOutsideScope
                    ? t('teamHideOutsideScope', { label: scope.label })
                    : t('teamShowOutsideScope', { count: outsideScopeCount, label: scope.label })}
                </button>
              </>
            ) : null}
          </p>
        ) : null}
      </section>

      {!canOpenTeamPage && !session.loading ? (
        <DashboardTableState>{t('teamAdminRequiresAccess')}</DashboardTableState>
      ) : (
        <>
          <section className="dashboard-team-members-view__members">
            <label className="dashboard-search-control dashboard-search-control--compact">
              <span className="dashboard-search-icon" aria-hidden="true" />
              <input
                type="search"
                aria-label={t('teamSearchMembershipsAria')}
                placeholder={t('teamSearchMembers')}
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
            </label>
            <DashboardTable
              ariaLabel={t('teamMembershipsAria')}
              className="dashboard-team-members-table"
              columns={MEMBERSHIP_COLUMNS}
              pagination={pagination.pagination}
            >
              <DashboardTableHeader className="dashboard-team-members-table__row">
                <DashboardTableHeaderCell>{t('teamColMember')}</DashboardTableHeaderCell>
                <DashboardTableHeaderCell>{t('teamColAccess')}</DashboardTableHeaderCell>
                <DashboardTableHeaderCell>{t('teamColStatus')}</DashboardTableHeaderCell>
                <DashboardTableHeaderCell>{t('teamColActions')}</DashboardTableHeaderCell>
              </DashboardTableHeader>
              {loading || session.loading ? (
                <DashboardTableSkeletonRows label={t('teamLoadingMemberships')} columns={4} />
              ) : errorMessage ? (
                <DashboardTableState>{errorMessage}</DashboardTableState>
              ) : pagination.rows.length === 0 ? (
                <DashboardTableState>{t('teamNoMembershipsMatched')}</DashboardTableState>
              ) : (
                pagination.rows.map((membership) => {
                  const self = membership.userId === session.claims?.userId;
                  const owner = membership.role === 'OWNER';
                  const canEditTarget =
                    !self &&
                    (isOwner ||
                      (membership.role === 'MEMBER' && (canManageMembers || canManageProjects)));
                  return (
                    <DashboardTableRow
                      className="dashboard-team-members-table__row"
                      key={membership.id}
                    >
                      <DashboardTableCell
                        title={`${membership.displayName || membership.email} · ${membership.email}`}
                        className="dashboard-data-table__cell--lead"
                      >
                        <div className="dashboard-lead">
                          <span className="dashboard-lead__icon" aria-hidden="true">
                            {(membership.displayName || membership.email).trim().charAt(0)}
                          </span>
                          <span className="dashboard-lead__copy">
                            <span className="dashboard-lead__title">
                              <span className="dashboard-data-table__summary">
                                {membership.displayName || membership.email}
                              </span>
                              <DashboardTableBadge>
                                {dashboardStatusLabel(membership.role)}
                              </DashboardTableBadge>
                            </span>
                            <span className="dashboard-lead__sub">{membership.email}</span>
                          </span>
                        </div>
                      </DashboardTableCell>
                      <DashboardTableCell
                        title={roleSummary(membership, scope)}
                        className="dashboard-data-table__cell--nowrap"
                      >
                        {roleSummary(membership, scope)}
                      </DashboardTableCell>
                      <DashboardTableCell>
                        <DashboardTableStatus tone={dashboardStatusTone(membership.kind)}>
                          {dashboardStatusLabel(membership.kind)}
                        </DashboardTableStatus>
                      </DashboardTableCell>
                      <DashboardTableCell>
                        <DashboardTableActionGroup>
                          <DashboardTableActionButton
                            onClick={() => openEditModal(membership)}
                            disabled={!canEditTarget || membership.kind === 'removed'}
                          >
                            {t('teamEdit')}
                          </DashboardTableActionButton>
                          <DashboardTableActionMenu
                            ariaLabel={t('teamMoreActionsFor', { email: membership.email })}
                            items={[
                              membership.kind === 'suspended'
                                ? {
                                    label: t('teamReactivate'),
                                    onSelect: () =>
                                      mutateMembershipLifecycle(membership, 'reactivate'),
                                    disabled: !canManageMembers || busyId === membership.id,
                                  }
                                : {
                                    label: t('teamSuspend'),
                                    onSelect: () =>
                                      mutateMembershipLifecycle(membership, 'suspend'),
                                    disabled:
                                      !canManageMembers ||
                                      owner ||
                                      self ||
                                      membership.kind !== 'active' ||
                                      busyId === membership.id,
                                  },
                              {
                                label: t('teamRemove'),
                                onSelect: () => mutateMembershipLifecycle(membership, 'remove'),
                                tone: 'danger',
                                disabled:
                                  !canManageMembers ||
                                  owner ||
                                  self ||
                                  membership.kind === 'removed' ||
                                  busyId === membership.id,
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

          <section className="dashboard-team-members-view__invitations">
            <div className="dashboard-team-members-view__section-heading">
              <h2>{t('teamPendingInvitations')}</h2>
              <p className="dashboard-pagination-note">{t('teamInvitationsExpire')}</p>
            </div>
            <DashboardTable
              ariaLabel={t('teamPendingInvitationsAria')}
              className="dashboard-team-members-table"
              columns={INVITATION_COLUMNS}
            >
              <DashboardTableHeader className="dashboard-team-members-table__row">
                <DashboardTableHeaderCell>{t('teamColInvitee')}</DashboardTableHeaderCell>
                <DashboardTableHeaderCell>{t('teamColAccess')}</DashboardTableHeaderCell>
                <DashboardTableHeaderCell>{t('teamColExpires')}</DashboardTableHeaderCell>
                <DashboardTableHeaderCell>{t('teamColActions')}</DashboardTableHeaderCell>
              </DashboardTableHeader>
              {loading ? (
                <DashboardTableSkeletonRows
                  label={t('teamLoadingInvitations')}
                  columns={4}
                  rows={2}
                />
              ) : visibleInvitations.length === 0 ? (
                <DashboardTableState>{t('teamNoPendingInvitations')}</DashboardTableState>
              ) : (
                visibleInvitations.map((invitation) => (
                  <DashboardTableRow
                    className="dashboard-team-members-table__row"
                    key={invitation.id}
                  >
                    <DashboardTableCell
                      title={invitation.email}
                      className="dashboard-data-table__cell--lead"
                    >
                      <div className="dashboard-lead">
                        <span className="dashboard-lead__icon" aria-hidden="true">
                          {invitation.email.trim().charAt(0)}
                        </span>
                        <span className="dashboard-lead__copy">
                          <span className="dashboard-lead__title">
                            <span className="dashboard-data-table__summary">
                              {invitation.email}
                            </span>
                            <DashboardTableBadge>
                              {dashboardStatusLabel(invitation.role)}
                            </DashboardTableBadge>
                          </span>
                        </span>
                      </div>
                    </DashboardTableCell>
                    <DashboardTableCell title={invitationSummary(invitation, scope)}>
                      {invitationSummary(invitation, scope)}
                    </DashboardTableCell>
                    <DashboardTableCell>
                      {formatDashboardTimestamp(invitation.expiresAt || '', '—')}
                    </DashboardTableCell>
                    <DashboardTableCell>
                      <DashboardTableActionGroup>
                        <DashboardTableActionButton
                          onClick={() => mutateInvitation(invitation, 'resend')}
                          disabled={!canManageMembers || busyId === invitation.id}
                        >
                          {t('teamResend')}
                        </DashboardTableActionButton>
                        <DashboardTableActionMenu
                          ariaLabel={t('teamMoreActionsForInvitation', { email: invitation.email })}
                          items={[
                            {
                              label: t('teamRevoke'),
                              onSelect: () => mutateInvitation(invitation, 'revoke'),
                              tone: 'danger',
                              disabled: !canManageMembers || busyId === invitation.id,
                            },
                          ]}
                        />
                      </DashboardTableActionGroup>
                    </DashboardTableCell>
                  </DashboardTableRow>
                ))
              )}
            </DashboardTable>
          </section>
        </>
      )}
      {inviteModal}
      {editModal}
    </div>
  );
}
