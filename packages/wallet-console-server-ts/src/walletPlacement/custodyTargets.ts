import { isPlainObject, type WalletRuntimeServiceBinding } from '@seams/wallet-server/cloud-host';
import type {
  CustodyRole,
  CustodyNamespace,
  RelocationCustodyNamespaces,
} from '../tenantDeployment/custodyResourceVerification';
import { WalletPlacementError, type WalletHome, type WalletRegion } from './home';
import {
  preparationEvidenceDigest,
  type WalletRelocationParticipants,
} from './relocationPreparation';

type WalletRole = Exclude<CustodyRole, 'presignSessions'>;
type Command = Parameters<WalletRelocationParticipants['router']['prepare']>[0];
export type CustodyTarget = CustodyNamespace & {
  readonly region: WalletRegion;
  readonly generation: number;
  readonly objectName: string;
  readonly objectId: string;
  readonly observedLocation: { readonly colo: string; readonly country: string };
};
export type CustodyTargetPair = {
  readonly source: CustodyTarget;
  readonly destination: CustodyTarget;
};

export class CustodyTargetInspector {
  constructor(
    private readonly source: WalletHome,
    private readonly destination: WalletHome,
    private readonly namespaces: RelocationCustodyNamespaces,
    private readonly sourceRuntime: WalletRuntimeServiceBinding,
    private readonly destinationRuntime: WalletRuntimeServiceBinding,
  ) {}

  async wallet(role: WalletRole, command: Command): Promise<CustodyTargetPair> {
    const sourceName = await walletObjectName(role, command, command.request.expectedGeneration);
    const destinationName = await walletObjectName(role, command, command.destinationGeneration);
    return this.inspect(role, sourceName, destinationName, command.request.expectedGeneration);
  }

  async linked(sessionId: string, generation: number): Promise<CustodyTargetPair> {
    const hash = new Uint8Array(
      await crypto.subtle.digest('SHA-256', new TextEncoder().encode(sessionId)),
    );
    let binary = '';
    for (const byte of hash) binary += String.fromCharCode(byte);
    const digest = btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
    const sourceLogical = `${this.namespaces.source.presignSessions.objectNamePrefix}-${digest}`;
    const destinationLogical = `${this.namespaces.destination.presignSessions.objectNamePrefix}-${digest}`;
    return this.inspect(
      'presignSessions',
      generation === 1 ? sourceLogical : `${sourceLogical}/generation/${generation}`,
      `${destinationLogical}/generation/${generation + 1}`,
      generation,
    );
  }

  async inspect(
    role: CustodyRole,
    sourceName: string,
    destinationName: string,
    generation: number,
  ): Promise<CustodyTargetPair> {
    const source = await inspectTarget(
      this.sourceRuntime,
      this.namespaces.source[role],
      this.source,
      role,
      sourceName,
      generation,
      false,
    );
    const destination = await inspectTarget(
      this.destinationRuntime,
      this.namespaces.destination[role],
      this.destination,
      role,
      destinationName,
      generation + 1,
      true,
    );
    if (
      source.accountId === destination.accountId &&
      source.namespaceId === destination.namespaceId &&
      source.objectId === destination.objectId
    )
      invalid('Custody destination resolves to its source');
    return { source, destination };
  }
}

export class CustodyRelocationPreparation {
  constructor(
    private readonly role: WalletRole,
    private readonly inspector: CustodyTargetInspector,
    private readonly participant: WalletRelocationParticipants[WalletRole],
  ) {}

  async prepare(command: Command): Promise<unknown> {
    const targets = await this.inspector.wallet(this.role, command);
    const receipt = await this.participant.prepare(command);
    if (!isPlainObject(receipt) || receipt.kind !== 'prepared') return receipt;
    return {
      ...receipt,
      custodyTargets: targets,
      custodyEvidenceDigest: await preparationEvidenceDigest([
        command.requestDigest,
        this.role,
        targets,
      ]),
    };
  }
}

async function walletObjectName(
  role: WalletRole,
  command: Command,
  generation: number,
): Promise<string> {
  const wallet = command.request.wallet;
  const owner = {
    org_id: wallet.organizationId,
    project_id: wallet.projectId,
    env_id: wallet.environmentId,
    wallet_id: wallet.walletId,
  };
  let logical: string;
  if (role === 'router') {
    return `router-wallet-${await digestText(`seams/router/wallet-do/v2${JSON.stringify([owner, generation])}`)}`;
  }
  if (role === 'signingWorker') {
    const scope = {
      org_id: wallet.organizationId,
      project_id: wallet.projectId,
      project_environment_id: wallet.environmentId,
      wallet_id: wallet.walletId,
    };
    logical = `signing-worker-wallet-${await digestText(`seams/signing-worker/wallet-do/v1${JSON.stringify(scope)}`)}`;
  } else {
    const label = role === 'deriverA' ? 'deriver-a' : 'deriver-b';
    logical = `${label}-wallet-${await digestText(`seams/${label}/wallet-do/v1${JSON.stringify(owner)}`)}`;
  }
  return generation === 1 ? logical : `${logical}/generation/${generation}`;
}

