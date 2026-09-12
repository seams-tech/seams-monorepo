import { expect, test } from '@playwright/test';
import {
  createRouterAbEd25519YaoProductRegistrationStateV1,
  parseRouterAbEd25519YaoProductRegistrationStateV1,
} from '../../packages/wallet-server/src/router/domains/ed25519Yao/capabilityLifecycle/routerAbEd25519YaoProductRegistration';
import {
  encodeRouterAbEd25519YaoProductRegistrationStateV1,
  parseRouterAbEd25519YaoProductRegistrationStateJsonV1,
} from '../../packages/wallet-server/src/router/domains/ed25519Yao/capabilityLifecycle/routerAbEd25519YaoProductRegistrationPersistence';

test('Ed25519 Yao product state decodes into a detached request-owned graph', () => {
  const state = createRouterAbEd25519YaoProductRegistrationStateV1();
  state.registration.lifecycleSessions.set('lifecycle-1', 'session-1');
  state.export.authorizationNonces.add('nonce-1');

  const encoded = encodeRouterAbEd25519YaoProductRegistrationStateV1(state);
  const parsed = parseRouterAbEd25519YaoProductRegistrationStateJsonV1(encoded);

  expect(parsed).not.toBeNull();
  if (parsed === null) throw new Error('expected an encoded state to decode');
  expect(parsed.registration.lifecycleSessions.get('lifecycle-1')).toBe('session-1');
  expect(parsed.export.authorizationNonces.has('nonce-1')).toBe(true);
  parsed.registration.lifecycleSessions.set('lifecycle-1', 'session-2');
  expect(state.registration.lifecycleSessions.get('lifecycle-1')).toBe('session-1');
});

test('Ed25519 Yao product state rejects JSON-shaped lifecycle collections', () => {
  const state = createRouterAbEd25519YaoProductRegistrationStateV1();
  const jsonShapedState = JSON.parse(JSON.stringify(state));

  expect(parseRouterAbEd25519YaoProductRegistrationStateV1(jsonShapedState)).toEqual({
    ok: false,
    message: 'persisted Ed25519 Yao product state has invalid lifecycle collections',
  });
});
