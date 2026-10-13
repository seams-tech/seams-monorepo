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
   Done on October 13: the nine old databases are deleted. The rollback to
   the Hong Kong databases no longer exists.

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

## Staging: release 0.9.3 since October 13, 03:26 JST

Release 0.9.3 of the Wallet packages carries the registration latency work
of R155G and R155H: the early passkey claim, the table-frame yield, the SIMD
build, the start-up ceremony of the Derivers and the stripped Workers. It
adds Gateway migration `0078`.

Deployment:

1. Private `5115cd3` pins 0.9.3. `pnpm check` and `pnpm build` pass. The
   repository validation passes for the first time since the 0.9.0 pins,
   because the console and the site build again.
2. Before the deployment the latest upload of each of the 14 Workers was its
   serving version (`serving-before-093.json`).
3. Console run `38289350037` passed. Backend run `38289630699` migrated the
   four Gateway databases and deployed every component. Its last step, the
   smoke test, failed by design: a newly deployed Gateway version answers
   403 `tenant_deployment_unavailable` until the activation verifies it.
4. Activation run `38290821236` passed with `proj_mv5fzezy_4ztf60:dev`.
   The publishable key and the environment did not change; only the
   projection's revision did.
5. Read back: 14 new serving versions, each the latest upload
   (`serving-after-093.json`); table `registration_passkey_claims` and its
   trigger on all four Gateway databases.

**Every deployment of the staging backend needs the activation afterwards.**
Between the Gateway's deployment and the activation the lane refuses every
request, here for about five minutes.

Measurement, client in Tokyo, 198 wallets on 0.9.0 between 01:15 and 03:09
and 164 wallets on 0.9.3 between 03:28 and 03:46:

| | 0.9.0 p50 | 0.9.3 p50 | 0.9.0 p90 | 0.9.3 p90 |
| --- | ---: | ---: | ---: | ---: |
| Registration after the passkey step | 2,332 ms | 1,734 ms | 3,044 ms | 2,221 ms |
| Respond | 235 ms | 192 ms | 435 ms | 258 ms |
| Yao execute | 1,286 ms | 862 ms | 1,836 ms | 1,293 ms |
| Finalize | 602 ms | 477 ms | 947 ms | 678 ms |
| Finalization, Gateway total | 306 ms | 228 ms | 595 ms | 434 ms |
| Router execute request | 1,100 ms | 669 ms | 1,625 ms | 1,113 ms |
| First signature | 454 ms | 326 ms | 857 ms | 560 ms |

On 0.9.3, 80% of the wallets finish in less than 2.0 s after the passkey
step; on 0.9.0, 12% did. The nine-wallet figure of 2,671 ms above was high
for 0.9.0. All 164 signatures of the 0.9.3 runs verify independently
(`proof-verification-release-093.json`). The public record is
`docs/evidence/refactor-155h-release-093-staging.md` in `seams-wallet`.

Found during the runs:

- One of 165 samples failed at setup with HTTP 400 and
  `D1_ERROR: Network connection lost.` Classified
  `environment_or_infrastructure_failure`. Setup does not retry a transient
  database fault and returns the driver's message with a client-error
  status.
- The start-up ceremony costs about 0.3 s of CPU per Deriver at every
  wallet start, also for a setup that nobody finishes. Setup has no rate
  limit of its own.
- One wallet in about a hundred waits about 3 s for its Deriver A object on
  both releases.

Measurement kit in the artifacts folder: `measure.py <label> <groups>`,
`analyze.py`, `report.py <before> <after>`, `verify-runs.mjs <label>`,
`serving.py <name>`. They change nothing on staging. `site-093/` is the
test site built from the published 0.9.3 package.

## Staging: release 0.9.4 since October 13, 16:32 JST

Release 0.9.4 of the Wallet packages carries the engine change of the Yao
execution (label wipes and a four-block gate hash), the retry of a transient
database fault in setup, and the earlier setup preflight of the SDK. It has
no wire, schema or protocol change.

Deployment:

1. Private `3f4fdb45` pins 0.9.4. `pnpm check` and `pnpm build` pass.
2. Before the deployment the five role Workers served their latest upload
   (`serving-before-094.json`). The Console and the APAC Gateway each had a
   newer unused upload. That does not block them: the TypeScript Workers
   deploy with a secrets file, and only the role Workers set secrets on the
   latest upload.
3. Console run `38361801956` passed. Backend run `38362259221` deployed
   every component; its smoke step failed by design with 403 until the
   activation.
4. Activation run `38363192264` passed with `proj_mv5fzezy_4ztf60:dev`.
5. Read back: 14 new serving versions, each the latest upload
   (`serving-after-094.json`). The lane refused requests from 16:27 to
   16:32 JST.

Measurement, client in Tokyo, 99 wallets on 0.9.3 from 16:06 to 16:16 and
198 wallets on 0.9.4 from 16:33 to 16:53:

| | 0.9.3 p50 | 0.9.4 p50 | 0.9.3 p90 | 0.9.4 p90 |
| --- | ---: | ---: | ---: | ---: |
| Registration after the passkey step | 1,915 ms | 1,876 ms | 2,455 ms | 2,468 ms |
| Respond | 234 ms | 232 ms | 385 ms | 361 ms |
| Yao execute | 1,007 ms | 946 ms | 1,398 ms | 1,320 ms |
| Finalize | 567 ms | 576 ms | 888 ms | 908 ms |
| Finalization, Gateway total | 309 ms | 308 ms | 592 ms | 627 ms |
| Router execute request | 783 ms | 720 ms | 1,133 ms | 1,036 ms |
| Deriver A, CPU per execution | 250 ms | 196 ms | 336 ms | 252 ms |
| Deriver B, CPU per execution | 207 ms | 182 ms | 280 ms | 248 ms |
| First signature | 448 ms | 443 ms | 791 ms | 692 ms |

