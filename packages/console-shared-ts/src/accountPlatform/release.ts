import { exactKeys, invalidContract, object, textValue, versionOne } from './boundary';

/**
 * Satyr reports that the native organisation of an instance has ended for
 * good. The account platform then takes the instance through its disable and
 * archive commands, so a project never names a deleted organisation as ready.
 */
export interface SatyrInstanceReleaseRequestV1 {
  readonly version: 1;
  readonly instanceId: string;
  readonly nativeOrganizationId: string;
}

/** `releasing` asks Satyr to report again later; `released` is final. */
export interface SatyrInstanceReleaseV1 {
  readonly state: 'releasing' | 'released';
}

export function readSatyrInstanceReleaseRequestV1(input: unknown): SatyrInstanceReleaseRequestV1 {
  const record = object(input, 'instance release');
  exactKeys(record, ['version', 'instanceId', 'nativeOrganizationId']);
  return {
    version: versionOne(record.version),
    instanceId: textValue(record.instanceId, 'instanceId'),
    nativeOrganizationId: textValue(record.nativeOrganizationId, 'nativeOrganizationId'),
  };
}

export function readSatyrInstanceReleaseV1(input: unknown): SatyrInstanceReleaseV1 {
  const record = object(input, 'instance release state');
  exactKeys(record, ['state']);
  if (record.state !== 'releasing' && record.state !== 'released') return invalidContract('state');
  return { state: record.state };
}
