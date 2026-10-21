# Wallet pricing and costs

Date: October 21, 2026

Status: proposed. The public pricing page and the Console billing code do not use
this model yet.

## Price model

Seams charges per monthly active user (MAU), at least 20% below Dynamic's list
price at every size. Each MAU includes a signature allowance of 10 signatures a
day. Signatures above the allowance have a published price.

| Plan       | Price                        | Users included | Signature allowance |
| ---------- | ---------------------------- | -------------: | ------------------- |
| Free       | $0                           |      Up to 250 | 25,000 / month      |
| Growth     | $99 / month                  |    Up to 5,000 | 300 per MAU, pooled |
| Growth     | + $0.004 per MAU above 5,000 |              — | 300 per MAU, pooled |
| Enterprise | Committed volume             |     Negotiated | Negotiated          |

- **Pooled allowance:** the app gets 300 signatures for each MAU, for all its
  users together. With 10,000 MAU, the pool is 3,000,000 signatures. A few busy
  users do not cause a charge if the average stays below 300.
- **Above the pool:** $0.05 per 1,000 signatures on Growth. Enterprise starts at
  $0.03 per 1,000 signatures.
- **Gas and chain fees** pass through at cost.
- **Registration** has a fair-use rate limit. A new user costs about $0.0001, so
  bot sign-ups are cheap but not free.
- **The public page** says that prices may change and that they follow our own
  hosting costs.

## Free plan limits

The free plan costs us money for each organization that uses it. These limits
keep that cost bounded:

1. **One free plan per organization.** The free plan does not apply per project
   or per environment. The Console already bills per organization.
2. **One free organization per browser origin.** An app registers its browser
   origins on its publishable key. An origin can belong to only one free
   organization, so one app cannot split its users over several free plans.
3. **A hard stop at the free limits until a card is on file.** At 250 MAU, new
   sign-ups stop. At 25,000 signatures in a month, signing stops. With a card on
   file, the organization moves to Growth.
4. **An internal alert on the total free-plan cost.** Start with an alert at
   $500 a month of Cloudflare cost for all free organizations together.

Cost of one free organization each month:

| Use                                    | Signatures / month | Our cost |
| -------------------------------------- | -----------------: | -------: |
| Full allowance: 250 users at 3 a day   |             25,000 |   ~$0.25 |
| Typical small app: 50 users at 3 a day |              4,500 |   ~$0.05 |

Cost of all free organizations each month:

| Free organizations | All at the full allowance | 90% typical, 10% at the full allowance |
| -----------------: | ------------------------: | -------------------------------------: |
|                100 |                       $25 |                                    ~$7 |
|              1,000 |                      $253 |                                   ~$70 |
|             10,000 |                    $2,525 |                                  ~$703 |

The free allowance is half of Privy's free tier (499 MAU and 50,000
signatures). It costs about one twelfth of the earlier allowance of 1,000 users
and 300,000 signatures.

During a stop, recovery and key export stay open, so no user loses access to
funds. Both have rate limits. If we find abuse, we tighten those limits.

## Why this shape

- **Buyers compare MAU prices.** Dynamic and Privy publish MAU prices. A price in
  the same unit shows the difference at once: $99 against $249, and $0.004
  against $0.005.
- **Our cost follows signatures.** A user who makes 10 signatures a day costs
  about 30 times more each month than the registration of that user. The
  allowance and the published overage keep heavy apps profitable.
- **The allowance covers the planning workload.** 300 signatures a month is 10 a
  day, so an app at that average pays no overage.
- **Half of Dynamic's price is below our cost.** At 10 a day, one user costs us
  about $0.003 a month. $0.004 per MAU is the lowest round price that stays 20%
  below Dynamic and keeps a positive margin.
- **We publish what Dynamic hides.** Dynamic says "rate limits apply" and gives no
  numbers. We publish the allowance and the overage price.

## Measured cost

Source: staging tail logs from October 19, 2026, for 9 registrations, each with
one first signature. The logs cover all six Workers: Gateway, Router, Deriver A,
Deriver B, SigningWorker, and Console. The local evidence folder is
`.artifacts/router-latency-20261019/fixed-final` (not in Git).

Method:

1. Keep tail events inside the measurement window, plus 15 s for work after the
   response.
