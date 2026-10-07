# Console browser review — 2026-09-28

Reviewed all 11 requested routes on `https://wallet.seams.sh` using an authenticated
Chrome session, with the Seams Wallet project and Development environment selected.
All 11 pages loaded. Three defects were reproduced. This is partial flow
verification: opening a form does not verify its submit, persistence, delivery, or
downstream effects.

Local source inspection used commit `351e46c` on `dev`. The deployed commit was not
determined. No application code or deployment was changed during this review.

## Fix implementation — 2026-09-28

The follow-up fixes are implemented locally; deployment and a live browser recheck
are still pending.

- Billing: the generated Console worker configuration now sets `CONSOLE_BASE_URL`
  to the wallet site origin. Stripe success/cancel returns and browser-facing email
  links use the frontend; the session issuer retains the API origin.
- Policy versions: the Cloudflare router now implements the existing
  `GET /console/policies/:id/versions` contract, with authenticated organization
  scoping and a structured `policy_not_found` response for missing policies.
- Audit: policy links use the policy kind to select the transaction or sponsorship
  workspace. Gas sponsorship consumes `policyId` on navigation and reload, opens
  coverage details, and clears the deep link when the dialog closes. Unknown policy
  kinds render without an inferred workspace link.

Extended the three existing billing, policy governance, and gas sponsorship E2E
journeys without adding test cases. Assertions cover checkout return origin,
loaded live-version details and review rules, and gas audit navigation through
reload and close. Successful runs attach receipt, screenshot, and runtime-snapshot
evidence to the Playwright results.

Validation passed: frontend and Wallet Console server TypeScript checks, targeted
ESLint, frontend production build, Console core import boundaries, and generated
browser-origin/session-issuer checks for all three deployment lanes. Local config
evidence: `output/playwright/console-fixes-2026-09-28/deployment-return-origins.json`.

E2E execution is blocked before any test runs: `environment_or_infrastructure_failure`.
The managed runner rejects an existing `seams-wallet` workerd on `localhost:4100`.
That process was left running. The three tests pass discovery, but their new browser
assertions have not yet been executed. Repeat once the managed runtime ports are
available:

```sh
pnpm -C tests test:console --grep 'Owner funds and governs a sponsored operation'
```

## Findings

### 1. Billing checkout returns to a different, unusable console origin

Priority: P1. Classification: `environment_or_infrastructure_failure` (return-URL
configuration).

Reproduction:

1. Open `/dashboard/billing/account` with Development selected.
2. Select $10 and click **Buy $10**.
3. Stripe opens successfully, displaying **Seams Wallet sandbox**, **Sandbox**, and
   **Seams prepaid credits ($10.00)**.
4. Click **Back to Seams Wallet sandbox**.

Actual: the link points to
`https://test.console.seams.sh/dashboard/billing/account?checkout=cancel`, and
Chrome displays **ERR_BLOCKED_BY_CLIENT**. The flow does not return to the original
working billing page on `wallet.seams.sh`.

Expected: cancellation returns to a reachable console frontend with the original
authenticated organization context. The browser-specific blocking mechanism was
not diagnosed; the observed return-origin mismatch is independent evidence.

Source evidence: `buildStripeCheckoutReturnUrls` in
`packages/console-server-ts/src/billing/service.ts:176` derives both success and
cancel URLs from `consoleBaseUrl`. The production-testnet target in
`deployment/console/targets.json:23` uses `test.console.seams.sh` as its origin and
`wallet.seams.sh` as its site origin. Verify which frontend origin feeds billing
return URLs in the deployed configuration. Success-return behavior is an inferred
risk from the shared builder; no payment or successful settlement was tested.

### 2. Policy details and Go live review cannot load policy versions

Priority: P2. Classification: `production_regression`.

Reproduction:

1. Open `/dashboard/policy-engine`.
2. Click **Details** for the published **Default Policy**.
3. Close it, open the row action menu, and choose **Go live**.

