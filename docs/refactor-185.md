# Refactor 185: Seams wallet or external wallet

Status: implemented on dev; release adoption and remaining real-wallet qualification are pending.
Date: 2026-10-26.

## Outcome

Users can choose how to sign transactions within Seams:

- **Use a Seams wallet:** create or unlock a Seams threshold wallet.
- **Connect an existing wallet:** select a browser extension and approve requests there.

The first release adds Meteor, HOT, and Intear for NEAR and exposes the existing EVM extension
connector through the same entry point. External users can transact without
creating or unlocking a Seams wallet. Each transaction uses the selected account
and its wallet's signing capability.

This plan covers the public SDK and the private Seams demo. Public implementation
belongs in `seams-wallet`. Private composition belongs in `seams-monorepo`.

## Current behavior

Paths in this section are relative to the named repository.

| Repository       | Existing surface                                                                           | Reuse or required change                                                                   |
| ---------------- | ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------ |
| `seams-wallet`   | `packages/wallet/src/externalEvm/`                                                         | Reuse provider discovery, connection state, signing, and receipt handling.                 |
| `seams-wallet`   | `packages/wallet/src/react/externalEvm.tsx`                                                | Reuse the controller subscription and explicit wallet selection patterns.                  |
| `seams-wallet`   | `packages/wallet/package.json`                                                             | Extend the existing public entry-point pattern for NEAR.                                   |
| `seams-wallet`   | `docs/intended-behaviours.md` and `docs/spec-7-hosted-surfaces-and-provider-boundaries.md` | Add NEAR connection and account-source contracts.                                          |
| `seams-monorepo` | `apps/wallet-console/src/components/DemoPasskeyColumn.tsx`                                 | Add the wallet choice before the existing Seams login flow.                                |
| `seams-monorepo` | `apps/wallet-console/src/flows/demo/DemoPage.tsx`                                          | Replace the blanket Seams-login gate with account-source-specific rendering.               |
| `seams-monorepo` | `apps/wallet-console/src/flows/demo/hooks/`                                                | Separate external transaction and funding requirements from threshold wallet requirements. |

The EVM connector supports MetaMask, Rabby, and Phantom EVM providers. It uses
EIP-6963 discovery and EIP-1193 requests. These standards define extension
discovery and communication. The connector does not currently use WalletConnect.

No external NEAR connector was found in the inspected SDK. The private demo
currently derives transaction readiness from Seams login and threshold account
state. Adding a Meteor picker alone would leave external users unable to transact.

## Scope and boundaries

The initial supported path is a desktop browser with Meteor installed. Retain
the existing EVM connector's support boundaries. Qualify each exposed wallet,
network, and browser combination before listing it as supported.

Include connection, account selection, disconnect, NEAR transaction submission,
and verified transaction outcomes. Include NEP-413 message signing when the
selected adapter and wallet support it. NEP-413 defines NEAR signed messages.

External connections remain separate from Seams authentication and custody:

- Connecting an account grants no Console membership or server session.
- External accounts never become Seams Wallet Sessions or threshold signing lanes.
- Private keys remain with the external wallet.
- External transactions use the provider's approval and submission flow.
- Seams unlock, recovery, export, and agent-grant controls apply only to Seams wallets.
- Switching sources invalidates prepared requests without silently signing out of either wallet.

Server login through wallet signatures, account linking, custody import, Solana,
mobile transports, and WalletConnect are outside this release. A future server
login flow must verify a scoped, expiring challenge and account ownership.
Connection metadata or a successful transaction cannot substitute for that flow.

## NEAR adapter decision

Use separate direct adapters for the requested wallets. No shared wallet registry
or runtime connector fallback participates in provider selection.

- Meteor uses the captured `meteorComV2` transport. Replies must match the request
  ID. Its handshake can request the same inputs again before approval.
- HOT uses the captured `hotExtension` API. Its documented API has no network
  selector, so this release enables mainnet only.
- Intear uses the V3 popup protocol at `https://wallet.intear.tech`. Every reply
  must match both that origin and the request's popup window.

The Meteor SDK dependency was removed after browser acceptance exposed its Node
Buffer dependency and package validation found missing license metadata. The
replacement keeps only the extension protocol and Borsh transaction encoding.
License notices and packed-package validation pass with the direct adapter.

Wallets retain signing keys and approval. Intear's ephemeral session key only
authenticates protocol requests and is never installed on chain. No adapter
requests an application-held function-call key.

## State and operation contracts

### Module ownership

