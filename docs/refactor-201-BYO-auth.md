# Refactor 201 — Bring your own authentication

Status: implemented and published as version 0.28.0 on October 29, 2026. Staging activation is blocked by intermittent GitHub key-fetch failures. Production rollout has not started.

## Implementation record

Public Wallet implementation: `5da65944b` and the read-only UI cleanup `0bea56241` on `seams-wallet/dev`.
The separate test-only commit `02d581705` updates stale VoiceID capture fixture types required by the contract type-check.
Private Console configuration, Gateway routing, and composed acceptance changes accompany this record on `seams-monorepo/dev`.

The SDK provides `authenticate`, `prepareExternalAuth`, `associateExternalAuth`, and `removeExternalAuth`.
Direct Google credentials and backend handoffs establish settings-only sessions.
The hosted wallet retains credentials and binds restoration to the embedding app origin.
Server admission checks the current Console configuration revision, wallet association, and wallet authority.
Signing credentials and custody material remain separate.

Console configuration uses `PUT /console/environments/:environmentId/external-auth` with the existing administration session.
The request body is `{ "kind": "google", "clientId": "..." }` or `{ "kind": "disabled" }`.
The server owns the revision. Provider configuration is read from Console on each external-auth request.
There is no second provider-configuration store in the Wallet database.

Apply Console migration `0111_external_wallet_auth.sql` and Wallet migration `0085_external_wallet_auth.sql` before enabling the feature.
Wallet associations participate in relocation snapshots, freeze checks, and source cleanup.
External sessions and handoffs are re-established after relocation.

Validation:

- Wallet and server builds and type checks pass.
- Intended-contract and wallet-state type checks pass, including invalid external/signing combinations and broad-spread checks.
- `node tests/e2e/external-auth.e2e.mjs` passes through the real verifier, D1, HTTP handlers, packaged iframe, and React settings.
  Evidence: `seams-wallet/.artifacts/external-auth/result.json` and `settings.png`.
- `node tests/e2e/authorization-storage-transfer.e2e.mjs` verifies a populated association survives transfer and is frozen and cleaned correctly.
- The Console account-worker E2E journey verifies the configuration endpoint, server-owned revisions, denied unauthenticated updates, Gateway projection, and sibling-environment isolation.
- Private `pnpm check` passes against built candidate packages, including all 53 script checks. Temporary dependency substitutions are restored afterward.
- The public bloat check passes.
- The existing hosted-auth UI suite reports three passes and three environment failures. Chromium blocks its HTTPS test stub from fetching the loopback setup endpoint.
  The new BYO auth scenario passes with the actual packaged iframe on its supported local origins.

Release record:

