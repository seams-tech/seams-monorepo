# Clean switch of every lane to Singapore

Started October 13, 2026 (JST). Owner decision of October 12 and 13: the APAC
components of a lane run in one place, Singapore; no lane is live, so every
existing wallet and all data are discarded; downtime is accepted.

The reason for Singapore is measured: one durable write holds an object's
response for 34 ms in Hong Kong and 3 ms in Singapore, and most APAC users
are expected in Singapore and Malaysia. The record is
`docs/evidence/refactor-155h-write-hold-by-colo.md` in `seams-wallet`.

## Rules of the switch

- A lane comes up on new, empty databases. Nothing is copied.
- All databases of a lane change together: an empty Console needs every
  regional Gateway database of the lane empty too.
- The US, WEUR and OC homes keep their regions. Their databases are new and
  empty in Ashburn, London and Sydney. This is an assumption; the owner has
  not ruled on the other regions.
- The APAC Gateway, Wallet Runtime and Console are placed at
  `aws:ap-southeast-1`. The three role Workers get the same placement and a
  `SIN` primary check.
- Old databases are not deleted by the agent. The owner runs the deletion
  script after a lane is verified.
- Run artifacts: `.artifacts/r155h-singapore-anchor/` (ignored by git).

## Staging: live on Singapore since October 13, 01:10 JST

The owner signed in and created organisation `org_4hyqbnyqbco7` and project
`proj_mv5fzezy_4ztf60`. Activation run `38274905238` passed with environment
`proj_mv5fzezy_4ztf60:dev`, including its readiness check. `/readyz`,
`/healthz` and the tenant projection answer 200.

Proof: twelve fresh NEAR registrations with a first signature each passed
through the hosted product test. All twelve signatures were verified
independently with Node's Ed25519 and a separate NEP-413 encoding, and
altered fields were rejected (`proof-verification.json`).

First measurement, nine wallets after one discarded group, client in Tokyo,
published 0.9.0 code. It has no control arm: the Hong Kong lane no longer
serves. The Hong Kong column is the control side of October 12.

| | Singapore p50 | Hong Kong p50 |
| --- | ---: | ---: |
| Finalization, server total | 265 ms | 602 ms |
| Wallet commit | 63 ms | 187 ms |
| Custody commit | 19 ms | 61 ms |
| Session issue | 28 ms | 68 ms |
| Finalization, browser | 562 ms | 842 ms |
| Yao execute, browser | 1,444 ms | 1,608 ms |
| Registration after the passkey step | 2,671 ms | 2,988 ms |

The 90th percentiles are wide on the new lane: setup 1,193 ms and Yao
execute 2,596 ms. Nine wallets on a lane deployed an hour earlier do not
settle that. A Tokyo client is also farther from Singapore than from Hong
Kong, so a user in Singapore sees less than these figures.

The hosted test's prebuilt site carried the old tenant's publishable key and
failed with `publishable_key_invalid`. The proof used a copy of that site
with the new key and environment id. Every hosted driver prepared before the
switch needs a rebuilt site and the new projection.

The steps below record how the lane got here.

| New database | Id | Primary | Replaces |
| --- | --- | --- | --- |
| `router-ab-deriver-a-staging-private-sin` | `e3949094-2931-4430-92f1-5c83836ffc1c` | SIN | `router-ab-deriver-a-staging-private-hkg` |
| `router-ab-deriver-b-staging-private-sin` | `8136a1bf-bf22-4d54-9231-b5d2761fc085` | SIN | `router-ab-deriver-b-staging-private-hkg` |
| `router-ab-signing-worker-staging-private-sin` | `59ea3a14-a046-4c8c-a6d8-a8f40e99fa92` | SIN | `router-ab-signing-worker-staging-private-hkg` |
| `seams-console-staging-sin` | `802fa155-b740-4fc5-87fa-3c30e864d1f5` | SIN | `seams-console-staging-hkg` |
| `seams-signer-staging-sin` | `0b77e7a5-4668-4df9-8c2d-c8846804f542` | SIN | `seams-signer-staging-nrt` |
| `seams-signer-staging-us` | `fac338cd-4fd9-4c88-8b24-4e675cd3736c` | IAD | `seams-signer-staging-nrt-us` |
| `seams-signer-staging-weur` | `0e8bde9f-eda3-4fee-a3c7-d5cdb0a99ed9` | LHR | `seams-signer-staging-nrt-weur` |
| `seams-signer-staging-oc` | `ffa1a07d-ccd4-40c7-a6c4-3efe3cf6735f` | SYD | `seams-signer-staging-nrt-oc` |

Done:

1. The eight databases were created empty. The `apac` hint took 12 attempts
   for five Singapore primaries; the others landed first time.
2. The Console and Gateway migration sets were applied to the five non-role
   databases with `apply-remote-d1-migrations.mjs`: 68 and 77 migrations,
   fingerprints recorded. The role databases migrated at deploy.
3. Private commit `281e48f` changed both target files and the test that
   pins the staging ids. The three role database variables in the GitHub
   environments `staging-deriver-a`, `staging-deriver-b` and
   `staging-signing-worker` hold the new ids.
4. Console workflow run `38265879984` passed. Backend run `38266180765`
   failed in both Deriver jobs: the newest uploads of the two Derivers were
   comparison builds of October 12, and `wrangler secret put` refuses that
   state. `.artifacts/staging-090-deploy/refresh_latest.py` made the serving
   versions the newest uploads again, with every equality check passing.
   Backend run `38266692675` then deployed every component.
5. Read back after the deployment: all 14 Workers serve one new version at
   100%, every serving version binds only new databases, and the APAC
   Gateway, Wallet Runtime, Console and the three role Workers are placed at
   `aws:ap-southeast-1`. `staging-after-deploy.json` holds the read.