Keep each chain connector independent. Follow the existing `externalEvm` layout.
The application owns wallet choice and dispatch. A connector owns its provider
connection and chain operations. Neither connector imports the other connector.

```text
seams-wallet/packages/wallet/src/
  externalEvm/              Existing EVM connector
    index.ts               Public exports
    types.ts               Connection, operation, and result types
    boundary.ts            Provider input and response validation
    controller.ts          Connection lifecycle and operations
  externalNear/            New NEAR connector
    index.ts               Public exports
    types.ts               Connection, operation, and result types
    boundary.ts            Provider input and response validation
    controller.ts          Connection lifecycle and operations
    meteor.ts              Meteor adapter and dependency integration
  react/
    externalEvm.tsx         Existing EVM React binding
    externalNear.tsx        NEAR subscription and picker

seams-monorepo/apps/wallet-console/src/flows/demo/
  externalWallets/          Host UI, selected source, and operation dispatch
```

Keep third-party NEAR imports inside `externalNear/meteor.ts`. The controller
uses a narrow internal provider contract with required account, network, and
operation inputs. Validate unknown provider results at the adapter boundary.
Do not expose dependency-specific types in the public SDK API.

Keep React, DOM presentation, Console authentication, and Seams custody out of
connector domain types. React subscribes to controller state and invokes public
operations. The application dispatches through the selected source's capability.

Load the NEAR adapter only when the user selects the NEAR external path.
Importing the EVM connector must not initialize NEAR discovery or load its executor.
Controllers own listener cleanup and stale-operation cancellation. Dependency
listeners and pending requests must have a verified cleanup strategy before adoption.

Reuse existing helpers for validation, results, and exhaustive branches. Share
additional code only when both connectors need the same behavior. Do not add a
universal wallet base class, plugin registry, or generic multi-chain controller.
Keep chain-specific transaction and outcome types explicit.

Adapter qualification must also verify provider identity. An unsolicited iframe
message must not replace the selected Meteor adapter. Wallet display metadata
cannot establish provider identity, even when its wallet ID matches Meteor.

Add an `ExternalNearController` beside `ExternalEvmController`. Keep provider
objects inside the controller. Export normalized account and connection types.
Reuse existing validation helpers and result conventions where they fit.

Model disconnected, connecting, and connected states as discriminated unions.
Connected state requires the selected wallet, selected account, nonempty account
list, configured NEAR network, capabilities, and connection generation.
A generation identifies the connection instance that prepared an operation.
Represent an unavailable signing capability explicitly.

Use branch-specific builders and `never` fields to reject invalid combinations.
Normalize provider responses, persisted hints, and UI selections at their entry
boundaries. Core signing functions require a current connected state and the
specific capability needed by the operation.

In the application, represent the selected source as a union with `none`,
`seams`, `external_near`, and `external_evm` branches. Each active branch carries
its own precise account reference. Keep readiness in the owning domain state.
Use exhaustive switches with `assertNever` to select the correct operation.
Do not add optional external fields to Seams session records or reuse login booleans
to describe external connections.

Add static fixtures for direct object construction, broad spreads, invalid branch
combinations, and cross-source operation inputs. TypeScript can bypass checks
through explicit unsafe assertions. Keep those assertions out of domain code
and inspect changed call sites for them during review.

### Connection lifecycle

- Start discovery in the application document after the external path is selected.
  Keep extension discovery outside the Seams custody iframe.
- Ask for permission only after the user selects a wallet.
- Detect wallet-supported account and connection events. Reconcile state before
  signing and after browser focus returns when the provider lacks reliable events.
- Invalidate prepared operations on source, account, network, or connection changes.
- Ignore late connection results after disconnect, unmount, or a newer attempt.
- Disconnect clears local state and listeners. Describe any provider sign-out
  action separately from on-chain access-key revocation.
- Persist only an optional wallet-selection hint. Restore permission and account
  state through the provider before exposing a usable connection.

### NEAR transactions

Normalize NEAR requests once into the repository's existing action types.
Require the connected signer account, receiver, network, and supported actions.
Keep gas and deposit amounts in exact integer units. Convert to the selected
adapter's format only at the provider boundary.

Use ordinary provider signing and submission for external NEAR accounts. Inspect
the existing demo's delegate-signing and funding dependencies before reusing its
hooks. External accounts must not require threshold authorization or Seams relaying.

Capture the account, network, and generation before approval. A changed connection
blocks new dispatch. A hash returned after dispatch remains associated with the
captured account and network, even if the user switches wallets meanwhile.

