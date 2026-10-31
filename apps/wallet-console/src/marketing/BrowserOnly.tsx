import React from 'react';

function subscribe(): () => void {
  return unsubscribe;
}

function unsubscribe(): void {}

function browserReady(): boolean {
  return true;
}

function serverReady(): boolean {
  return false;
}

// Hydration starts with the same placeholder that the build renderer produced.
export function BrowserOnly({
  children,
  fallback,
}: {
  children: React.ReactNode;
  fallback: React.ReactNode;
}): React.JSX.Element {
  const ready = React.useSyncExternalStore(subscribe, browserReady, serverReady);
  return <>{ready ? children : fallback}</>;
}
