import { queryD1One, type D1DatabaseLike } from '@seams/wallet-server/cloud-host';
import { decodeTenantDeploymentBindingV1 } from '@seams-internal/wallet-console-shared/tenant-deployment';
import type { TenantDeploymentBindingV1 } from './types';
import { TenantDeploymentD1ResourceIdentityV1 } from './deploymentResource';
import { storedRuntimeVersionMatches, type TenantRuntimeWriterV1 } from './resourceVerification';
import { TenantDeploymentStoreError } from './service';

export type RegionalDeploymentAdmission = {
  readonly binding: TenantDeploymentBindingV1;
  readonly activationSequence: number;
  readonly resourceVerificationsJson: string;
};

type RegionalDeploymentState =
  | { readonly kind: 'missing'; readonly admission?: never }
  | { readonly kind: 'prepared'; readonly admission: RegionalDeploymentAdmission }
  | { readonly kind: 'active'; readonly admission: RegionalDeploymentAdmission };

export interface RegionalDeploymentInstaller {
  prepare(admission: RegionalDeploymentAdmission): Promise<void>;
  activate(admission: RegionalDeploymentAdmission): Promise<void>;
}

// Called only by the private deployment control route and the local development host.
export class D1RegionalDeploymentAdmission implements RegionalDeploymentInstaller {
  constructor(
    private readonly database: D1DatabaseLike,
    private readonly resource: TenantDeploymentD1ResourceIdentityV1,
  ) {}

  async prepare(admission: RegionalDeploymentAdmission): Promise<void> {
    this.assertResource(admission);
    await this.database
      .prepare(
        `INSERT INTO regional_deployment_admissions
         (deployment_lane, namespace, account_id, database_id, activation_sequence,
          binding_revision, binding_json, resource_verifications_json, state)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, 'prepared')
       ON CONFLICT(deployment_lane, namespace, account_id, database_id) DO UPDATE SET
         activation_sequence = excluded.activation_sequence,
         binding_revision = excluded.binding_revision,
         binding_json = excluded.binding_json,
         resource_verifications_json = excluded.resource_verifications_json,
         state = 'prepared'
       WHERE regional_deployment_admissions.activation_sequence < excluded.activation_sequence
          OR (regional_deployment_admissions.activation_sequence = excluded.activation_sequence
              AND regional_deployment_admissions.state = 'prepared')`,
      )
      .bind(...this.values(admission))
      .run();
    const row = await this.read(admission.binding.deploymentLane);
    if (row.kind === 'missing' || !sameAdmission(row.admission, admission)) {
      throw new TenantDeploymentStoreError(
        'activation_conflict',
        'Regional deployment preparation conflicts',
      );
    }
  }

  async activate(admission: RegionalDeploymentAdmission): Promise<void> {
    this.assertResource(admission);
    // A competing preparation can replace the proposal. Only the Console winner activates.
    await this.database
      .prepare(
        `UPDATE regional_deployment_admissions
          SET state = 'active', binding_revision = ?6, binding_json = ?7,
              resource_verifications_json = ?8
        WHERE deployment_lane = ?1 AND namespace = ?2 AND account_id = ?3 AND database_id = ?4
          AND activation_sequence = ?5
          AND (state = 'prepared' OR
               (state = 'active' AND binding_json = ?7 AND resource_verifications_json = ?8))`,
      )
      .bind(...this.values(admission))
      .run();
    const row = await this.read(admission.binding.deploymentLane);
    if (row.kind !== 'active' || !sameAdmission(row.admission, admission)) {
      throw new TenantDeploymentStoreError(
        'activation_conflict',
        'Regional deployment activation conflicts',
      );
    }
  }

  async resolveRuntimeBinding(
    deploymentLane: string,
    writer: TenantRuntimeWriterV1,
  ): Promise<TenantDeploymentBindingV1 | null> {
    const row = await this.read(deploymentLane);
    if (row.kind !== 'active') return null;
    if (
      writer.resource.accountId !== this.resource.accountId ||
      writer.resource.databaseId !== this.resource.databaseId ||
      !storedRuntimeVersionMatches(row.admission.resourceVerificationsJson, writer)
    ) {
      throw new TenantDeploymentStoreError(
        'activation_conflict',
        'Regional deployment writer is retired or unverified',
      );
    }
    return row.admission.binding;
  }

  private assertResource(admission: RegionalDeploymentAdmission): void {
    if (
      admission.binding.tenant.namespace !== this.resource.namespace ||
      !admission.binding.resources.some(this.matchesResource.bind(this)) ||
      !Number.isSafeInteger(admission.activationSequence) ||
      admission.activationSequence <= 0
    ) {
      throw new TenantDeploymentStoreError(
        'deployment_resource_conflict',
        'Regional deployment resource differs',
      );
    }
  }

  private matchesResource(resource: TenantDeploymentBindingV1['resources'][number]): boolean {
    return (
      resource.accountId === this.resource.accountId &&
      resource.databaseId === this.resource.databaseId
    );
  }

  private values(admission: RegionalDeploymentAdmission): readonly unknown[] {
    return [
      admission.binding.deploymentLane,
      this.resource.namespace,
      this.resource.accountId,
      this.resource.databaseId,
      admission.activationSequence,
      admission.binding.revision,
      JSON.stringify(admission.binding),
      admission.resourceVerificationsJson,
    ];
  }

  private async read(deploymentLane: string): Promise<RegionalDeploymentState> {
    const row = await queryD1One(
      this.database,
      `SELECT state, activation_sequence, binding_json, resource_verifications_json
         FROM regional_deployment_admissions
        WHERE deployment_lane = ?1 AND namespace = ?2 AND account_id = ?3 AND database_id = ?4`,
      [deploymentLane, this.resource.namespace, this.resource.accountId, this.resource.databaseId],
    );
    if (!row) return { kind: 'missing' };
    if (
      (row.state !== 'prepared' && row.state !== 'active') ||
      typeof row.activation_sequence !== 'number' ||
      !Number.isSafeInteger(row.activation_sequence) ||
      row.activation_sequence <= 0 ||
      typeof row.binding_json !== 'string' ||
      typeof row.resource_verifications_json !== 'string'
    ) {
      throw new TenantDeploymentStoreError(
        'invalid_record',
        'Regional deployment state is invalid',
      );
    }
    const decoded = await decodeTenantDeploymentBindingV1(JSON.parse(row.binding_json));
    if (
      !decoded.ok ||
      decoded.value.deploymentLane !== deploymentLane ||
      decoded.value.tenant.namespace !== this.resource.namespace
    ) {
      throw new TenantDeploymentStoreError(
        'invalid_record',
        'Regional deployment binding is invalid',
      );
    }
    const admission: RegionalDeploymentAdmission = {
      binding: decoded.value,
      activationSequence: row.activation_sequence,
      resourceVerificationsJson: row.resource_verifications_json,
    };
    switch (row.state) {
      case 'prepared':
        return { kind: 'prepared', admission };
      case 'active':
        return { kind: 'active', admission };
    }
  }
}

function sameAdmission(
  left: RegionalDeploymentAdmission,
  right: RegionalDeploymentAdmission,
): boolean {
  return (
    left.activationSequence === right.activationSequence &&
    JSON.stringify(left.binding) === JSON.stringify(right.binding) &&
    left.resourceVerificationsJson === right.resourceVerificationsJson
  );
}
