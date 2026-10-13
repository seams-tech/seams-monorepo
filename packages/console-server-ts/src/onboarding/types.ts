import type { ConsoleOrganization, ConsoleProject } from '../orgProjectEnv';

export type GetConsoleOnboardingStateRequest = Readonly<Record<string, never>>;

export type ConsoleOnboardingStep = 'organization' | 'project' | 'complete';
export type ConsoleOnboardingTelemetryOperation = 'state' | 'organization' | 'project';

export interface GetConsoleOnboardingTelemetryRequest {
  windowMinutes?: number;
}

export interface ConsoleOnboardingOrgInput {
  name: string;
  slug?: string;
}

export interface ConsoleOnboardingProjectInput {
  id?: string;
  name: string;
}

export interface CreateConsoleOnboardingOrganizationRequest {
  org: ConsoleOnboardingOrgInput;
}

export interface CreateConsoleOnboardingProjectRequest {
  project: ConsoleOnboardingProjectInput;
  environment?: never;
}

interface ConsoleOnboardingIdentity {
  orgId: string;
  accountReady: true;
}

export type ConsoleOnboardingState = ConsoleOnboardingIdentity &
  (
    | {
        currentStep: 'organization';
        organization: null;
        activeProjectCount: 0;
        hasOrganization: false;
        hasProject: false;
        organizationReady: false;
        projectReady: false;
        onboardingComplete: false;
        complete: false;
        selectedProjectId: null;
      }
    | {
        currentStep: 'project';
        organization: ConsoleOrganization;
        activeProjectCount: 0;
        hasOrganization: true;
        hasProject: false;
        organizationReady: true;
        projectReady: false;
        onboardingComplete: false;
        complete: false;
        selectedProjectId: null;
      }
    | {
        currentStep: 'complete';
        organization: ConsoleOrganization;
        activeProjectCount: number;
        hasOrganization: true;
        hasProject: true;
        organizationReady: true;
        projectReady: true;
        onboardingComplete: true;
        complete: true;
        selectedProjectId: string;
      }
  );

export interface ConsoleOnboardingOperationTelemetrySnapshot {
  operation: ConsoleOnboardingTelemetryOperation;
  requestCount: number;
  successCount: number;
  errorCount: number;
  errorRatePercent: number;
  latencyAvgMs: number;
  latencyP50Ms: number;
  latencyP95Ms: number;
  latencyMaxMs: number;
  slo: {
    p95LatencyMsThreshold: number;
    errorRatePercentThreshold: number;
    p95LatencyOk: boolean;
    errorRateOk: boolean;
  };
}

export type ConsoleOnboardingTelemetryAlertCode =
  | 'onboarding_latency_slo_breached'
  | 'onboarding_error_rate_slo_breached';

export interface ConsoleOnboardingTelemetryAlert {
  code: ConsoleOnboardingTelemetryAlertCode;
  operation: ConsoleOnboardingTelemetryOperation;
  severity: 'WARN' | 'CRITICAL';
  message: string;
}

export interface ConsoleOnboardingTelemetrySnapshot {
  orgId: string;
  generatedAt: string;
  windowMinutes: number;
  operations: ConsoleOnboardingOperationTelemetrySnapshot[];
  alerts: ConsoleOnboardingTelemetryAlert[];
}

export interface CreateConsoleOnboardingProjectResult {
  project: ConsoleProject;
  created: {
    project: boolean;
  };
  state: ConsoleOnboardingState;
}

export interface CreateConsoleOnboardingOrganizationResult {
  organization: ConsoleOrganization;
  created: {
    organization: boolean;
    owner: boolean;
  };
  state: ConsoleOnboardingState;
}
