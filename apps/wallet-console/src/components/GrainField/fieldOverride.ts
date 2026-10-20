import React from 'react';
import type { GrainFieldName } from './fields';

/* A preview override for every GrainField on the page: while it is set, each
   field draws this one instead of its own. Only the development gradient
   switcher sets it, to compare one gradient across the whole page. */

let current: GrainFieldName | null = null;
const listeners = new Set<() => void>();

export function setGrainFieldOverride(next: GrainFieldName | null): void {
  if (next === current) return;
  current = next;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function snapshot(): GrainFieldName | null {
  return current;
}

function serverSnapshot(): null {
  return null;
}

export function useGrainFieldOverride(): GrainFieldName | null {
  return React.useSyncExternalStore(subscribe, snapshot, serverSnapshot);
}