Actual: both views show **Policy version list request failed (404)**. Go live also
shows **Live-rule comparison unavailable**, so the reviewer cannot compare the
proposed rules against the current live version.

Expected: the live version and rule comparison load for this existing published
policy.

Source evidence:

- `apps/wallet-console/src/products/wallet/policy-engine/consolePoliciesApi.ts:347`
  requests `GET /console/policies/:id/versions`.
- `packages/wallet-console-server-ts/src/router/express/createConsoleRouter.ts:3035`
  implements that endpoint.
- `packages/wallet-console-server-ts/src/router/cloudflare/createCloudflareConsoleRouter.ts:3411`
  handles policies without a versions branch and falls through to 404.

Local browser evidence:

- `output/playwright/console-review-2026-09-28/policy-version-404.txt`
- `output/playwright/console-review-2026-09-28/policy-version-404.png`
- `output/playwright/console-review-2026-09-28/policy-go-live-404.txt`

### 3. Gas sponsorship audit links open an incompatible policy workspace

Priority: P2. Classification: `production_regression`.

Reproduction:

1. Open `/dashboard/audit`, using a period that includes September 24, 2026.
2. Expand the **Published policy** event for **Project gas sponsorship**.
3. Click its **Project gas sponsorship** policy link.

Actual: navigation goes to `/dashboard/policy-engine?policyId=…`. The table shows
**No policies matched the current search and filters**, and the modal shows
**Policy details are unavailable** with no explicit Close button. Clicking outside
the modal dismisses it.

Expected: the link opens the matching gas sponsorship policy and its details.

Source evidence: `apps/wallet-console/src/app/dashboardConfig.tsx:163` routes all
audit policy links to `/dashboard/policy-engine`. That workspace loads only
`kind: 'TRANSACTION'` in
`apps/wallet-console/src/products/wallet/policy-engine/PolicyEngineWorkspace.tsx:902`.
The audit event already identifies the resource as Gas sponsorship. Approval links
use the same routing helper; their destination is a source-inspection concern,
not a separately completed browser test.

Local browser evidence:

- `output/playwright/console-review-2026-09-28/audit-policy-link.txt`
- `output/playwright/console-review-2026-09-28/audit-policy-link.png`

## Page-by-page coverage

