import type {
  ConsoleAuditCategory,
  ConsoleAuditEvidenceReferenceKind,
} from '@seams-internal/console-server/audit/types';

declare module '@seams-internal/console-server/audit/types' {
  interface ConsoleAuditCategoryExtensions {
    APPROVAL: true;
  }

  interface ConsoleAuditEvidenceReferenceKindExtensions {
    APPROVAL: true;
  }
}

export const WALLET_CONSOLE_AUDIT_CATEGORIES = [
  'APPROVAL',
] as const satisfies readonly ConsoleAuditCategory[];

export const WALLET_CONSOLE_AUDIT_EVIDENCE_REFERENCE_KINDS = [
  'APPROVAL',
] as const satisfies readonly ConsoleAuditEvidenceReferenceKind[];
