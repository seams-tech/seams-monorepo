# Production deployment of Wallet 0.13.0 — plan (October 17, 2026)

Status: **plan only; nothing is deployed.** Staging serves 0.13.0 since October 17,
16:29 JST. Production backends still run September builds: mainnet Gateway and
runtime from `59976ecd` (2026-09-19), production testnet from 2026-09-23. The
production frontends and Console backends were deployed from `main` on
October 16–17 (`1ac8588d`, `417f94be`).

Every file below is the same on `origin/dev` and `origin/main` unless stated.

## Progress (October 17–18)

The owner approved the Singapore move of production testnet, the missing secrets and the
`dev` → `main` merge on October 17. Done on `dev`:

| Gate | State |
| --- | --- |
| 2, 3 | `2cf5411f`: production testnet targets the eight empty databases of October 12, all regions allocated; Console and role Workers at `aws:ap-southeast-1` with a SIN primary check. The three role database variables name the `-sin` databases |
| 4 | `3ad02775`: the Gateway deploy installs an inert Worker under each missing regional Gateway name, then deploys the real Gateways |
| 5 | The three service-auth secrets are set in the `*-gateway`, `*-mpc-router` and `*-signing-worker` environments of both production lanes (generated, never printed) |
| 6 | **Open, owner:** `production-live-demo` still has no `CLOUDFLARE_API_TOKEN` / `CLOUDFLARE_ACCOUNT_ID`. The Console accepts activation only from that environment's OIDC subject, and the cutover writes D1 rows with the token in the same process |
| 7, 8 | `3ad02775`: the live-demo Console deploys after the backend; an empty `environment_id` deploys without the cutover |

The Arc RPC default moved to `https://rpc.testnet.arc.io` (`10e4807d`; GitHub variables
updated); Wallet 0.13.1 carries the SDK default.

October 18 (JST):
- Wallet 0.13.1 on npm (01:20); private pins `c6f71cdf`; `main` = `0f3af534` (pull request 46,
  tree equal to `dev`).
- CLI 0.13.0: signed by private run `39050177371`, verified locally (five files; an altered
  binary and an altered signature fail), released as `seams-cli-v0.13.0`. The npm launcher
  waits for the owner's npm login. GitHub masks the signer key id (a job secret) inside the
  printed base64; the manifest was rebuilt from the public pin and matched the logged SHA-256.
- Production testnet, deploy-only run `39051552770` (02:26): every backend component, the inert
  bootstrap of the US, WEUR and OC Gateway names, and the Console on `seams-console-testnet-sin`.
  The first run (`39050179163`) hit the 15-minute limit of the Gateway migration job: four
  empty databases need 81 migrations each at about 5 s per migration. The runner skips applied
  migrations, so the second run finished. Gateway `/healthz` answers 503
  `tenant_deployment_unavailable` until activation; Console `/console/readyz` answers 200.
- The owner signed up on the testnet network of the dashboard (the production dashboard
  opens on mainnet by default, whose Console holds the older `proj_mu6auwge_v8ulud`) and
  created organisation `org_p33k44j8030r` and project `proj_6d5399e80124498aa29d6866e84a9de4`
  at 20:06, and set `CLOUDFLARE_API_TOKEN` in `production-live-demo`.
- Activation run `39122039194` (20:19) passed with
  `environment_id=proj_6d5399e80124498aa29d6866e84a9de4:dev`, including both smoke steps.
  `/healthz` and `/readyz` answer 200; the public projection names the environment, a managed
  publishable key, application origin `https://wallet.seams.sh` and hosted wallet
  `https://test.sign.seams.sh`.
- Verification: three hosted NEAR registrations, each with a first signed message, passed
  (`.artifacts/prodtest-0131/verify.sh`; candidate wallet assets, live backend). All three
  signatures verified independently (Node Ed25519, separate NEP-413 encoding; altered fields
  rejected). The Console lists the three wallets as ACTIVE; no directory publication is pending
  in the four regional databases. First-use registrations took 5.4, 4.5 and 3.0 s.
- Hosted wallet `test.sign.seams.sh` deployed from `main` with Wallet revision `5137cf36`
  (surface `wallet-host`, lane `production-testnet`; mainnet unchanged).

## Gates

