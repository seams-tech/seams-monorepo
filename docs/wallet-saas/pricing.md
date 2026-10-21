# Wallet pricing and costs

Date: October 21, 2026

Status: proposed. The public pricing page and the Console billing code do not use
this model yet.

## Price model

Seams charges for signatures. Users are unlimited and free.

| Plan       | Price            | Included signatures | Overage                         |
| ---------- | ---------------- | ------------------: | ------------------------------- |
| Free       | $0               |        100,000 / mo | None. Upgrade to continue.      |
| Growth     | $99 / month      |      2,000,000 / mo | $0.05 per 1,000 signatures      |
| Enterprise | Committed volume |          Negotiated | From $0.03 per 1,000 signatures |

- Gas and chain fees pass through at cost.
- Registration has a fair-use rate limit. A new user costs about $0.0001, so bot
  sign-ups are cheap but not free.

## Why we meter signatures

- Our Cloudflare cost follows signatures, not users. A user who makes 30
  transactions a day costs about 50 times more than the registration of that user.
- A per-user price loses money for busy apps. At $0.0025 per user, a user with
  600 signatures a month costs us $0.006.
- Ecommerce Agents fit this meter. One agent is one user with thousands of
  signatures.
- "Unlimited users" separates us from Privy, which prices by user tiers.

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

One user makes 900 signatures a month and costs us about $0.009. The table
assumes that 10% of users are new each month.

| Users     | Signatures / month | Our cost |   Seams | Margin | Seams per user |
| --------- | -----------------: | -------: | ------: | -----: | -------------: |
| 100       |             90,000 |       $1 |      $0 |      — |             $0 |
| 1,000     |            900,000 |       $9 |     $99 |    91% |         $0.099 |
| 10,000    |          9,000,000 |      $90 |    $449 |    80% |         $0.045 |
| 100,000   |         90,000,000 |     $901 |  $4,499 |    80% |         $0.045 |
| 1,000,000 |        900,000,000 |   $9,010 | $44,999 |    80% |         $0.045 |

The Growth overage price is 5 times our signature cost, so the margin stays near
80% at every size. The Enterprise floor of $0.03 per 1,000 keeps it near 67%.

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

MAU means monthly active users. Privy's pay-as-you-go price starts when an app
exceeds 10,000 MAU or 50,000 signatures.

The same workload of 30 transactions a day, per month:

| Users     |   Seams | Privy pay-as-you-go | Privy Enterprise | Dynamic list |
| --------- | ------: | ------------------: | ---------------: | -----------: |
| 1,000     |     $99 |             $10,500 |             $900 |         $249 |
| 10,000    |    $449 |             $91,500 |           $9,000 |         $274 |
| 100,000   |  $4,499 |            $906,000 |          $90,000 |         $724 |
| 1,000,000 | $44,999 |          $9,051,000 |         $900,000 |       $5,224 |

- Seams is 20 times below Privy Enterprise at every size.
- Dynamic's list price is below our own cost at this volume. We expect its rate
  limits to move such apps to its Enterprise plan. Do not match that list price.
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