State now: Console answers 200. The Gateway answers 503
`tenant_deployment_unavailable` on every route, as designed for a lane
without an activated tenant. The backend run's final smoke step fails for
that reason.

Steps after the deployment, all done except the last:

1. **Owner:** sign in at `https://staging.wallet.seams.sh`, create the
   organisation and one project. The project step ends with an error that
   asks for operator verification; that is expected.
   Google sign-in fails there today with `origin_mismatch`. The Google client
   "Seams Web (Staging)" lists `https://wallet.staging.seams.sh` as an
   authorized JavaScript origin, a host that does not exist; the dashboard
   runs at `https://staging.wallet.seams.sh`. The fault is older than the
   switch: the client was last used on September 13, and the switch only
   ended the old sessions. Add the right origin to the client, or sign in
   with GitHub, which is configured for this origin.
2. Run the protected activation with the new `dev` environment id:
   `deploy-staging-backend.yml` with `activation_only=true` and
   `environment_id=<projectId>:dev`. It creates the tenant root, the
   publishable key and the binding, and runs a canary.
3. Verify: the smoke routes, one fresh registration and one independently
   checked signature.
4. **Owner:** run `.artifacts/r155h-singapore-anchor/delete-old-staging-databases.sh`.
   It removes nine old databases after an id check and a typed confirmation.

Rollback before the deletion: revert `281e48f`, restore the three variables
from `staging-rollback-state.json`, run the Console and backend workflows,
then activate the old environment again.

Left in place, by design or for the owner:

- Durable Object state of the old wallets. Nothing reaches it, and no
  mechanism in the repository wipes it.
- The managed-backup buckets of the two Derivers, which hold backups of the
  old tenant root.
- The legacy Workers `seams-sdk-d1-router-api-staging` and
  `router-ab-router-staging`, and the two July databases that the first one
  binds.
- Every Worker version from before this switch binds an old database. After
  the deletion none of them may serve again. Old hosted comparison drivers
  must not restore their snapshots.

## Production testnet and mainnet: databases ready, deployment blocked

Empty databases exist for both lanes. Nothing serves them.

| Production testnet | Id | Primary | Replaces |
| --- | --- | --- | --- |
| `seams-console-testnet-sin` | `c5bfd5d4-b605-49bd-a8a3-bee2e5e6ab4a` | SIN | `seams-console-testnet` |
| `seams-signer-testnet-sin` | `a3820849-d700-48ad-a6ec-5434421d6a3a` | SIN | `seams-signer-testnet` |
| `router-ab-deriver-a-testnet-private-sin` | `b54f2f57-1ab3-4267-9dde-0a7b07bd9ece` | SIN | `router-ab-deriver-a-testnet-private-tokyo` |
| `router-ab-deriver-b-testnet-private-sin` | `57129a55-8d58-4046-a1c3-a83986068684` | SIN | `router-ab-deriver-b-testnet-private-nrt` |
| `router-ab-signing-worker-testnet-private-sin` | `53cff5d2-8298-400a-becd-71df4f39720e` | SIN | `router-ab-signing-worker-testnet-private` |
| `seams-signer-testnet-us` | `9c3d3444-9b8f-42d8-9ac5-509da2f29701` | IAD | new region |
| `seams-signer-testnet-weur` | `94530070-41a2-43de-96ac-9b1d7a5f9e28` | LHR | new region |
| `seams-signer-testnet-oc` | `e59c0185-3aee-4cf5-8896-6cfc0f822841` | SYD | new region |

| Production mainnet | Id | Primary | Replaces |
| --- | --- | --- | --- |
| `seams-console-sin` | `94300569-5d9b-474f-b947-4c4c8dd1cc6e` | SIN | `seams-console` |
| `seams-signer-sin` | `8a009ce1-fcf8-4521-8e2e-87ca0a6336df` | SIN | `seams-signer` |
| `router-ab-deriver-a-private-sin` | `10a3cda4-2271-4484-af26-a7f926ba739c` | SIN | `router-ab-deriver-a-private` |
| `router-ab-deriver-b-private-sin` | `f619fa0e-8c1d-4fa2-8e75-e2909ac20dc2` | SIN | `router-ab-deriver-b-private` |
| `router-ab-signing-worker-private-sin` | `3daf67c9-cb1d-42d4-9f8d-30feb1b14c84` | SIN | `router-ab-signing-worker-private` |
| `seams-signer-us` | `7d19f495-dd40-4950-ad5a-d2da3b421adf` | IAD | new region |
| `seams-signer-weur` | `cd9026b7-d5cd-4478-aff1-d5d03ab1a500` | LHR | new region |
| `seams-signer-oc` | `c963d120-99d8-422d-97ae-63efe560087f` | SYD | new region |

A clean bring-up of these lanes is their first deployment of the current
code and their first regional deployment. It is blocked by more than
placement:

1. The lanes run September builds. The regional Gateway and Wallet Runtime
   Workers of US, WEUR and OC do not exist, and each Gateway binds the other
   regions' Workers, so a first deploy needs a bootstrap order. Staging was
   bootstrapped by hand on October 4.
2. `deploy-live-demo.yml`, the only path for production testnet, requires an
   `environment_id` before the Console that would create it has deployed.
3. Mainnet has no tenant activation path: `scripts/tenant-cutover.mjs` and
   the Console's `automationRoute.ts` accept only the two testnet lanes.
4. The mainnet Router policy pins the tenant ids `org_production` and
   `project_production`, which a new sign-up will not reproduce.
5. Production workflows build `main`, and the target changes must reach it.
6. The GitHub production environments must be checked for the key divergence
   that staging had on October 12.

These need owner decisions and code changes. Nothing in production was
changed besides the creation of the empty databases.