async function inspectTarget(
  runtime: WalletRuntimeServiceBinding,
  namespace: CustodyNamespace,
  home: WalletHome,
  role: CustodyRole,
  objectName: string,
  generation: number,
  destination: boolean,
): Promise<CustodyTarget> {
  const hints = { US: 'enam', WEUR: 'weur', APAC: 'apac', OC: 'oc' } as const;
  const response = await runtime.fetch(
    new Request(
      'https://wallet-runtime.internal/internal/wallet-runtime/v1/relocation/custody-target',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          role,
          object_name: objectName,
          placement: destination
            ? { kind: 'destination', location_hint: hints[home.region] }
            : { kind: 'existing' },
        }),
      },
    ),
  );
  if (response.status !== 200) invalid('Custody target inspection is unavailable');
  const raw: unknown = await response.json();
  if (
    !isPlainObject(raw) ||
    raw.object_name !== objectName ||
    typeof raw.object_id !== 'string' ||
    !/^[a-f0-9]{64}$/u.test(raw.object_id) ||
    !isPlainObject(raw.location) ||
    typeof raw.location.colo !== 'string' ||
    !/^[A-Z]{3}$/u.test(raw.location.colo) ||
    typeof raw.location.country !== 'string' ||
    !/^[A-Z]{2}$/u.test(raw.location.country)
  )
    invalid('Custody target observation is invalid');
  if (destination && !countryMatches(home.region, raw.location.country))
    invalid(`Custody destination is outside ${home.region}: ${raw.location.colo}`);
  return {
    accountId: namespace.accountId,
    namespaceId: namespace.namespaceId,
    workerName: namespace.workerName,
    deploymentId: namespace.deploymentId,
    versionId: namespace.versionId,
    className: namespace.className,
    region: home.region,
    generation,
    objectName,
    objectId: raw.object_id,
    observedLocation: { colo: raw.location.colo, country: raw.location.country },
  };
}

function countryMatches(region: WalletRegion, country: string): boolean {
  switch (region) {
    case 'US':
      return country === 'US';
    case 'WEUR':
      return [
        'GB',
        'IE',
        'FR',
        'DE',
        'NL',
        'BE',
        'LU',
        'CH',
        'AT',
        'ES',
        'PT',
        'IT',
        'DK',
        'SE',
        'NO',
        'FI',
      ].includes(country);
    case 'APAC':
      return ['JP', 'HK', 'SG', 'KR', 'TW', 'IN', 'TH', 'MY', 'ID', 'PH', 'VN'].includes(country);
    case 'OC':
      return country === 'AU' || country === 'NZ';
  }
}

async function digestText(text: string): Promise<string> {
  const bytes = new Uint8Array(
    await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)),
  );
  let hex = '';
  for (const byte of bytes) hex += byte.toString(16).padStart(2, '0');
  return hex;
}

function invalid(message: string): never {
  throw new WalletPlacementError('invalid_record', message);
}

export function parseCustodyTargetPair(raw: unknown, sourceGeneration: number): CustodyTargetPair {
  if (!isPlainObject(raw) || Object.keys(raw).length !== 2)
    invalid('Custody target pair is invalid');
  const source = parseTarget(raw.source, sourceGeneration);
  const destination = parseTarget(raw.destination, sourceGeneration + 1);
  if (
    source.accountId === destination.accountId &&
    source.namespaceId === destination.namespaceId &&
    source.objectId === destination.objectId
  )
    invalid('Custody destination resolves to its source');
  return { source, destination };
}

function parseTarget(raw: unknown, generation: number): CustodyTarget {
  if (
    !isPlainObject(raw) ||
    Object.keys(raw).length !== 11 ||
    typeof raw.accountId !== 'string' ||
    !/^[a-f0-9]{32}$/u.test(raw.accountId) ||
    typeof raw.namespaceId !== 'string' ||
    !/^[a-f0-9]{32}$/u.test(raw.namespaceId) ||
    typeof raw.workerName !== 'string' ||
    !raw.workerName ||
    typeof raw.deploymentId !== 'string' ||
    !raw.deploymentId ||
    typeof raw.versionId !== 'string' ||
    !raw.versionId ||
    typeof raw.className !== 'string' ||
    !raw.className ||
    (raw.region !== 'US' &&
      raw.region !== 'WEUR' &&
      raw.region !== 'APAC' &&
      raw.region !== 'OC') ||
    raw.generation !== generation ||
    typeof raw.objectName !== 'string' ||
    !raw.objectName ||
    typeof raw.objectId !== 'string' ||
    !/^[a-f0-9]{64}$/u.test(raw.objectId) ||
    !isPlainObject(raw.observedLocation) ||
    Object.keys(raw.observedLocation).length !== 2 ||
    typeof raw.observedLocation.colo !== 'string' ||
    !/^[A-Z]{3}$/u.test(raw.observedLocation.colo) ||
    typeof raw.observedLocation.country !== 'string' ||
    !/^[A-Z]{2}$/u.test(raw.observedLocation.country)
  )
    invalid('Custody target is invalid');
  return {
    accountId: raw.accountId,
    namespaceId: raw.namespaceId,
    workerName: raw.workerName,
    deploymentId: raw.deploymentId,
    versionId: raw.versionId,
    className: raw.className,
    region: raw.region,
    generation,
    objectName: raw.objectName,
    objectId: raw.objectId,
    observedLocation: { colo: raw.observedLocation.colo, country: raw.observedLocation.country },
  };
}
