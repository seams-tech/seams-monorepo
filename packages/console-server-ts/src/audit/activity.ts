import type { ConsoleAuditActivityBin } from './types';

export const MAX_AUDIT_ACTIVITY_BINS = 200;

export interface AuditActivityWindow {
  readonly fromMs: number;
  readonly toMs: number;
  readonly bins: number;
}

export function auditActivityWindow(from: string, to: string, bins: number): AuditActivityWindow {
  const fromMs = Date.parse(from);
  return { fromMs, toMs: Math.max(fromMs, Date.parse(to)), bins };
}

/* Integer arithmetic, so the D1 query (`(at - from) * bins / span`) and this
   function place an event in the same bin. The final bin is closed at both
   ends: an event exactly on `toMs` counts in it. */
export function auditActivityBinIndex(window: AuditActivityWindow, atMs: number): number {
  const span = Math.max(1, window.toMs - window.fromMs);
  return Math.min(window.bins - 1, Math.floor(((atMs - window.fromMs) * window.bins) / span));
}

export function emptyAuditActivityBins(window: AuditActivityWindow): ConsoleAuditActivityBin[] {
  const span = window.toMs - window.fromMs;
  return Array.from({ length: window.bins }, (_unused, index) => ({
    startMs: window.fromMs + (span * index) / window.bins,
    endMs: window.fromMs + (span * (index + 1)) / window.bins,
    total: 0,
    failures: 0,
  }));
}
