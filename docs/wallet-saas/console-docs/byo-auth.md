# Bring your own authentication: Console configuration

Use the public integration guides for Wallet behavior and SDK examples:

- [Application sessions and owner approval](https://wallet.seams.sh/docs/guides/application-auth)
  covers trusted application-issuer handoffs, association, and fresh approval for each NEAR operation.
- [Google authentication](https://wallet.seams.sh/docs/guides/google-sso)
  covers direct Google credentials and backend handoffs.
- [Authentication](https://wallet.seams.sh/docs/guides/authentication) and
  [VoiceID](https://wallet.seams.sh/docs/concepts/auth-methods/voiceid) cover Wallet authentication methods.
- [Release notes](https://wallet.seams.sh/docs/releases) identify package versions.

This private guide owns Console configuration. Console administrator authentication
remains separate from application login and Wallet owner authentication.

## Configure environment trust

Use an authenticated Console administration session to call
`PUT /console/environments/:environmentId/external-auth`.
Select one provider configuration for that environment.

For an application issuer, send:

```json
{
  "kind": "application",
  "issuer": "https://app.example.com",
  "publicKeyB64u": "YOUR_ED25519_PUBLIC_KEY_BASE64URL"
}
```

The issuer must be a canonical HTTPS origin, without a path or trailing slash.
The public key must contain 32 Ed25519 bytes in canonical base64url.
Keep the private key on the application backend.
Follow the public application guide to create and exchange signed assertions.

For direct Google trust, send:

```json
{
  "kind": "google",
  "clientId": "YOUR_CLIENT_ID.apps.googleusercontent.com"
}
```

The environment's publishable key must allow the application origin and hosted Wallet origin.
Use that environment ID and publishable key in the SDK configuration.
See [API keys](api-keys.md) for Console credential and origin procedures.

The server owns the configuration revision. Omit it from the update request.
Trust changes increment the revision and invalidate earlier external sessions.
The Wallet reads provider configuration from Console on each external-auth request.
Console remains the configuration store for Console-managed environments.

To disable exchanges and deny existing external sessions, send:

```json
{ "kind": "disabled" }
```

## Historical records

[BYO authentication implementation and release history](../../refactor-201-BYO-auth.md)
retains the 0.28 and 0.29 release evidence, migration conditions, and original design.
