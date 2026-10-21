# Wallet pricing and costs

Date: October 21, 2026

Status: proposed. The public pricing page and the Console billing code do not use
this model yet.

## Price model

Seams charges per monthly active user (MAU), at half of Dynamic's list price or
less. Each MAU includes a signature allowance. Signatures above the allowance
have a published price.

| Plan       | Price                         | Users included | Signature allowance |
| ---------- | ----------------------------- | -------------: | ------------------- |
| Free       | $0                            |    Up to 1,000 | 100,000 / month     |
| Growth     | $99 / month                   |    Up to 5,000 | 100 per MAU, pooled |
| Growth     | + $0.0025 per MAU above 5,000 |              — | 100 per MAU, pooled |
| Enterprise | Committed volume              |     Negotiated | Negotiated          |

- **Pooled allowance:** the app gets 100 signatures for each MAU, for all its
  users together. With 10,000 MAU, the pool is 1,000,000 signatures. A few busy
  users do not cause a charge if the average stays below 100.
- **Above the pool:** $0.05 per 1,000 signatures on Growth. Enterprise starts at
  $0.03 per 1,000 signatures.
- **Gas and chain fees** pass through at cost.
- **Registration** has a fair-use rate limit. A new user costs about $0.0001, so
  bot sign-ups are cheap but not free.

## Why this shape

- **Buyers compare MAU prices.** Dynamic and Privy publish MAU prices. A price in
  the same unit shows the difference at once: $99 against $249, and $0.0025
  against $0.005.
- **Our cost follows signatures.** A user who makes 10 signatures a day costs
  about 30 times more each month than the registration of that user. The allowance and the
  published overage keep heavy apps profitable.
- **The allowance covers normal use.** 100 signatures a month is about 3 a day.
  At that level, the margin at $0.0025 per MAU is 60% or more.
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
  answers preflights with `Access-Control-Max-Age: 600`. At registration start,
  the SDK sends an early `OPTIONS` fetch to each signing route, and the browser
  sends a preflight before each of these fetches. The sample has 4 `OPTIONS`
  requests per user, about 60 ms of CPU in total. Later signatures in the next 10
  minutes send no preflight.

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
makes 300 signatures a month and costs us about $0.003. The pool covers 100 of
those signatures, so 200 per user are overage. The table assumes that 10% of
users are new each month.

| Users     | Signatures / month | Our cost |      Seams | Margin | Seams per user |
| --------- | -----------------: | -------: | ---------: | -----: | -------------: |
| 1,000     |            300,000 |       $3 |       $109 |    97% |         $0.109 |
| 10,000    |          3,000,000 |      $30 |    $211.50 |    86% |         $0.021 |
| 100,000   |         30,000,000 |     $301 |  $1,336.50 |    77% |         $0.013 |
| 1,000,000 |        300,000,000 |   $3,010 | $12,586.50 |    76% |         $0.013 |

The overage price is 5 times our signature cost, so the margin stays near 80%
for heavy apps. The Enterprise floor of $0.03 per 1,000 keeps it near 67%.

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
for light use, which is about the same use that our pooled allowance covers.

Every published Seams price is below the matching Dynamic price:

| Item                 | Dynamic                  | Seams                      |
| -------------------- | ------------------------ | -------------------------- |
| Live app, few users  | $249 / month             | $0 up to 1,000 MAU         |
| Up to 5,000 MAU      | $249 / month             | $99 / month                |
| Each MAU above 5,000 | $0.005                   | $0.0025                    |
| Heavy signing        | Rate limits, then custom | $0.05 per 1,000 signatures |

Seams compared with Dynamic's list price, per month:

| Signatures per user per day | 1,000 users      | 10,000 users        | 100,000 users       | 1,000,000 users         |
| --------------------------: | ---------------- | ------------------- | ------------------- | ----------------------- |
|                         0.3 | **$0** vs $249   | **$111.50** vs $274 | **$336.50** vs $724 | **$2,586.50** vs $5,224 |
|                           1 | **$0** vs $249   | **$111.50** vs $274 | **$336.50** vs $724 | **$2,586.50** vs $5,224 |
|                           3 | **$0** vs $249   | **$111.50** vs $274 | **$336.50** vs $724 | **$2,586.50** vs $5,224 |
|                          10 | **$109** vs $249 | **$211.50** vs $274 | $1,336.50 vs $724¹  | $12,586.50 vs $5,224¹   |
|                          30 | **$139** vs $249 | $511.50 vs $274¹    | $4,336.50 vs $724¹  | $42,586.50 vs $5,224¹   |

¹ Dynamic's list price applies here only if its rate limits allow this volume.
We expect Dynamic to quote Enterprise prices for these apps.

- Up to 3 signatures per user per day, Seams costs half of Dynamic or less at
  every size.
- At 10 a day, Seams is below Dynamic's list price up to about 10,000 users and
  above it from about 100,000 users.
- At 10 a day, one user costs us $0.003 a month, and Dynamic lists $0.005. At
  Dynamic's price, our margin can be 40% at most. Half of Dynamic's price is below
  our cost.
- To charge half of Dynamic's price ($0.0025 per MAU) for 300 signatures with a
  50% margin, one signature must cost $0.000004. After the request fees, that
  leaves about 160 ms of CPU. Now a signature uses about 270 ms.

The same workload of 10 signatures a day, compared with Privy:

| Users     |      Seams | Privy pay-as-you-go | Privy Enterprise |
| --------- | ---------: | ------------------: | ---------------: |
| 1,000     |       $109 |              $4,500 |             $300 |
| 10,000    |    $211.50 |             $31,500 |           $3,000 |
| 100,000   |  $1,336.50 |            $306,000 |          $30,000 |
| 1,000,000 | $12,586.50 |          $3,051,000 |         $300,000 |

- Seams is below Privy Enterprise at every size: almost 3 times below at 1,000
  users, and 14–24 times below from 10,000 users.
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
- At 300 signatures per user, a 2 times error in the signature cost moves the
  margin at 100,000 users from 77% to 55%.

## Before publication

1. Measure a run of 300 or more signatures for one user, on warm isolates, and
   one later browser session for the preflight cost.
2. Read D1 and Durable Object row counts for that run from the Cloudflare
   analytics.
3. Recompute the margin table.
4. Update the public pricing page and the Wallet price definitions in the Console
   billing code.
