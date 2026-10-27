import React from 'react';
import { GoogleSignInButton } from './GoogleSignInButton';
import { ProviderMark } from './ProviderMark';

export interface DashboardAuthCardClassNames {
  root: string;
  header: string;
  heading: string;
  copy: string;
  ctaGroup: string;
  ctaButton: string;
  ctaIcon: string;
  note: string;
  error: string;
}

type DashboardAuthProviderCommon = {
  label: string;
  disabled: boolean;
};

export type DashboardAuthProvider = DashboardAuthProviderCommon &
  (
    | {
        id: 'google';
        clientId: string;
        oneTap: 'enabled' | 'disabled';
        onCredential: (idToken: string) => void;
        onError: (message: string) => void;
        onContinue?: never;
      }
    | {
        id: 'github';
        onContinue: () => void;
        clientId?: never;
        oneTap?: never;
        onCredential?: never;
        onError?: never;
      }
  );

export interface DashboardAuthCardProps {
  classNames: DashboardAuthCardClassNames;
  titleId: string;
  title: string;
  description: string;
  providers: readonly DashboardAuthProvider[];
  note?: string;
  errorMessage?: string;
}

function DashboardAuthProviderButton({
  classNames,
  provider,
}: {
  classNames: DashboardAuthCardClassNames;
  provider: DashboardAuthProvider;
}): React.JSX.Element {
  if (provider.id === 'google') {
    return (
      <GoogleSignInButton
        clientId={provider.clientId}
        oneTap={provider.oneTap}
        disabled={provider.disabled}
        label={provider.label}
        className={classNames.ctaButton}
        iconClassName={classNames.ctaIcon}
        onCredential={provider.onCredential}
        onError={provider.onError}
      />
    );
  }
  return (
    <button
      type="button"
      className={classNames.ctaButton}
      onClick={provider.onContinue}
      disabled={provider.disabled}
    >
      <span className={classNames.ctaIcon} aria-hidden="true">
        <ProviderMark provider="github" />
      </span>
      <span>{provider.label}</span>
    </button>
  );
}

export function DashboardAuthCard({
  classNames,
  titleId,
  title,
  description,
  providers,
  note,
  errorMessage,
}: DashboardAuthCardProps): React.JSX.Element {
  const providerButtons: React.JSX.Element[] = [];
  for (const provider of providers) {
    providerButtons.push(
      <DashboardAuthProviderButton key={provider.id} classNames={classNames} provider={provider} />,
    );
  }
  return (
    <div className={classNames.root} aria-labelledby={titleId}>
      <div className={classNames.header}>
        <div className={classNames.heading}>
          <h1 id={titleId}>{title}</h1>
        </div>
      </div>
      {/* keyed so that a new status line can fade in */}
      <p key={description} className={classNames.copy}>
        {description}
      </p>
      <div className={classNames.ctaGroup}>{providerButtons}</div>
      {note ? <p className={classNames.note}>{note}</p> : null}
      {errorMessage ? (
        <p className={classNames.error} role="alert">
          {errorMessage}
        </p>
      ) : null}
    </div>
  );
}

export default DashboardAuthCard;