Validate responses and resolve execution through the configured NEAR RPC.
Verify the transaction hash and signer before reporting an outcome. Report
success only after final execution succeeds, including relevant receipt outcomes.
Keep execution failure, pending or unresolved confirmation, user rejection,
unsupported capability, malformed response, and unknown submission distinct.

A timeout or transport loss after dispatch must never cause an automatic resend.
Retain a returned hash for status checks. Without a hash, explain that submission
is unknown. Do not claim that a closed approval window proves cancellation.

The first release needs single-transaction submission. Batch submission can wait
until a demonstrated flow needs it and partial outcomes have an explicit contract.
Message signing remains capability-gated and does not establish a Seams session.

## User experience

Present **Use a Seams wallet** and **Connect an existing wallet** at the wallet
entry point. The Seams option opens the existing create/unlock flow. The external
option presents supported networks and wallets, including **NEAR → Meteor**.

Show the active wallet, account, and network beside transaction controls.
Use wallet-specific approval text, such as “Approve in Meteor.” Reserve passkey
and threshold wording for the Seams branch. Provide explicit disconnect and
wallet-switch controls with keyboard access and visible focus.

Render transaction controls for a usable external connection without requiring
`loginState.isLoggedIn` or a Seams `walletId`. Mount source-specific hooks only
for their applicable branch. Keep shared presentation where the behavior matches.
Replace obsolete threshold-only UI assumptions in the same change.

Limit external accounts to their supported chains and operations. A NEAR account
cannot enable EVM controls. Ordinary EVM support does not imply support for every
Tempo-specific transaction or fee-token operation. Qualify those independently.

Check external balances against the connected account. Explain insufficient funds
without invoking threshold account provisioning. Preserve the configured demo
contract, network, and greeting operation wherever the external wallet supports them.

## Implementation sequence

- [ ] **1. Qualify Meteor and record the adapter decision.** Capture the browser,
      extension, package version, network, approval transport, and policy results.
- [ ] **2. Define the SDK contracts in `seams-wallet`.** Update intended behaviors
      and the provider-boundary specification alongside static fixtures.
- [ ] **3. Implement the NEAR controller.** Add the boundary parser, lifecycle,
      transaction submission, outcome observation, and capability-gated messages.
      Expose `@seams/wallet/external-near` and matching React bindings using existing
      package export conventions. Keep NEAR dependencies out of EVM-only imports.
- [ ] **4. Verify and document the public package.** Add a runnable consumer example
      and an external NEAR guide under `apps/docs/src`. Check packed exports and
      declarations, then record the exact package release for private adoption.
- [ ] **5. Compose the wallet choice in `seams-monorepo`.** Consume the exact SDK
      release. Update the entry point, selected-source state, transaction routing,
      account display, funding checks, and disconnect behavior.
- [ ] **6. Complete acceptance and cleanup.** Remove replaced UI paths and temporary
      probes. Retain repeatable evidence and update this plan with result locations.

Keep commits on `dev` in each repository. Preserve unrelated work. Publishing
packages and deploying applications remain separate release actions after validation.
This planning task authorizes the document only.

## Verification and evidence

Use existing browser and E2E infrastructure. Add no unit tests or source-text
guards. Public SDK behavior belongs in `seams-wallet/tests`. Private product
composition belongs in `seams-monorepo/tests`. Use shared factories for complex
domain records. Update the owning behavior specification with its contract test.

### Primary acceptance scenario

Use a dedicated, funded testnet account and a recorded Meteor extension version.

1. Start with no Seams login. Select **Connect an existing wallet → NEAR → Meteor**.
2. Reject the first request. Confirm that the UI allows a fresh connection attempt.
3. Connect and verify the displayed account and network against Meteor.
4. Submit a uniquely identifiable greeting through the existing demo contract.
5. Verify final execution through RPC and read the changed contract state.
6. Change the account or disconnect during a later approval. Confirm that stale
   requests cannot authorize a new dispatch or overwrite the active account.
7. Resolve any submitted transaction against its original account and network.
8. Disconnect and reload. Confirm that no cached hint grants signing readiness.
9. Select the Seams path, unlock, and complete the existing threshold transaction.
10. Return to the external path. Verify correct source routing and account display.

Use controlled provider failures in browser tests for transport loss after
dispatch, malformed results, and unsupported capabilities. These tests complement
the real extension run. A simulated provider cannot establish Meteor compatibility.
Run an EVM extension acceptance case through the new entry point as well.