The Yao execution is about 60 ms shorter, and both 0.9.4 runs show it. The
change of the whole interval, 39 ms, is inside the difference between two
runs. All 198 signatures of the 0.9.4 runs verify independently. The public
record is `docs/evidence/refactor-155h-release-094-staging.md` in
`seams-wallet`.

**The time of day matters.** Release 0.9.3 measured 1,642 ms at 03:30 JST
and 1,915 ms at 16:06 JST with the same formula. Compare runs of the same
hour only, and take the baseline before the deployment.

Found during the runs, for R155J:

- One wallet in 198 waited 8.8 s in the Gateway before its finalization
  began: the request lasted 9,165 ms with 82 ms of CPU, and the finalization
  itself took 278 ms. No tailed Worker ran in between.
- One first signature took 10.2 s, nine minutes after the deployment: the
  Gateway, the Router and the Signing Worker each used 0.75 to 1.0 s of CPU
  in its sign-prepare chain, the pattern of a host that starts the new
  versions.

Kit additions: `SEAMS_MEASURE_PUBLIC=<clean seams-wallet tree>` gives
`measure.py` the harness of a released commit, and `site-094/` is the test
site built from the published 0.9.4 package.

## Staging: release 0.10.0 since October 14, 00:50 JST

Release 0.10.0 of the Wallet packages changes the wallet-management protocol
to 4. It carries one request fewer after the passkey step, the pair
preparation during the passkey prompt, a setup rate limit of 30 per minute
per publishable key and source address, registration without the shared
capability record, and Gateway indexes. It adds Gateway migrations `0079`
and `0080` and Deriver migration `0020`.

Deployment:

1. Private `c245e0a7` pins `@seams/wallet-server` 0.10.0 and changes the two
   protocol literals to 4 (the Console's registration canary and
   `tests/relayer/tenant-home-challenge.e2e.test.ts`). npm released the SDK
   package 56 minutes after its publication, so `c7ec1df3` pins
   `@seams/wallet` afterwards. `pnpm check` and `pnpm build` pass on both.
2. Console run `38417792320` passed. Backend run `38418189153` applied the
   three migrations and deployed every component; its smoke step failed by
   design.
3. **Three activation runs failed** (`38419908767`, `38420261237`,
   `38420676853`) with "registration canary failed with HTTP 503". Cause:
   the canary sent a provided wallet id, `canary-<uuid>`, which is not in
   the server-allocated format. A 0.10.0 Gateway builds the Yao admission at
   setup and answered 500 for it; 0.9.4 answered 200. Real clients were not
   affected, and the lane served 0.10.0 registrations in that time.
4. Private `ade5e075` makes the canary send the request of a real client.
   Console run `38425041847` deployed it, and activation run `38425377639`
   passed. Public `1ae2df5b` corrects the setup defect; it is not released.
5. Read back: 14 serving versions, each the latest upload
   (`serving-after-0100.json`). A wallet registered and signed with the
   0.10.0 client. The test site of the published 0.9.4 package gets HTTP 409
   and the upgrade message.

Measurement, client in Tokyo, every request through Tokyo: 99 wallets on
0.9.4 from 23:42 to 23:53 and 197 wallets on 0.10.0 from 00:25 to 00:45.

| | 0.9.4 p50 | 0.10.0 p50 | 0.9.4 p90 | 0.10.0 p90 |
| --- | ---: | ---: | ---: | ---: |
| Registration after the passkey step | 2,096 ms | 1,747 ms | 2,764 ms | 2,494 ms |
| Proof and Yao execution | 1,331 ms | 1,065 ms | 1,640 ms | 1,601 ms |
| Finalize | 680 ms | 502 ms | 1,157 ms | 905 ms |
| Finalization, Gateway total | 372 ms | 261 ms | 781 ms | 627 ms |
| Gateway finalize, CPU | 146 ms | 48 ms | 277 ms | 83 ms |
| First signature | 532 ms | 362 ms | 1,027 ms | 677 ms |

73% of the wallets finish in less than 2.0 s after the passkey step, against
40% on 0.9.4 in that hour. All 197 signatures verify independently. The
public record is `docs/evidence/refactor-155h-release-0100-staging.md` in
`seams-wallet`.

Two events of that evening changed the measurement and are not caused by
the release:

- **Evening routing.** Between about 21:30 and 23:30 JST, Cloudflare
  received up to 63% of the test client's requests in Portland, Sydney,
  Osaka and Boston. That adds 150 to 300 ms to each request.
  `colo.py <label>` in the artifacts folder splits a run by entry location.
- **The Console.** The shared-account cutover at 22:04 JST made two Console
  calls on this path 300 ms slower: the billing service ran 16 schema
  statements for every request. Private `32e8bc47` and `00eaecb6` corrected
  it; the lineage call is back at about 25 ms.

Open:

- The staging frontends were not deployed. Their last deployment is of
  September 16, so the hosted wallet on staging does not speak protocol 4.
- One sample of 198 failed at respond with a transient database fault.
  Respond does not retry it.

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
