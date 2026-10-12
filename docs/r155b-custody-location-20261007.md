# R155B: live custody location observations, 2026-10-07

**Timing correction:** [the subsequent diagnosis](r155b-custody-latency-diagnosis-20261007.md)
uses provider CPU and wall telemetry. Application timers freeze during CPU work.
The 285 ms A span does not establish parity with a local CPU benchmark.
Likewise, the caller spans below do not isolate DO network latency.

The captured staging requests show HKG for all four requested contexts.
This run found no regional split between A execution, B execution, A's DO, and B's DO.
The sample does not establish a placement guarantee or a 99% compliance rate.

## Method and location results

Temporary JavaScript wrappers observed the exact deployed Rust/WASM bundles.
Each wrapper fetched `https://cloudflare.com/cdn-cgi/trace` from its execution context.
The `colo` field identifies the location serving that outbound probe.
It does not prove physical host identity. The returned `loc=JP` field is raw
probe metadata and must not be interpreted as the execution country.

| Context | Observed colo | Distinct wallet pairs | Observations |
| --- | --- | ---: | ---: |
| A protocol execution | HKG | 3 | 3 |
| A wallet DO | HKG | 3 | 3 |
| B protocol execution | HKG | 2 | 2 |
| B wallet DO | HKG | 2 | 6 |

A runs the protocol inside its wallet DO. Those two rows share one observation.
B runs the protocol in its Worker and calls its wallet DO for session state.
Two wallets have complete observations across all four contexts.
The first wallet lacks B tail telemetry. Do not count it as a matched placement sample.

The probes used three fresh wallets and verified 21 NEAR signatures.
The observer added work to the request path. Those timings are excluded below.

## Uninstrumented latency control

The exact original A/B versions were restored before this separate run.
Three further fresh wallets produced 21 verified signatures.

| Measurement | Samples | Median | Range, including maximum |
| --- | ---: | ---: | ---: |
| Yao registration execute HTTP request | 3 | 6.173 s | 5.514–6.692 s |
| A WebSocket connection to B | 3 | 807 ms | 723–956 ms |
| A Yao protocol span | 3 | 285 ms | 263–1,347 ms |
| B role execution span | 3 | 424 ms | 391–1,532 ms |
| B DO call: prepare pair | 3 | 1,294 ms | 1,133–1,789 ms |
| B DO call: begin pair | 3 | 659 ms | 533–677 ms |
| B DO call: complete pair | 3 | 162 ms | 140–1,270 ms |
| A DO execute handler | 3 | 1,627 ms | 1,583–2,886 ms |

These spans overlap. Do not sum their medians or subtract them to calculate an
unmeasured network delay. Protocol spans include peer communication and are not
isolated CPU benchmarks. B's protocol span reports zero at the available clock
resolution. This does not establish zero computation cost.

Across nine observed B commands, the internal DO handler median was 0 ms and the
maximum was 303 ms. The caller span includes the full DO call and response parsing.
This supports further investigation of dispatch, scheduling, startup, and response
delivery. It does not isolate which mechanism caused the delay.

| SDK/workflow measurement | Samples | Median | Range, including maximum |
| --- | ---: | ---: | ---: |
| Registration → first independently verified signature | 3 | 20.590 s | 18.245–22.304 s |
| Unlock → first independently verified signature | 3 | 4.965 s | 4.955–4.981 s |
| SDK signing after unlock | 3 | 1.544 s | 1.526–1.894 s |
| SDK warm signing | 6 | 2.212 s | 1.713–2.978 s |
| SDK consecutive signing, per signature | 9 | 1.757 s | 1.378–2.367 s |

SDK timers include automated confirmation. Registration includes onboarding,
NEAR provisioning, and funding. The harness verifies signatures without broadcasting
the signed transfer. Browser contexts and wallets were fresh. Worker cold starts
were not independently controlled. No same-candidate A/B placement experiment was
performed, so this run does not establish a latency gain from placement changes.

## Deployment and evidence

The run used existing staging testnet resources. No production resources changed.
No new infrastructure or paid plan was provisioned.
All 13 candidate Worker versions matched before the run and after restoration.

- A restored version: `eaa0b80f-47bf-44a9-b9b5-4f73a70abcd0`.
- B restored version: `c700bbc1-b87f-4182-9f64-ff2bf33eead8`.
- Public custody source: `7d9956879187ae410518d9ec02de96fb5056a52b`.
- Private deployment source: `2e597ab2cd38df9dce30d69367ed10db3becd23d`.
- Hosted harness source: `d825fdf`.
- Restoration completed at `2026-10-07T10:31:42Z`.
- Both measurement arms and final version checks completed at `2026-10-07T10:33:57Z`.

[Sanitized evidence](evidence/r155b-custody-location-20261007.json) records the
observations, span summaries, sample counts, and all deployment versions.
[Probe instructions](../tests/e2e/hosted-product/probe/custody-location.md) describe
the temporary wrappers. Raw tails remain in ignored local artifacts because they
can contain request credentials.

The next optimization targets are repeated root admission and the B session-state
call path. The complete setup request remains above the two-second target.
Use provider telemetry and a matching local WASM benchmark to assess CPU cost.
