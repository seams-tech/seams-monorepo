import { generateKeyPairSync, sign } from 'node:crypto';

export class GithubDeploymentOidcFixture {
  readonly keys = generateKeyPairSync('rsa', { modulusLength: 2048 });

  jwks(): Response {
    return Response.json({
      keys: [{ ...this.keys.publicKey.export({ format: 'jwk' }), kid: 'fixture' }],
    });
  }

  authorization(): string {
    const now = Math.floor(Date.now() / 1000);
    const header = Buffer.from(JSON.stringify({ alg: 'RS256', kid: 'fixture' })).toString(
      'base64url',
    );
    const payload = Buffer.from(
      JSON.stringify({
        iss: 'https://token.actions.githubusercontent.com',
        aud: 'seams-tenant-cutover',
        sub: 'repo:seams-tech@282445520/seams-monorepo@1366871528:environment:production-live-demo',
        repository: 'seams-tech/seams-monorepo',
        ref: 'refs/heads/main',
        workflow_ref:
          'seams-tech/seams-monorepo/.github/workflows/deploy-live-demo.yml@refs/heads/main',
        nbf: now - 10,
        exp: now + 300,
      }),
    ).toString('base64url');
    const message = `${header}.${payload}`;
    return `Bearer ${message}.${sign('RSA-SHA256', Buffer.from(message), this.keys.privateKey).toString('base64url')}`;
  }
}
