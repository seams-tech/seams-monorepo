export type ConsoleOrganizationStatus = 'ACTIVE';
export type ConsoleProjectStatus = 'ACTIVE' | 'ARCHIVED';

export interface ConsoleOrganization {
  id: string;
  name: string;
  slug: string;
  status: ConsoleOrganizationStatus;
  createdAt: string;
  updatedAt: string;
}

export interface ConsoleProject {
  id: string;
  orgId: string;
  name: string;
  slug: string;
  status: ConsoleProjectStatus;
  createdAt: string;
  updatedAt: string;
}

export interface ListConsoleProjectsRequest {
  status?: ConsoleProjectStatus;
}
export interface SearchConsoleOrganizationsRequest {
  query: string;
  limit?: number;
}
export interface UpsertConsoleOrganizationRequest {
  name?: string;
  slug?: string;
}
export interface CreateConsoleProjectRequest {
  id?: string;
  name: string;
}
export interface UpdateConsoleProjectRequest {
  name?: string;
}