2. Sum `cpuTime` for all invocations.
3. Count Gateway requests only. Service-binding calls between Workers have no
   request fee.
4. Count Durable Object requests, and sum their `wallTime` as duration at 128 MB.

| Item                      | Per new user, with first signature |          Cost |
| ------------------------- | ---------------------------------: | ------------: |
| CPU time                  |                           2,749 ms |     $0.000055 |
| Worker requests (Gateway) |                                 22 |     $0.000007 |
| Durable Object requests   |                                 18 |     $0.000003 |
| Durable Object duration   |                          0.79 GB-s |     $0.000010 |
| **Measured total**        |                                    | **$0.000074** |

- A new user costs about **$0.0001** when we add the unmeasured row writes.
- One signature uses about 270 ms of CPU across Gateway, Router, and
  SigningWorker. With requests and storage, one signature costs about
  **$0.00001**. This is an upper estimate.
- CORS preflights are a cost per browser session, not per signature. The Gateway
  answers preflights with `Access-Control-Max-Age: 600`. seams-wallet `85269cab`
  raises this to 7200, the Chromium limit; it is not released yet. At
  registration start, the SDK sends an early `OPTIONS` fetch to each signing
  route, and the browser sends a preflight before each of these fetches. The
  sample has 4 `OPTIONS` requests per user, about 60 ms of CPU in total. Later
  signatures inside the cache time send no preflight.

Cloudflare prices used (Workers Paid, October 2, 2026 price page):

| Item                    | Price                   |
| ----------------------- | ----------------------- |
| Worker requests         | $0.30 per million       |
| CPU time                | $0.02 per million ms    |
| Durable Object requests | $0.15 per million       |
| Durable Object duration | $12.50 per million GB-s |
| D1 rows read            | $0.001 per million      |
| D1 rows written         | $1.00 per million       |
| D1 storage              | $0.75 per GB-month      |

The $5 monthly plan fee and the included monthly usage are not in the per-unit
figures.

## Cost and price at 10 signatures a day

The planning assumption is 10 signatures per user per day on average. One user
makes 300 signatures a month and costs us about $0.003. The pool covers all of
them, so there is no overage. The table assumes that 10% of users are new each
month.

| Users     | Signatures / month | Our cost |  Seams | Margin | Seams per user |
| --------- | -----------------: | -------: | -----: | -----: | -------------: |
| 1,000     |            300,000 |       $3 |    $99 |    97% |         $0.099 |
| 10,000    |          3,000,000 |      $30 |   $119 |    75% |         $0.012 |
| 100,000   |         30,000,000 |     $301 |   $479 |    37% |         $0.005 |
| 1,000,000 |        300,000,000 |   $3,010 | $4,079 |    26% |         $0.004 |

- The margin falls with size, because $0.004 per MAU is close to our cost of
  $0.003 per MAU. At 1,000,000 users, the margin is 26%.
- If a warm signature costs $0.000007, the margin at 1,000,000 users is 48%.
- The overage price is 5 times our signature cost, so apps above the pool add
  margin near 80% on the extra signatures.
