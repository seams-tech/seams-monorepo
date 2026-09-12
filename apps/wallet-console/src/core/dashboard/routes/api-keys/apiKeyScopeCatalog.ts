import type { DashboardScopeOption } from '../../components/ScopePicker';

export type ApiCredentialScope = string;

export type ApiCredentialScopeCatalog = {
  options: readonly DashboardScopeOption<ApiCredentialScope>[];
  defaultScopes: readonly ApiCredentialScope[];
  isScope: (value: string) => boolean;
};