Each acceptance run must produce a JSON report and a browser trace or screenshots.
Record repository revisions, package and extension versions, browser, network,
public accounts, transaction hashes, final outcomes, contract readback, and exact
rerun commands. Exclude seeds, private keys, session tokens, and authenticated
browser profiles. Repeat runs use a fresh greeting marker and funded test account.

Run targeted browser cases and type fixtures first. Validate shared routing and
public APIs with the relevant broader checks before release:

- In `seams-wallet`: package type checks, `pnpm -C tests type-check:wallet-state`,
  relevant intended-behavior contracts, packed-package checks, and
  `pnpm report:bloat --check` before committing implementation changes.
- In `seams-monorepo`: targeted composition E2E, `pnpm check`, and the affected
  application build against the exact released SDK.

Record actual test commands when cases exist. Classify failures before repair as
production regression, valid test needing update, obsolete fixture, or environment
failure. Report missing extension or RPC evidence as incomplete acceptance.

## Completion criteria

- Both wallet choices work from the same Seams entry point.
- Meteor signs a verified NEAR transaction without a Seams login or custody record.
- Existing EVM extensions work through the new entry point on qualified networks.
- Source changes cannot route a transaction through the wrong wallet.
- Unknown submission outcomes remain visible and never trigger automatic resend.
- Seams threshold transactions still work after switching between wallet sources.
- Public exports, guides, behavior contracts, type fixtures, and private composition agree.
- Repeatable E2E evidence includes a real Meteor extension run and on-chain readback.

## Implementation and verification checkpoint — 2026-10-26

Implemented on dev:

- Separate NEAR types, request validation, lifecycle controller, and wallet adapters.
- Optional Meteor, HOT, and Intear adapters configured through an explicit `wallets` list.
- The picker shows only enabled wallets, in configured order. The demo enables Meteor only.
- `setWallets` updates the list at runtime and disconnects a removed active or connecting wallet.
  An empty list disables all wallets. Disabled adapters stay unloaded.
- Seams versus external wallet choice and separate NEAR/EVM transaction dispatch.
- Pending-request disposal and generation checks that prevent stale completion
  from changing a newer connection's state.
- Submitted-transaction status checks, explicit unknown-submission acknowledgement,
  and retained results when the user changes between Seams and external wallets.
- Lazy browser dependencies, public entry points, documentation, and type fixtures.

Real Meteor testnet acceptance passed in Chrome profile Pta with wallet build
`261022-1955` and account `cyan-loong.testnet`. The transaction called
`set_greeting` on `seams-v1.testnet` with zero deposit. Final execution and exact
contract readback passed. Transaction hash:
`7mHpBFA5B6mmhfuqTxVUhNuixYDqCvkLWCBKAQMD6pxV`.

Evidence lives in
`seams-wallet/docs/evidence/refactor-185-meteor-testnet-20261026.json`.
The repeatable local acceptance page is
`seams-wallet/tests/browser-app/external-wallet-acceptance.html`.

Seven controlled Chromium scenarios pass. They cover the three adapters, stale
requests, transport replacement, popup source binding, handshake replay under one
request ID, disconnect cleanup, transaction encoding, and picker rendering.
The configuration scenario also verifies disabled-wallet rejection, adapter loading,
active-wallet removal, and pending-connection cancellation. Each run writes JSON
observations or screenshots.

SDK type checks, type fixtures, ESM/declaration builds, license notices,
packed-package checks, and the bloat check pass. The private application type-check
uses temporary paths to the new SDK declarations until an exact release exists.
Those paths are not part of repository configuration.

## Rollout order

Meteor is the first release target. HOT follows. Real HOT mainnet connection and
retry after popup cancellation were recorded in `docs/evidence/hot-connection-20261026.json`.
That run submitted no transaction. HOT transaction signing remains unverified.
Keep Intear qualification deferred. EVM connector work is also deferred until the
NEAR rollout has been addressed.

Future delivery work, separate from connector implementation:

1. Finish Meteor's composed product E2E against the packaged SDK: Seams/external
   switching, reconnect, network constraints, and transaction-status rechecks.
2. Prepare the exact SDK release and private-app adoption for the verified Meteor
   path. The current 0.22.0 pin lacks the new NEAR exports. Publication uses the
   existing workflow on `main`; implementation work remains on `dev`.
3. Address Meteor message-signing capabilities where required by the application.
   Account selection currently occurs in the wallet's own connection prompt.
4. Verify HOT transaction signing separately from the completed connection check.
   The connector does not claim HOT testnet support.
5. Revisit Intear real-wallet qualification and EVM work separately.

No upstream issue or PR has been opened. No package or deployment was published.