- At large sizes, Enterprise contracts and dedicated infrastructure carry the
  margin. See [Infrastructure at scale](#infrastructure-at-scale).

## Competitor prices

Read from the public pricing pages on October 21, 2026.

| Item       | Privy                                   | Dynamic                         |
| ---------- | --------------------------------------- | ------------------------------- |
| Free       | 0–499 MAU, live                         | Sandbox only                    |
| Entry plan | $299 / month, 500–2,499 MAU             | $249 / month, up to 5,000 MAU   |
| Next plan  | $499 / month, 2,500–9,999 MAU           | None                            |
| After that | $2,000 base + $0.05 per MAU over 10,000 | $0.005 per MAU over 5,000       |
| Signatures | 50,000 free, then $0.01 each            | No fee; unpublished rate limits |
| Enterprise | From $0.001 per signature               | Custom                          |

Privy's pay-as-you-go price starts when an app exceeds 10,000 MAU or 50,000
signatures.

### Dynamic: "Rate limits apply"

Dynamic's Growth plan has no signature fee, but its pricing page says "Rate
limits apply". The limits are not published. We expect an app with heavy
signing to reach those limits and move to Dynamic's Enterprise plan at a custom
price. We have not confirmed this. Thus Dynamic's list price is a real price only
for light use.

Every published Seams price is below the matching Dynamic price:

| Item                 | Dynamic                  | Seams                      |
| -------------------- | ------------------------ | -------------------------- |
| Live app, few users  | $249 / month             | $0 up to 250 MAU           |
| Up to 5,000 MAU      | $249 / month             | $99 / month                |
| Each MAU above 5,000 | $0.005                   | $0.004                     |
| Heavy signing        | Rate limits, then custom | $0.05 per 1,000 signatures |

Seams compared with Dynamic's list price, per month:

| Signatures per user per day | 1,000 users      | 10,000 users     | 100,000 users    | 1,000,000 users      |
| --------------------------: | ---------------- | ---------------- | ---------------- | -------------------- |
|                      0.3–10 | **$99** vs $249  | **$119** vs $274 | **$479** vs $724 | **$4,079** vs $5,224 |
|                          30 | **$129** vs $249 | $419 vs $274¹    | $3,479 vs $724¹  | $34,079 vs $5,224¹   |

¹ Dynamic's list price applies here only if its rate limits allow this volume.
We expect Dynamic to quote Enterprise prices for these apps.

- Up to 10 signatures per user per day, Seams is at least 20% below Dynamic at
  every size: 60%, 57%, 34%, and 22% below.
- Above 10 a day, the overage makes Seams more expensive than Dynamic's list
  price. Dynamic's rate limits apply in that range.

The same workload of 10 signatures a day, compared with Privy:

| Users     |  Seams | Privy pay-as-you-go | Privy Enterprise |
| --------- | -----: | ------------------: | ---------------: |
| 1,000     |    $99 |              $4,500 |             $300 |
| 10,000    |   $119 |             $31,500 |           $3,000 |
| 100,000   |   $479 |            $306,000 |          $30,000 |
| 1,000,000 | $4,079 |          $3,051,000 |         $300,000 |

- Seams is 3 times below Privy Enterprise at 1,000 users, and 25 times or more
  below from 10,000 users.
- Do not name competitors on the public page. Their prices change.

Sources:

- [Privy pricing](https://www.privy.io/pricing)
- [Dynamic pricing](https://www.dynamic.xyz/pricing)
- [Cloudflare Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/)

## Limits of the cost figures

- The sample is 9 first signatures on staging. A warm signature may cost less.
  The likely range is $0.000005–$0.00001.
- The tail logs do not show D1 or Durable Object row writes.
- Durable Object duration from `wallTime` is a lower bound. An object stays
  billed while it cannot hibernate.
- The margin at scale is sensitive to this error. If a signature costs 2 times
  the estimate, the price at $0.004 per MAU is below our cost from about 100,000
  users at 10 signatures a day.

## Infrastructure at scale

Cloudflare is the right base for our stage. It has no fixed cost per role and
no idle servers, so a small customer costs almost nothing.

At a large size, a dedicated deployment can give better unit economics: the
private celld runtime and PostgreSQL on AWS. Cloudflare request, Durable Object,
and D1 fees do not apply there. The cost becomes servers and a database at a
fixed monthly price.

This path is not ready yet:

- [celld](../../deployment/celld/README.md) is qualified on Google VMs. AWS,
  distributed deployment, and release promotion are outside its current scope.
- The Wallet role store has a PostgreSQL backend. The Console and Gateway stores
  still use D1. See [Wallet PostgreSQL preparation](../wallet-postgresql-preparation.md).
- We have no measured cost for a dedicated deployment. A minimum deployment has
  separate servers for each role, with redundancy, and a managed database. Its
  fixed monthly cost sets the size at which it is cheaper than Cloudflare.

Until this path is measured, the Enterprise price must cover the Cloudflare
cost.

## Before publication

1. Measure a run of 300 or more signatures for one user, on warm isolates, and
   one later browser session for the preflight cost.
2. Read D1 and Durable Object row counts for that run from the Cloudflare
   analytics.
3. Recompute the margin table.
4. Update the Wallet price definitions in the Console billing code. The public
   pricing page in `apps/seams-site` already shows this model.
5. Build the free plan limits in the Console: the origin check across free
   organizations, the hard stop, the card requirement, and the cost alert.