| # | Gate | Lanes | Where | Removed by |
| --- | --- | --- | --- | --- |
| 1 | `main` lacks 0.13.0: it pins 0.11.0 and is 63 commits behind `dev` (56 unique patches, among them the 0.13.0 pins and the Console completion resumption `eda7c5d1`). All production workflows, `scripts/deploy-backend.mjs:213-220`, `scripts/deploy-surface.mjs:586-589` and the OIDC ref of `tenantDeployment/automationRoute.ts:30-32` require `main` | both | | A `dev` → `main` pull request, merged by the owner. It should merge cleanly: `main`'s two own commits exist on `dev` as equal patches |
| 2 | US, WEUR and OC signer databases are `pending` in `deployment/wallet-system/targets.json` (testnet 364-396, mainnet 585-617); `requireAllocatedWalletRegions` throws in migrate, preflight and deploy | both | `scripts/gateway-deployment-config.mjs:317-324` | Config: record the existing empty databases (`seams-signer-testnet-us/-weur/-oc`, `seams-signer-us/-weur/-oc`, created 2026-10-12) as `allocated` |
| 3 | The Singapore switch is not applied to production: targets and the role-database GitHub variables still name the September databases and placements (testnet Derivers at `aws:ap-northeast-1`, mainnet APAC signer at `aws:ap-east-1`). All databases of a lane must change together | both | `docs/singapore-clean-switch-20261013.md:16-18, 494-514` | Owner decision, then one config change per lane: `targets.json`, `deployment/console/targets.json` and the GitHub variables together (new empty `-sin` databases exist) |
| 4 | Regional Gateway and Wallet Runtime Workers for US, WEUR and OC do not exist. Each Gateway binds all four regional Gateways, so the first deploy needs a bootstrap order; staging was bootstrapped by hand | both | `render-d1-gateway-config.mjs:397-441`, `deploy-backend.mjs:1555-1558` | Code: a bootstrap stage in `deploy-backend.mjs`, or a one-time manual bootstrap per lane |
| 5 | The production GitHub environments lack the Gateway/Router service-auth secrets added on 2026-10-04 (`ROUTER_AB_GATEWAY_TO_ROUTER_AUTH_SECRET`, `ROUTER_AB_GATEWAY_TO_SIGNING_WORKER_PRESIGN_AUTH_SECRET`, `ROUTER_AB_ROUTER_TO_SIGNING_WORKER_ECDSA_AUTH_SECRET`) in the `*-gateway`, `*-signing-worker` and `*-mpc-router` environments | both | `scripts/deployment-targets.mjs:55-61, 422-453` | Owner: generate (`deployment/wallet-system/scripts/generate-github-env-values.mjs`) and set them |
| 6 | `production-live-demo` has no `CLOUDFLARE_API_TOKEN` / `CLOUDFLARE_ACCOUNT_ID`, which the cutover job needs | testnet | `deploy-live-demo.yml:89-92` | Owner: add both to that environment |
| 7 | The live-demo workflow runs the Console and the backend in parallel; with all regions allocated, the Console binds regional Gateways that may not exist yet | testnet | `deploy-live-demo.yml:53-65` | Code: make `deploy_console` wait for the backend, or redeploy the Console after the backend |
| 8 | No separate activation (`activation_only`) for production testnet; the live demo always redeploys and needs `environment_id` up front | testnet | `deploy-staging-backend.yml:5-12` for the staging shape | Optional code change |
| 9 | An ACTIVE Console environment must exist. On new (`-sin`) Console databases the owner signs up again and creates the organisation and project; mainnet also needs an ACTIVE `:prod` environment (`proj_mu6auwge_v8ulud:prod` is disabled) | both | `provisioning.ts:279-300` | Owner: dashboard sign-up and project creation |
| 10 | Mainnet has no activation path: `tenant-cutover.mjs` accepts only staging-testnet and production-testnet, and `automationRoute.ts` has no mainnet scope | mainnet | `scripts/tenant-cutover.mjs:70-72`, `automationRoute.ts:34-35` | Code: a mainnet OIDC scope, the lane in `tenant-cutover.mjs`, a protected activation workflow |
| 11 | The mainnet Router policy pins placeholder tenant ids (`org_production`, `project_production`) | mainnet | `deploy-backend.mjs:843, 1456-1461`; `targets.json:620-625` | Config after sign-up (real ids), or an owner-approved code change |
| 12 | `surface=all` forces `wallet_lane=all` and would ship the 0.13.0 hosted wallet to mainnet's `sign.seams.sh` while its backend is September's | both | `scripts/deploy-surface.mjs:201-203` | Deploy frontends per surface and lane |

