import { test, expect } from '@playwright/test';
import {
  makeApiKeyLookupPrefix,
  makeApiKeyId,
  makeApiKeySecret,
  parseApiKeySecret,
} from '@seams-internal/console-server/apiKeys/secret';

test.describe('console API key secret format', () => {
  test('creates environment-qualified publishable keys', async () => {
    const secret = makeApiKeySecret({
      kind: 'publishable_key',
      environmentId: 'project-a:dev',
    });

    expect(secret).toMatch(/^pk_dev_[A-Za-z0-9]+$/);
    expect(secret).not.toContain('.');
    expect(secret.slice(3)).not.toContain('-');
    expect(secret.length).toBeLessThan(50);
    expect(parseApiKeySecret(secret)).toEqual({ kind: 'publishable_key' });
    expect(makeApiKeyLookupPrefix(secret)).toBe(secret.slice(0, 24));
  });

  test('creates environment-qualified secret keys', async () => {
    const secret = makeApiKeySecret({ kind: 'secret_key', environmentId: 'project-a:prod' });

    expect(secret).toMatch(/^sk_prod_[A-Za-z0-9]+$/);
    expect(secret).not.toContain('.');
    expect(secret.slice(3)).not.toContain('-');
    expect(secret.length).toBeLessThan(50);
    expect(parseApiKeySecret(secret)).toEqual({ kind: 'secret_key' });
  });

  test('rejects dotted and separator-heavy token layouts', async () => {
    expect(parseApiKeySecret('pk_org.part.keypart')).toBeNull();
    expect(parseApiKeySecret('sk_org.part.keypart')).toBeNull();
    expect(parseApiKeySecret('pk_body-with-dash')).toBeNull();
    expect(parseApiKeySecret('sk_unknown_body')).toBeNull();
  });

  test('creates environment-qualified API key IDs', async () => {
    const developmentId = makeApiKeyId({ environmentId: 'project-a:dev' });
    const productionId = makeApiKeyId({ environmentId: 'project-a:prod' });

    expect(developmentId).toMatch(/^ak_dev_[a-f0-9]+$/);
    expect(productionId).toMatch(/^ak_prod_[a-f0-9]+$/);
  });

  test('accepts existing unqualified credentials at the request boundary', async () => {
    expect(parseApiKeySecret('pk_ExistingPublishableCredential123')).toEqual({
      kind: 'publishable_key',
    });
    expect(parseApiKeySecret('sk_ExistingCredential123')).toEqual({ kind: 'secret_key' });
  });

  test('rejects an environment ID without a supported environment key', async () => {
    expect(() =>
      makeApiKeySecret({ kind: 'publishable_key', environmentId: 'environment-a' }),
    ).toThrow('API key environment ID must end with :dev, :staging, or :prod');
  });
});