| Page              | Verified in the live browser                                                                                                                                                                                                                                                                  | Remaining limits                                                                                                                                                                                                                                                   |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Observability     | Initial data load; 7-day window, Error level, and search inputs respond; empty incident and service-health states render.                                                                                                                                                                     | No records available to verify row details or filtering against populated data.                                                                                                                                                                                    |
| Account settings  | Edit dialog opens; unchanged profile Save succeeds with “Profile updated”; rename dialog opens and cancels; organization Open navigates to overview; Create an organization opens onboarding.                                                                                                 | No real rename, backup-email addition/removal, organization creation, leave, or deletion. Empty backup Add returns a technical “At least one mutable field is required” error rather than field-specific guidance.                                                 |
| Team members      | Existing membership loads; search excludes and restores the member; Invite opens; switching to Administrator shows permission controls; Cancel closes; row menu opens. Sole-owner Edit is disabled.                                                                                           | No invitation sent, accepted, or revoked; no member role changes, suspension, or removal. No pending invitations exist.                                                                                                                                            |
| API keys          | Credential list loads; Create dialog opens; scope toggle responds; switching secret/publishable changes fields; existing active-key Edit opens and cancels; Rotate/Revoke menu is present.                                                                                                    | Creation, saved edits, secret reveal/copy, rotation, revocation, and actual API authentication were not executed.                                                                                                                                                  |
| Deployment status | Active and verified binding loads with origins, activation, and receipt digest.                                                                                                                                                                                                               | Page is intentionally read-only and exposes no deployment action. This review does not independently rerun the canary or verify the digest.                                                                                                                        |
| Webhooks          | Empty-state Add endpoint and sidebar New webhook endpoint both open the form; event selection works; malformed URL shows validation and disables submission; Cancel and Close work.                                                                                                           | No endpoint exists. Creation, secret reveal, actual delivery, retry/replay, disable, rotation, and deletion require a controlled receiver and test data.                                                                                                           |
| Gas sponsorship   | Existing policy loads; View/Close works; row menu and Edit/Cancel work; Create and sidebar shortcut open; Add contract, protocol choice, cap choice, and weekly period controls respond; Top up balance navigates to billing.                                                                 | Balance is $0 and the page correctly reports sponsored execution blocked. No saved policy mutation, disabling, deletion, reservation, or sponsored execution was performed. Draft-discard confirmation could not be reliably completed through browser automation. |
| Policy engine     | Search and status/impact filters change results; Details opens; transfer simulation returns ALLOW for Ethereum amount 10000; Edit opens; standard Create, wallet override, and sidebar New policy open; allowlist/Add contract work; missing wallet validation appears; Go live review opens. | Version loading and audit deep-link defects above. No draft saved, approval created/decided, policy published, assignment changed, or policy deleted. No wallet target exists for a complete override flow.                                                        |
| Audit             | Real events load; View expands an event; category + outcome + actor filters reduce records; Clear all restores them; search empty state disables export; 30-day range, previous/next period, and timestamp-jump controls respond.                                                             | Gas sponsorship deep link fails. Export was clicked, but the browser download event timed out, so CSV completion/content remain unverified. Chart drag-selection/focus and pagination were not exercised.                                                          |
| Billing account   | Summary loads; $10/$25/$50 selection updates Buy label; $10 opens the matching Stripe sandbox checkout; warning Dismiss works; gas sponsorship Top up routes here.                                                                                                                            | Cancel return fails. No payment details entered, payment submitted, credits settled, refund, or sponsorship reconciliation performed.                                                                                                                              |
| Invoices          | Empty list loads; document type/status controls respond; start/end inputs accept 2026-09-01 and 2026-09-28 and return an empty result.                                                                                                                                                        | Zero documents exist. Invoice detail, receipt/PDF download, and document-specific payment actions remain unverified.                                                                                                                                               |

Shared controls: page search filters and navigates to Deployment status; account
menu navigates to Account settings; sidebar collapse/expand works; workspace and
product menus open and expose disabled unavailable choices. The Docs destination
loads **Start here | Seams**. Sign out and changing workspace/product were not
executed.

## Review side effects and tooling limits

- Saved the profile once with its existing values. No profile values changed.
- Created one uncompleted $10 Stripe sandbox checkout session, then used its Back
  link. No payment was made.
- Ran one policy simulation. No policy or access control was changed.
- Exercised local filter and form draft state. No team invitation, webhook
  delivery, credential mutation, organization deletion, or policy publication was
  submitted.
- Native draft confirmation handling caused a browser-control timeout; review
  continued in a fresh authenticated tab. This is recorded as a tooling limit,
  not an application defect.
- Automatic browser security review rejected `chrome://downloads/`, preventing
  download-history inspection. Filesystem access to Downloads was also denied.
  The export is therefore unverified, rather than classified as a product failure.

The detailed evidence files are local, ignored artifacts under
`output/playwright/console-review-2026-09-28/`. The committed report omits account
email addresses and credential material.

## Completion criteria for a full verification pass

Repair and redeploy the three findings, then repeat their reproduction steps.
Complete mutation and recovery scenarios in a disposable organization with a
controlled invitation recipient, webhook receiver, test wallets, and billing
documents. Verify persisted state after reload, credential authentication,
webhook delivery/replay, policy approval/publish, and billing settlement/receipts.
Use a verifiable CSV artifact to finish the export check. Until then, these pages
cannot be certified as having every button and end-to-end flow working.
