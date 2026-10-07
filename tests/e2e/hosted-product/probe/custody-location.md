# Temporary custody location probes

These wrappers observe A execution, B execution, and their wallet Durable Objects.
They are hosted E2E diagnostics. They must not remain deployed after measurement.

1. Record the active Worker versions and confirm that no concurrent experiment uses them.
2. Copy each exact deployed role bundle into a separate probe directory named `base`.
3. Copy `custody-location.mjs` and the matching `deriver-*-placement.mjs` beside `base`.
4. Copy the existing role deployment configuration. Change only `main` to the matching wrapper.
5. Run Wrangler dry runs. Preserve existing bindings, migrations, variables, and secrets.
6. Deploy the wrappers to the authorized staging Workers. Record the resulting versions.
7. Attach JSON tails for A and B before running `near-signing-latency.test.ts`.
8. Run its three `hosted NEAR-only sample` cases with the matching frozen candidate assets and projection.
9. Group `custody_execution_location_probe` events by `pairDigest` and `scopes`.
10. Restore the exact original versions, including when the benchmark fails. Verify restoration against the provider.
11. Run the same three cases without wrappers for latency measurements.

Use the existing hosted Playwright configuration and its candidate environment
variables. A/B use separate deployment configurations. Each wrapper imports its
role's original `base/index.js` and keeps the original exported classes available.

Record unmatched pairs and missing telemetry explicitly. A execution and A DO
share one context. The trace location is an outbound observation, not a physical
host guarantee. `loc` is raw trace metadata, not the execution country.
Observer requests add latency. Keep diagnostic and uninstrumented timings separate.

The initial run passed the four-region local custody E2E with the wrappers before
deployment. It then verified 42 signatures across six hosted wallets.
See [the measurement report](../../../../docs/r155b-custody-location-20261007.md).