## Order for production testnet

1. **Owner decisions:** move production testnet to the Singapore databases (gate 3, recommended:
   staging runs this shape), and accept that its current data is not carried over.
2. **Config and code, on `dev`, reviewed like staging:** record the testnet regional databases
   (gate 2) and the Singapore resources (gate 3); the bootstrap stage (gate 4); the Console job
   order (gate 7).
3. **Owner:** set the missing secrets (gates 5 and 6).
4. **Owner:** merge `dev` into `main` (gate 1).
5. **Deploy:** the live-demo workflow on `main` with a temporary environment id is not possible
   before the Console project exists, so: deploy the testnet Console, then the owner signs up and
   creates the organisation and project (gate 9), then run `deploy-live-demo.yml` with
   `environment_id=<projectId>:dev`.
6. **Verify:** health endpoints, one registration with a signature, the Console list shows the
   wallet and no pending publication remains.
7. **Frontends:** `deploy-production-frontend.yml` per surface with `wallet_lane=production-testnet`
   (gate 12).

## Order for production mainnet

Mainnet follows only after testnet works, and needs gates 10 and 11 as code and config changes
first: a mainnet activation path and the real tenant ids in the Router policy. This is design
work for the owner to approve; it is not part of 0.13.0.

## What the owner does

- Decide the Singapore switch for each production lane.
- Set the GitHub environment secrets (gates 5 and 6).
- Merge `dev` into `main`.
- Sign up in the production dashboard and create the organisation and project (gate 9).

## Not changed by this plan

Wallet custody and recovery keys, the release signing root, and production data. No production
database that holds data is deleted.

## Production frontends and mainnet (October 18, JST)

The owner approved the Console fixes, the site fix and a deployment of the current release
over mainnet ("there are no wallets on mainnet"). Private `main` = `5dc467b7` (pull request 47).

- Frontends: Platform Console (run `39126146478`), Wallet Console (`39126235231`) and
  `wallet.seams.sh` (`39126286912`, Wallet revision `5137cf36`). The site loads with mainnet
  hidden: the mainnet projection fails, and a failed optional mainnet discovery now hides
  mainnet instead of failing the page (`5b5ce6d5`). The testnet live demo renders.
- Mainnet facts before the deploy: `seams-signer` held 0 wallets, 0 signers and 0 ceremonies;
  the Console wallet index had no mainnet rows. The mainnet Console database is the account
  store of the production dashboards (organisations "Seams Technologies" with project
  "Seams Wallet", and "Nini Corp" with project "Satyr"), so it stays; so do the APAC signer
  database and the role databases. The empty US, WEUR and OC databases are allocated
  (`c6528b9d`); the lane is not moved to Singapore, which would need a Console move.
- Gate 10: `69d0d025` adds the mainnet activation path (Console scope `production-gateway`,
  ref `main`, `deploy-production-mainnet-backend.yml`; `activation_only` job). Gate 11: the
  tenant block and `ROUTER_AB_PROJECT_POLICY_BOOTSTRAP_JSON` name `org_ty5o34k5w9p7`,
  `proj_mu6auwge_v8ulud`, `proj_mu6auwge_v8ulud:prod`.
- Mainnet backend run `39126113752`: every component deployed, including the inert bootstrap
  of the US, WEUR and OC Gateway names; only the last smoke step failed, with 503
  `tenant_deployment_unavailable`, as before any activation. Mainnet Console run
  `39128509358` passed; Console readiness 200; the account data is intact (2 organisations,
  2 projects, 1 key).
- Open, owner: `proj_mu6auwge_v8ulud:prod` is DISABLED. A `prod` environment turns ACTIVE only
  with live access, which needs a credit balance above 0 for the organisation. Then:
  `deploy-production-mainnet-backend.yml` with `activation_only=true` and
  `environment_id=proj_mu6auwge_v8ulud:prod`, then the `sign.seams.sh` wallet host.
