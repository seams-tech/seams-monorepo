import React from 'react';
import SeamsWordmark from '@core/components/SeamsWordmark';
import { useSiteRouter } from '@core/router/useSiteRouter';
import {
  fetchDashboardConsoleSession,
  markDashboardConsoleSignOut,
  revokeDashboardConsoleSession,
} from '../../consoleSession';
import { consoleSessionHref } from '../../consoleNavigation';
import { requireConsoleBaseUrl } from '../../consoleHttp';
import { replaceDashboardSelectedContext } from '../../useDashboardUiPreferences';
import { readUnscopedConsoleSession } from '../onboarding/initialOrganizationApi';
import {
  acceptDashboardInvitation,
  clearPendingDashboardInvitation,
  readDashboardInvitationLink,
  type DashboardInvitation,
} from './invitation';
import '../../styles.css';

type InvitationPageState =
  | { readonly kind: 'invalid'; readonly message: string; readonly invitation?: never }
  | {
      readonly kind: 'checking' | 'signed_out' | 'ready' | 'accepting';
      readonly invitation: DashboardInvitation;
      readonly message?: never;
    }
  | {
      readonly kind: 'failed';
      readonly invitation: DashboardInvitation;
      readonly message: string;
    };

type SetInvitationState = React.Dispatch<React.SetStateAction<InvitationPageState>>;
type Navigate = (href: string) => void;

function initialInvitationState(): InvitationPageState {
  try {
    const invitation = readDashboardInvitationLink();
    return invitation
      ? { kind: 'checking', invitation }
      : {
          kind: 'invalid',
          message: 'This invitation link is incomplete. Open the link from your email.',
        };
  } catch {
    return {
      kind: 'invalid',
      message: 'Allow session storage in this browser, then open the invitation link again.',
    };
  }
}

function stopSessionCheck(lifetime: { active: boolean }): void {
  lifetime.active = false;
}

async function resolveInvitationSession(
  lifetime: { active: boolean },
  invitation: DashboardInvitation,
  setState: SetInvitationState,
): Promise<void> {
  try {
    let signedIn = false;
    try {
      await fetchDashboardConsoleSession();
      signedIn = true;
    } catch {
      signedIn = await readUnscopedConsoleSession(requireConsoleBaseUrl());
    }
    if (lifetime.active) {
      setState({ kind: signedIn ? 'ready' : 'signed_out', invitation });
    }
  } catch (error: unknown) {
    if (lifetime.active) {
      setState({
        kind: 'failed',
        invitation,
        message:
          error instanceof Error ? error.message : 'Unable to check your sign-in. Try again.',
      });
    }
  }
}

function checkInvitationSession(
  invitation: DashboardInvitation | null,
  setState: SetInvitationState,
): (() => void) | undefined {
  if (!invitation) return undefined;
  const lifetime = { active: true };
  void resolveInvitationSession(lifetime, invitation, setState);
  return stopSessionCheck.bind(null, lifetime);
}

async function acceptInvitation(
  invitation: DashboardInvitation,
  setState: SetInvitationState,
  go: Navigate,
): Promise<void> {
  setState({ kind: 'accepting', invitation });
  const result = await acceptDashboardInvitation(invitation);
  if (!result.ok) {
    setState({ kind: 'failed', invitation, message: result.message });
    return;
  }
  clearPendingDashboardInvitation();
  replaceDashboardSelectedContext({ organization: result.orgId, project: '' });
  go(consoleSessionHref('/dashboard'));
}

async function useAnotherAccount(
  invitation: DashboardInvitation,
  setState: SetInvitationState,
  go: Navigate,
): Promise<void> {
  try {
    await revokeDashboardConsoleSession();
    markDashboardConsoleSignOut();
    go(consoleSessionHref('/dashboard/login'));
  } catch (error: unknown) {
    setState({
      kind: 'failed',
      invitation,
      message: error instanceof Error ? error.message : 'Unable to sign out. Try again.',
    });
  }
}

function leaveInvitation(go: Navigate): void {
  clearPendingDashboardInvitation();
  go(consoleSessionHref('/dashboard'));
}

function assertNeverInvitation(state: never): never {
  throw new Error(`Unknown invitation state: ${String(state)}`);
}

function InvitationActions({
  state,
  setState,
  go,
}: {
  readonly state: InvitationPageState;
  readonly setState: SetInvitationState;
  readonly go: Navigate;
}): React.JSX.Element {
  switch (state.kind) {
    case 'invalid':
      return (
        <p className="dashboard-login__form-error" role="alert">
          {state.message}
        </p>
      );
    case 'checking':
      return <p role="status">Checking your sign-in...</p>;
    case 'signed_out':
      return (
        <a className="dashboard-login__auth-button" href={consoleSessionHref('/dashboard/login')}>
          Sign in to accept
        </a>
      );
    case 'accepting':
      return <p role="status">Accepting invitation...</p>;
    case 'ready':
    case 'failed':
      return (
        <>
          {state.kind === 'failed' ? (
            <p className="dashboard-login__form-error" role="alert">
              {state.message}
            </p>
          ) : null}
          <button
            type="button"
            className="dashboard-login__auth-button"
            onClick={acceptInvitation.bind(null, state.invitation, setState, go)}
          >
            Accept invitation
          </button>
          <button
            type="button"
            className="dashboard-pagination-button dashboard-pagination-button--secondary"
            onClick={useAnotherAccount.bind(null, state.invitation, setState, go)}
          >
            Use another account
          </button>
        </>
      );
    default:
      return assertNeverInvitation(state);
  }
}

export function InvitationAcceptancePage(): React.JSX.Element {
  const { go } = useSiteRouter();
  const [state, setState] = React.useState<InvitationPageState>(initialInvitationState);
  const invitation = state.kind === 'invalid' ? null : state.invitation;
  // eslint-disable-next-line react-hooks/exhaustive-deps -- The bound function contains the full effect input.
  React.useEffect(checkInvitationSession.bind(null, invitation, setState), [invitation]);
  return (
    <main className="dashboard-login dashboard-invitation" aria-label="Invitation acceptance page">
      <section className="dashboard-login__panel">
        <a className="dashboard-login__brand" href="https://seams.sh/" aria-label="Seams home">
          <SeamsWordmark height={24} />
          <span className="dashboard-login__brand-label">Console</span>
        </a>
        <div className="dashboard-login__body">
          <div className="dashboard-login__form">
            <div className="dashboard-login__form-header">
              <h1>Join your team</h1>
            </div>
            <p className="dashboard-login__form-copy">
              Sign in with the Google or GitHub account that received this invitation.
            </p>
            <div className="dashboard-login__provider-buttons">
              <InvitationActions state={state} setState={setState} go={go} />
              <button
                type="button"
                className="dashboard-inline-link"
                onClick={leaveInvitation.bind(null, go)}
              >
                Go to console
              </button>
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}
