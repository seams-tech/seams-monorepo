# Integrate a service with the account platform

The account platform owns users, organisation membership, platform projects, payers, enablement, and money.
The service owns its native content, roles, execution, and operational lifecycle.
Use Satyr as the working integration example.

1. Define the native tenant scope and its uniqueness rule in the shared versioned contract.
   Extend the closed service union and persistence checks through a forward migration.
   Keep other services' native domain records unchanged.
2. Implement an account provisioning adapter with a server-owned native configuration and `consoleHref`.
   Use the existing durable operation, desired revision, payload digest, and receipt boundary.
   Give retries fresh authentication around their original immutable command.
   Preserve an archived binding permanently.
3. Authenticate the producer and the initiating user independently.
   Expose a private named Worker entrypoint through a Cloudflare service binding.
   Fix the producer identity in server configuration and require the binding in the service client.
   Keep `/account-platform/v1/*` unavailable through public fetch.
   Configure paired user assertion audiences and issuers.
   Link verified issuer and subject evidence, or an explicit authenticated account link.
   Never infer a user or tenant merge from an email or service access.
4. Resolve fresh shared eligibility for execution, protected disclosure, restore, and replay.
   Retain the service's native role, project, source, history, capability, readiness, and placement checks.
   Deny protected work during an authority outage.
   Pin grant revisions to native authority and finish revocation cleanup before releasing content.
5. Register meters and explicit price versions at the account authority.
   Keep commercial prices unpriced until approved.
   Reserve shared funds before prepaid execution through the existing atomic admission boundary.
   Persist the accepted reservation and pinned funding choice before provider work.
6. Commit terminal usage intent with the native accepted terminal record.
   Retry that durable event independently of the initiating user's later membership or session.
   Settle or release only from accepted final evidence.
   Keep uncertain obligations reserved until reconciliation proves their outcome.
7. Use the shared account authority for membership, product provisioning, and consolidated costs.
   Start provisioning from the product's own authenticated onboarding. Offer existing
   account/project selection and creation without a separate manual enable screen.
   Open native operations through the service link and its own authenticated session.
   Billing events carry stable references and no private content.
8. Add static type fixtures and one composed journey through the real account and service runtimes.
   Include a lost reply, restart, revocation, foreign scope, authority outage, and terminal replay.
   Export usage, balanced ledger entries, hold reconciliation, a billing document, and browser evidence.
9. Inventory existing customers and write explicit source-to-instance mappings at the persistence boundary.
   Rehearse migration and restore before a bounded production cutover.
   Pause admission, retain callbacks, reconcile checkpoints, and switch to one writer.
   Remove old writers and the temporary migration runner after closure.

Shared wire and restart procedures are documented in [Phase 4](phase-4.md).
The migration rehearsal and production gates are documented in [Phase 5](phase-5.md).
