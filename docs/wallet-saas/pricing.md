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
- **Our cost follows signatures.** A user who makes 30 transactions a day costs
  about 50 times more than the registration of that user. The allowance and the
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
- One signature uses about 360 ms of CPU. With requests and storage, one
  signature costs about **$0.00001**.

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

## Cost and price at 30 transactions a day

One user makes 900 signatures a month and costs us about $0.009. The pool
covers 100 of those signatures, so 800 per user are overage. The table assumes
that 10% of users are new each month.

| Users     | Signatures / month | Our cost |      Seams | Margin | Seams per user |
| --------- | -----------------: | -------: | ---------: | -----: | -------------: |
| 1,000     |            900,000 |       $9 |       $139 |    94% |         $0.139 |
| 10,000    |          9,000,000 |      $90 |    $511.50 |    82% |         $0.051 |
| 100,000   |         90,000,000 |     $901 |  $4,336.50 |    79% |         $0.043 |
| 1,000,000 |        900,000,000 |   $9,010 | $42,586.50 |    79% |         $0.043 |

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
- Above that, Seams is above Dynamic's list price. No profitable Seams price can
  match that list price: at 30 a day, one user costs us $0.009, and Dynamic lists
  $0.005. To match it with an 80% margin, one signature must use about 50 ms of
  CPU, 7 times less than now.

The same workload of 30 transactions a day, compared with Privy:

| Users     |      Seams | Privy pay-as-you-go | Privy Enterprise |
| --------- | ---------: | ------------------: | ---------------: |
| 1,000     |       $139 |             $10,500 |             $900 |
| 10,000    |    $511.50 |             $91,500 |           $9,000 |
| 100,000   |  $4,336.50 |            $906,000 |          $90,000 |
| 1,000,000 | $42,586.50 |          $9,051,000 |         $900,000 |

- Seams is 6 times or more below Privy Enterprise at every size.
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
- At 900 signatures per user, a 2 times error in the signature cost moves the
  margin from 80% to 60%.

## Before publication

1. Measure a run of 600 or more signatures for one user, on warm isolates.
2. Read D1 and Durable Object row counts for that run from the Cloudflare
   analytics.
3. Recompute the margin table.
4. Update the public pricing page and the Wallet price definitions in the Console
   billing code.