- The user approved promotion of the full public and private `dev` scope.
- All four public packages are published at `0.28.0`: Wallet, Wallet Server, VoiceID, and Wallet CLI.
- Public source revision: `1de29b2aba77011193384b30f1f57542d11972d6`. The iframe protocol is `18.0.0`.
- [Public validation](https://github.com/seams-tech/seams-wallet/actions/runs/40881143738) and [package publication](https://github.com/seams-tech/seams-wallet/actions/runs/40881193152) passed.
- [CLI signing](https://github.com/seams-tech/seams-monorepo/actions/runs/40882183844) passed. A fresh registry install reports `seams-wallet 0.28.0`.
- Registry checksums match the verified release artifacts. Private consumers use exact `0.28.0` pins.
- The BYO auth E2E also passed against the production assets from the release workflow.

Deployment record (October 30, 2026, Japan time):

- Private release revision: `454ba04a050c7ea5b7f16eb62c77767b614a09de` on `dev`.
- `pnpm check` passed with registry packages, including all 53 existing script checks. Frozen installation passed.
- [Staging rollout](https://github.com/seams-tech/seams-monorepo/actions/runs/40897735808) completed backend builds, migrations, service deployments, and Console deployment.
- Activation failed in four attempts. Three attempts reached final cutover and reported `GitHub OIDC keys are unavailable`.
  The other attempt returned HTTP 401 during regional verification and did not preserve its error body.
- Earlier resource checks succeeded through the same key-fetch function. A permanent inability to fetch keys is therefore unproven.
- An invalid-key diagnostic reproduced the key-fetch error on the unchanged production-testnet Console.
  Mainnet fetched keys and correctly rejected the deliberately unknown signing key.
  These diagnostics could not authorize any state change.
- The upstream HTTP status remains unknown. The evidence supports an intermittent external dependency failure.
- Staging activation and frontend deployment remain incomplete. Private `main`, production, and GetSignal deployments remain unchanged.
- Staging and mainnet recovery trust bindings match the pre-deployment data byte for byte.
- Retry the failed activation and dependent frontend job with `gh run rerun 40897735808 --failed` after key retrieval recovers.
  Require staging success before promoting private `dev` to `main` and deploying production and GetSignal.
- Local evidence: `.artifacts/release-0.28.0/status.json`, `recovery-before.json`, and `recovery-after.json`.

Integration conditions:

1. An actual Google user SSO acceptance run remains unverified. The service-account fixture has a different authorized party.
2. GetSignal uses the existing Google SSO credential. Its private source is not required for the SDK release or deployment.
3. The application must invoke the published SDK exchange and logout methods. Existing wallets require an owner-approved association.
   The [integration guide](../../seams-wallet/docs/auth-provider-integrations/google-oidc.md) describes the browser and backend paths.

The original implementation plan follows. The integration conditions above remain explicit.

## Outcome

Let GetSignal reuse its Google login to open the linked Seams wallet and its settings.
Returning users must not complete another login merely to view their wallet.
Provide a BYO auth contract that can support additional verified providers later.
Support applications that receive provider credentials in either the browser or their backend.

The first release grants authenticated settings access.
Signing readiness remains a separate state with explicit authorization and custody requirements.
Full signing unlock through external authentication requires the custody extension described below.
Do not describe settings access as full signing unlock in the API or documentation.

This plan owns the cross-repository change.
Implement public Wallet behavior in `seams-wallet` and private configuration and composition in `seams-monorepo`.
Keep one implementation of each verification and session operation.

## Current behavior and reusable code

The following paths are relative to `seams-wallet`:

| Location | Current responsibility | Planned use |
| --- | --- | --- |
| `packages/wallet/src/SeamsWeb/publicApi/types.ts` | Public authentication commands and Google Email OTP input | Add external authentication commands and precise result types |
| `packages/wallet-server/src/router/cloudflare/d1/oidc/googleOidcToken.ts` | Google token verification | Reuse signature and claim verification with application-scoped trust |
| `packages/wallet-server/src/router/cloudflare/d1/oidc/d1OidcBoundary.ts` | JWT parsing, claims, and public-key cache | Keep raw token validation at this boundary |
| `packages/wallet-server/src/authorization/` | Admission and operation permissions | Admit settings access and reject unauthorized operations |
| `packages/wallet-server/src/router/cloudflare/d1/authorization/` | Persisted authorization and projections | Reuse storage and revocation patterns |
| `packages/wallet/src/core/types/seams.ts` | Authentication, identity, and capability projections | Represent external authentication without inventing signing readiness |
| `packages/wallet/src/react/context/walletSessionReadiness.ts` | UI readiness | Admit the new authenticated state through explicit domain checks |
| `packages/wallet/src/SeamsWeb/walletIframe/` | Client commands and wallet-host handlers | Carry authentication and handoff messages across the existing boundary |
| `packages/wallet/src/react/components/AccountMenuButton/` | Settings screens and sensitive actions | Render permitted data and request additional proof per action |

Today, `requestEmailCode({ method: 'google', idToken, target })` still requires Email OTP.
The public `unlock` command accepts no external WebAuthn response.
The current auth-method plugin union supports VoiceID and is not a general provider-verification interface.
Do not repurpose that plugin union to accept arbitrary provider tokens.

Current provider documentation explicitly excludes external tokens from wallet authorization.
Update that contract when the new behavior ships.
The existing enterprise SSO proposal concerns Console operators and remains a separate responsibility.

## Release scope

| Capability | First release |
| --- | --- |
| Existing Google login opens an associated wallet | Supported |
| Browser passes an existing Google ID token | Supported |
| Backend exchanges a Google ID token for a browser handoff | Supported |
| View addresses, authentication-method summaries, and device summaries | Supported through scoped read permission |
| View settings and change local presentation preferences | Supported |
| Modify authentication methods, devices, custody, or recovery | Existing owner authorization remains required |
| Sign transactions using only the external-auth session | Excluded |
| Export keys or reveal recovery codes | Existing operation-specific approval remains required |
| Arbitrary app cookies, unsigned claims, or caller-selected JWT issuers | Excluded |
| Additional OIDC providers or app-issued credentials | Follow the extension contract after provider qualification |
| Reuse an arbitrary WebAuthn response | Excluded from this release |

Audit each settings request and response before granting read permission.
Exclude encrypted custody material, secret backups, signing capabilities, and unnecessary personal data from settings responses.
An opaque session credential is a secret even when it grants only read access.

## Trust and wallet associations

Configure provider trust through the existing application configuration and authenticated administration path.
Use the established application and tenant identifiers throughout the exchange.
Do not add a separate configuration manifest or a global audience allowlist shared across tenants.

The Google configuration must identify its permitted client IDs and allowed application origins.
Resolve the configuration before verifying the token.
The request cannot supply trusted issuer URLs, key endpoints, audiences, or permission grants.
Verify signature, issuer, audience, expiry, and applicable authorized-party constraints at the server boundary.
Validate request correlation and nonce claims where the supported login flow supplies them.
Do not claim that an existing ID token proves a newly generated challenge.

Normalize verified evidence into a narrow internal value with these required facts:

- Application and tenant identity.
- Provider configuration identity and current configuration revision.
- Canonical issuer and stable provider subject.
- Verification time and credential expiry.
- Verified audience and the supported proof kind.

Use the provider subject, such as Google's `sub`, for identity association.
Email addresses are display or delivery data and cannot establish the association.
Google documents its identity checks in [Verify the Google ID token](https://developers.google.com/identity/gsi/web/guides/verify-google-id-token).

Persist an explicit association between the application, provider identity, wallet, and authorizing wallet authority.
Choose association cardinality from current wallet ownership rules before adding a uniqueness constraint.
Require explicit wallet selection when a subject has several associated wallets.
A caller-supplied wallet ID is a selector and grants no authority.

For an existing wallet, require current owner authorization and verified provider evidence to create the association.
This is a one-time association step.
Existing Google-assisted Email OTP records can support migration only after their exact ownership meaning is verified.
Do not silently broaden those records into new permissions.

For new wallets, establish the association during successful wallet registration after its existing custody requirements complete.
This release does not remove wallet registration or custody setup requirements.
Removing an association or its authorizing authority revokes its external-auth sessions and pending handoffs.
Disabling provider trust must prevent new exchanges and invalidate sessions governed by that trust.

## Public contract and exchange paths

The following calls describe the proposed public shape.
Confirm naming against the existing SDK facade during implementation.
The application context comes from the configured SDK instance.

```ts
const result = await seams.auth.authenticate({
  method: 'google',
  idToken,
  walletId,
});
```

This command returns a Result-style union.
Success means the hosted wallet installed an authenticated session with explicit settings permission.
It does not report signing readiness merely because provider verification succeeded.
Errors distinguish invalid credentials, expired credentials, absent associations, revoked access, and configuration failures where disclosure is appropriate.
Unauthenticated errors must not reveal another user's wallet or association records.

### Direct credential path

1. GetSignal completes its existing Google login.
2. Its browser passes the existing ID token and wallet selection to the SDK.
3. The hosted wallet submits the credential through the configured application boundary.
4. The server verifies provider evidence and the active wallet association.
5. The server issues a scoped opaque session through the existing credential-delivery mechanism.
6. The SDK installs the session and loads permitted settings data.

An ID token is a bearer credential.
Request correlation does not make a stolen token unusable.
Keep tokens out of URLs, logs, durable browser storage, analytics, and retained test artifacts.
Apply the existing request limits and origin controls without treating an Origin header as proof of user identity.

### Backend credential path

Use this path when GetSignal retains its Google ID token on the backend.
The browser receives only a short-lived handoff code.

1. The hosted SDK prepares an exchange attempt bound to its current application and browser instance.
2. GetSignal sends that attempt to its backend through its authenticated application session.
3. The backend authenticates to Seams using the existing application-server authentication mechanism and submits the Google token with the attempt.
4. Seams verifies the same provider evidence and wallet association used by the direct path.
5. Seams returns an opaque, short-lived handoff code bound to the attempt, application, wallet, and permitted session scope.
6. GetSignal passes the code to the SDK, which redeems it within the original hosted attempt.

Consume handoffs atomically and store only a code digest.
Use the existing durable attempt/idempotency mechanism where it fits.
Concurrent redemption must install at most one session.
Define recovery after a lost response through the same bound attempt without creating another session or expanding its expiry.
Reject expired codes and attempts from another browser binding, application, or wallet.

A backend application credential alone cannot assert an arbitrary user's identity in this release.
The backend path still submits verifiable Google evidence.
Applications with only their own session cookie need a separately configured app-issued credential integration.
Do not bypass verification by accepting a backend-supplied subject string.

### Provider extension contract

Both paths converge on verified external identity and one session-issuance operation.
Add future providers as explicit verifier branches with boundary parsers and provider-specific configuration.
Keep the first implementation limited to the branches that actually ship.
Do not build a dynamic plugin loader, arbitrary verification webhook, or general claim-mapping language.

An app-issued credential integration must define issuer trust, signing keys, audience, expiry, subject mapping, and revocation semantics.
It changes which party can assert user identity and needs explicit application configuration.
Qualify each supported provider with an E2E contract before documenting support.

External WebAuthn support requires a separate challenge-creation contract, enrolled credential binding, and relying-party/origin validation.
A response from an unrelated login challenge cannot be accepted as wallet owner proof.
Any custody use must also establish the required credential-derived material.

## Session state, settings, and lifecycle

Extend the existing authentication and capability domains using discriminated unions and branch-specific builders.
Represent externally authenticated settings access separately from owner authentication and usable signing capabilities.
Require identity, association, scope, expiry, and server session identity in the applicable branches.
Reject invalid combinations with the repository's exclusive-union and `never` patterns.
Use exhaustive switches and Result-style recoverable failures.
Normalize persisted records, route bodies, iframe messages, and provider results once at their boundaries.

Do not introduce broad optional fields, domain casts, lifecycle object spreads, or a parallel `isLoggedIn` flag.
Settings admission must check domain state and server permission.
Diagnostics and display projections cannot authorize an operation.
Reuse existing session storage and revocation mechanisms where they express the narrower scope safely.
Do not mint signing quotas, owner proof, or lane capabilities for settings access.

Use the same settings screens for every supported authentication source.
Request existing wallet proof when the user selects a sensitive operation.
Bind that approval to the selected wallet and action through existing operation authorization.
Keep secret material inside the wallet origin and its cryptographic runtime.

Lifecycle requirements:

- Reload restores only an unexpired, server-valid session for the same application and wallet.
- Token expiry, wallet-session expiry, and application-session expiry remain explicit, separate facts.
- The provider token must be valid at exchange time. Set a bounded wallet-session lifetime through server policy.
- An existing application cookie cannot refresh a wallet session without a supported exchange credential.
- GetSignal logout invokes wallet logout and revokes the associated browser session.
- Account switching cancels pending attempts and clears the previous account's state before installing another session.
- A late exchange result cannot restore the previous user's wallet after logout or account switching.
- Explicit wallet lock remains effective until another deliberate authentication request. Background effects must not immediately undo it.
- Revocation is enforced on protected server requests even when a client retains old state.

Do not promise immediate Google logout detection from offline ID-token validation.
Document the actual session lifetime and supported revocation behavior.

## Implementation sequence

### 1. Confirm integration inputs and behavior contracts

- Inspect GetSignal's Google callback, ID-token retention, session refresh, and logout paths when its source is available.
- Select the direct or backend path for GetSignal from that evidence.
- Inventory settings endpoints and their current owner/session admission requirements.
- Identify the existing application configuration, server authentication, session storage, and regional routing boundaries to extend.
- Update the intended behavior contract alongside implementation. Keep this document marked as proposed until then.

Exit: the exchange inputs, permission matrix, association rules, and endpoint ownership are concrete.
GetSignal source was not inspected while writing this plan.

### 2. Implement provider trust and identity associations

- Add precise configuration and persistence types using existing application storage patterns.
- Extend Google verification to use the resolved application's trust configuration.
- Add association creation and removal under current wallet owner authorization.
- Implement revocation for associations and provider configuration changes.
- Keep any persistence migration at the storage boundary and remove replaced paths after cutover.

Exit: verification cannot cross applications, and an unassociated identity cannot access a wallet.

### 3. Implement exchange and session admission

- Implement both direct and backend exchanges through one verified-identity admission path.
- Add bound, expiring handoff attempts and atomic consumption.
- Issue only the documented settings scope.
- Update settings endpoints to admit this scope and retain sensitive-operation checks.
- Route issuance and revocation through the wallet's authoritative home storage to avoid regional replay races.

Exit: protected settings reads succeed, while owner and signing operations reject the same credential.

### 4. Integrate the SDK and settings UI

- Add public commands, iframe messages, host handlers, and boundary parsing.
- Extend authentication state, session restoration, and readiness checks.
- Open the existing settings UI after exchange without another login prompt.
- Handle logout, explicit lock, account switching, and late responses.
- Preserve the existing sensitive-action flows and remove superseded UI gates.

Exit: one Google login opens settings, and state cannot leak across accounts.

### 5. Integrate GetSignal and publish documentation

- Connect GetSignal's existing login completion to the selected SDK exchange path.
- Add a one-time association flow for existing users who lack an authorized binding.
- Integrate logout and account switching with wallet lifecycle operations.
- Document browser and backend examples, errors, permissions, and session expiry.
- Update `docs/auth-provider-integrations/`, authentication guides, and the relevant specification sections in `seams-wallet`.
- Replace the provider guide's missing `docs/saas/bring-you-own-auth.md` reference with the maintained integration documentation.
- Preserve the separate Console operator SSO model.

Exit: GetSignal demonstrates the complete flow with the released SDK contract.

## Repository ownership and release order

| Repository | Responsibility |
| --- | --- |
| `seams-wallet` | Public SDK, hosted wallet protocol, provider verification, session permissions, Wallet storage, settings UI, public docs, and Wallet contracts |
| `seams-monorepo` | Application trust configuration through Console, gateway composition and routing, exact package pins, and private composed acceptance |
| GetSignal source repository | Existing login callback, backend exchange if needed, association UX, account switching, and logout integration |

Private integration points include `packages/wallet-console-server-ts/src/router/projectEnvironmentAdapter.ts` and `packages/wallet-console-server-ts/src/walletPlacement/`.
Confirm the authoritative configuration owner before adding fields.
Consume exact public package releases in private consumers instead of copying Wallet code here.
Deploy storage and server support before enabling an application's trust configuration and updated frontend.
Configuration represents supported provider trust, with no legacy behavior flag or alternate compatibility implementation.
Disabling trust must revoke its sessions while preserving established owner authentication methods.

## Verification and completion evidence

Read each repository's test instructions before adding tests.
Use existing E2E harnesses and shared branch-specific factories.
Do not add unit tests or source-text guards for this work.

| E2E scenario | Required result |
| --- | --- |
| Existing wallet, one-time Google association, later direct login | Same wallet and public keys; settings open without another login |
| Backend-held Google token and hosted handoff | Settings open; provider token never reaches host browser code |
| Handoff redeemed concurrently and response lost | At most one session; bounded recovery uses the same attempt |
| Different subject, wallet, tenant, client ID, or issuer | Admission fails without leaking another wallet's metadata |
| Expired token, expired handoff, or malformed proof | No authenticated state or partial session is installed |
| Settings credential calls signing, export, recovery, or method-change endpoints directly | Server denies access before custody or signing work starts |
| Existing owner proof completes a sensitive action from settings | The normal action succeeds without replacing the wallet or expanding unrelated permission |
| Reload, logout, explicit lock, and account switching during exchange | No old account data or late session restoration |
| Association or provider trust revoked during an active session | Subsequent protected requests and pending handoffs fail |
| Multiple associated wallets | Explicit selection opens only the authorized selected wallet |

Exercise both exchange paths against the real verifier with controlled test identity infrastructure.
Keep one Google-backed staging acceptance run for actual provider integration.
Do not introduce production verification bypasses or replay real production credentials in fixtures.

Add type fixtures for direct invalid object construction, broad spreads, forbidden branch combinations, and settings sessions passed to signing functions.
Use `@ts-expect-error` for compile-time rejection.
TypeScript assertions can bypass types, so inspect affected boundaries for unsafe casts rather than claiming fixtures prevent every assertion.

Record a repeatable command, Git revisions, exact package versions, and a redacted structured result for each acceptance run.
Include browser screenshots and traces configured to omit tokens, cookies, handoff codes, and secret material.
Record key identity before and after association to prove that wallet keys remain unchanged.
Missing external test credentials are an infrastructure blocker and must not be reported as a passed provider test.

Run public type checks, relevant existing authentication contracts, and `pnpm report:bloat --check` in `seams-wallet` before committing implementation.
Run `pnpm check` in the private repository for shared configuration, protocol, or authorization changes.
Run `pnpm test:scripts` when implementation changes deployment scripts or workflows.
Classify existing failures under the repository policy before repairing them.

## Full signing unlock extension

This release does not make an external identity credential sufficient to decrypt existing custody envelopes.
Full signing unlock requires a separately designed and enrolled custody-access method.
Resolve these questions before implementing that extension:

1. Which party holds each secret needed to open the custody envelope after external verification?
2. What can the application backend, identity provider, and Seams service each access or authorize?
3. How does an existing owner authorize enrollment while preserving the wallet custody seed and public keys?
4. How do fresh browsers, lost devices, provider removal, and account recovery obtain or lose access?
5. Which signing permissions, session limits, and fresh approvals apply after unlock?

An ID token rotates and is not a stable custody-encryption key.
Do not derive custody keys from public identity claims or allow successful provider verification to fabricate a custody proof.
Preserve the distinct manifest-verification and authenticated-envelope proof types.
Any future custody implementation must update the normative specification and applicable cryptographic and E2E contracts together.

## Definition of done

- GetSignal users with an authorized association sign in once and open wallet settings without another authentication prompt.
- Browser credentials and backend handoffs use the same verification and permission model.
- Server checks enforce application, wallet, provider, scope, expiry, and revocation boundaries.
- Existing owner methods and sensitive-action authorization remain functional.
- E2E evidence covers concurrent handoff redemption, account switching, and direct permission-bypass attempts.
- Public packages are released and exact versions are integrated with GetSignal and private consumers.
- Documentation states that Google is the first provider and that full signing unlock requires the separate custody extension.
- Replaced code and obsolete contracts are removed, and completed work is committed on `dev` in its owning repositories.
