import { D1IdentityStore, type D1DatabaseLike } from '@seams/wallet-server/cloud-host';
import { WalletPlacementError, type WalletOwnershipKey } from './home';

export type IdentityCommand =
  | {
      readonly operation: 'find';
      readonly subject: string;
      readonly userId?: never;
      readonly allowMoveIfSoleIdentity?: never;
    }
  | {
      readonly operation: 'list';
      readonly userId: string;
      readonly subject?: never;
      readonly allowMoveIfSoleIdentity?: never;
    }
  | {
      readonly operation: 'link';
      readonly userId: string;
      readonly subject: string;
      readonly allowMoveIfSoleIdentity: boolean;
    }
  | {
      readonly operation: 'unlink' | 'delete';
      readonly userId: string;
      readonly subject: string;
      readonly allowMoveIfSoleIdentity?: never;
    };

type Scope = Pick<
  WalletOwnershipKey,
  'namespace' | 'organizationId' | 'projectId' | 'environmentId'
>;

export async function handleIdentityCommand(
  raw: unknown,
  database: D1DatabaseLike,
  scope: Scope,
): Promise<Response> {
  if (!raw || typeof raw !== 'object' || !('operation' in raw)) throw invalidCommand();
  const store = new D1IdentityStore({
    database,
    namespace: scope.namespace,
    orgId: scope.organizationId,
    projectId: scope.projectId,
    envId: scope.environmentId,
    ensureSchema: false,
  });
  switch (raw.operation) {
    case 'find': {
      const subject = requiredIdentity('subject' in raw ? raw.subject : null);
      return Response.json({ ok: true, userId: await store.getUserIdBySubject(subject) });
    }
    case 'list': {
      const userId = requiredIdentity('userId' in raw ? raw.userId : null);
      return Response.json({ ok: true, subjects: await store.listSubjectsByUserId(userId) });
    }
    case 'link': {
      const userId = requiredIdentity('userId' in raw ? raw.userId : null);
      const subject = requiredIdentity('subject' in raw ? raw.subject : null);
      if (!('allowMoveIfSoleIdentity' in raw) || typeof raw.allowMoveIfSoleIdentity !== 'boolean')
        throw invalidCommand();
      return Response.json(
        await store.linkSubjectToUserId({
          userId,
          subject,
          allowMoveIfSoleIdentity: raw.allowMoveIfSoleIdentity,
        }),
      );
    }
    case 'unlink':
    case 'delete': {
      const userId = requiredIdentity('userId' in raw ? raw.userId : null);
      const subject = requiredIdentity('subject' in raw ? raw.subject : null);
      const result =
        raw.operation === 'unlink'
          ? await store.unlinkSubjectFromUserId({ userId, subject })
          : await store.deleteSubjectLinkForDevCleanup({ userId, subject });
      return Response.json(result);
    }
    default:
      throw invalidCommand();
  }
}

function requiredIdentity(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0 || value.trim() !== value)
    throw invalidCommand();
  return value;
}
function invalidCommand(): WalletPlacementError {
  return new WalletPlacementError('invalid_input', 'Invalid identity command');
}
