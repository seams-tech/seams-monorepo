# Hosted Tenant Recovery Operations

Created: September 5, 2026

Updated: September 12, 2026

Audience: Seams operators responsible for recovery-provider configuration,
destination provisioning, cleanup evidence, and hosted acceptance.

The portable holder procedure lives in the public
[Recovery CLI guide](../apps/docs/src/deploy-and-operate/recovery-cli.md).
This runbook covers only private hosted operations. Public CLI `0.4.1` has
completed its credential-free build and awaits signed release publication.
The [R121 execution checklist](./refactor-121-remaining-steps.md) tracks hosted
acceptance.

## Restarting backup setup

If a holder loses local wrapper keys, direct them to **Restart from step 2** in
the dashboard. Both new enrollments must finish before the pair can be
committed; an old key cannot be mixed with a new key. Keep the existing backup
available until the replacement is verified and downloaded.

Backup creation is limited to once per tenant root every 60 seconds in local
development and every 600 seconds in production. A request during the cooldown
returns the remaining wait time and leaves its approval unconsumed. Pending
provider deletion does not block a new backup; later backup creation retries
cleanup recorded in the generation journal.

## Replacing a recovery backup

Replacement cannot revoke copies already downloaded by holders. The service
removes its old active packages and destroys their retention keys through the
provider lifecycle. The configured KMS destruction delay is 24 hours.
Permanent erasure is established only by the provider outcome. Treat every
unaccounted holder copy as live.

## Destination configuration

For a local restore, run this from the repository root:

```bash
pnpm recovery:local \
  --manifest /path/to/extracted-recovery-folder/manifest.json \
  --console-env-file .env.local
```

This provisions an isolated empty destination at `https://localhost:4201`
with separate storage and a fresh custody lineage. It uses the standard
`seams-wallet` executable and operating-system HTTPS trust.

The `--console-env-file` option writes `TENANT_ROOT_RESTORE_ACCESS_JSON` to the
Console's private environment file after the destination passes its access
check. Restart the local Console to load it. For production, configure the same
binding with the exact destination identity, HTTPS origin, and bootstrap
credential through the Console secret pipeline. Apply Console migration 0044.
The Console exchanges the credential server-side only after fresh tenant
approval of the matching CLI code.

Recovery public trust comes from the control plane's
`TENANT_ROOT_RECOVERY_TRUST_BUNDLE_JSON`. Enrollment saves that authority over
verified HTTPS. The dashboard's `trust connect` command verifies a downloaded
manifest against it and saves the continued authority for offline use.

Rerun the provisioning command to reopen the same destination. `--port` and
`--state-dir` isolate drills. `--cli` selects a release candidate for operator
tests; `--trust-bundle` configures an intentional test authority on the control
plane.

## Destination authority

Configure the Console Worker with `TENANT_ROOT_RESTORE_DESTINATION_JSON`,
containing the provisioned logical identity and fresh destination lineage:

```json
{
  "identity": {
    "orgId": "your-org",
    "projectId": "your-project",
    "envId": "production",
    "signingRootId": "your-signing-root",
    "signingRootVersion": "v1"
  },
  "custodyLineageB64u": "<canonical base64url of the provisioned 16-byte lineage>"
}
```

Provision the Router with `TENANT_ROOT_DESTINATION_BOOTSTRAP_JSON`: canonical
identity bytes, deployment fingerprint, fresh lineage, and the
fingerprint-bound token digest in the persisted bootstrap-record format. Keep
the bearer token in the operator's private credential file. The Router accepts
only an empty matching authority; active, creating, and destruction-marked roots
are refused.

Use the lineage returned by provisioning throughout the restore. Apply the
complete Console and role-private Deriver migrations shipped with the selected
release. The Console, Router, and Derivers must agree on the cleanup/refresh
grant issuer, and the control plane must have recovery trust configured before
manifest import.

An absent descriptor leaves restore unavailable. After activation, retries use
the existing administration session because bootstrap authority has been
destroyed. Status remains incomplete until the original activation receipt has
produced both role cleanup receipts. Preactivation expiry preserves bootstrap
authority so a new session can be opened after cleanup finishes.

## Regression drill

Run the persistent local drill with repository vectors and test keys:

```bash
node tests/scripts/recovery-local-drill.mjs
```

The drill loses the response after the second import commits, retries without
the holder key, activates, compares the root commitment, checks activation and
bootstrap-consumption receipts, restarts, and resumes through the saved
administration session. It does not restore a user's backup or establish
production acceptance.

## After activation

Create a recovery backup on the destination when it should provide managed
redownload. Otherwise, the tenant-held files remain its only recovery copy.

Source retirement is a separate explicit operation. Verified retirement
requires both Deriver destruction receipts, permanent decrypt-probe failures,
revocation of lineage-scoped credentials, and a canary showing that the old
derivation endpoints reject that lineage. Missing evidence records an
unverified retirement. Even complete evidence applies only to the named source
lineage and cannot assert that no other clone exists.
