# Hosted candidate lifecycle

This test serves the candidate browser bundle under the active staging application's
and wallet iframe's origins. Gateway, Console, custody and chain requests use the
real network. It verifies registration, lock/reload, unlock, key export and an ECDSA
signature. It cancels an unclaimed link, verifies unchanged inventory, then links Device 2 with one lost activation response and two lost
cleanup acknowledgements, verifies both signer families, revokes Device 2 and
verifies that only the owner can continue signing. Local browser assets do not
prove a frontend deployment has completed. A second case verifies that an unlock
request containing an unprovisioned target produces a visible retryable failure.

Use an already built public Wallet checkout and an activated staging tenant. From
the private repository:

```sh
export SEAMS_WALLET_SERVER_CANDIDATE=/absolute/path/to/seams-wallet/packages/wallet-server
export SEAMS_TEST_ARTIFACT_DIR="$PWD/.artifacts/r152/hosted-product"
export SEAMS_HOSTED_PROJECTION="$SEAMS_TEST_ARTIFACT_DIR/projection.json"
export SEAMS_HOSTED_CANDIDATE_SITE="$SEAMS_TEST_ARTIFACT_DIR/site"
mkdir -p "$SEAMS_TEST_ARTIFACT_DIR"
curl --fail --silent --show-error https://staging.api.wallet.seams.sh/.well-known/seams-tenant-deployment.json --output "$SEAMS_HOSTED_PROJECTION"
node tests/scripts/build-hosted-candidate.mjs
node "$SEAMS_WALLET_SERVER_CANDIDATE/../../node_modules/@playwright/test/cli.js" test -c tests/playwright.hosted-product.config.mjs
```

`lifecycle.json` records completed operation durations and Gateway request timing,
including unfinished/background requests. Missing D1 telemetry remains null; HTTP
request counts are not D1-call counts. The Playwright lifecycle attachment retains
detailed diagnostic evidence. The run creates a disposable staging wallet.

The regional travel test requires `SEAMS_HOSTED_PROBE`, pointing to a protected
JSON file containing `workerUrl` and `accessToken` for the temporary probe Worker.
Its Containers forward only the staging Gateway origin. The test registers three
wallets concurrently from the three physical probe regions, then signs with the
same WEUR-created wallet through WEUR, APAC, US and WEUR again. It also exercises
concurrent Tempo and Arc signing. `regional-travel.json` distinguishes regional
request duration from local-browser duration, which includes the extra proxy hop.
Container identity is retained with each request; no request credentials or bodies
are written into the evidence. Stop all three Containers after the run.

`mpc-signing-latency.test.ts` measures the native browser path without a regional
probe. The `back_to_back` case verifies nine Tempo signatures across three unlocks.
The `prefilled` case verifies one warm-up signature per unlock, waits for at least
three presignatures, then measures two signatures. It records those prefill waits
separately and rejects any measured sample that waits for refill. Both cases also
verify concurrent Tempo and Arc signatures. Set `SEAMS_INTENDED_SIGNING_SESSION_DEBUG=1` to capture
the SDK's stage timings. Set `SEAMS_INTENDED_PERSIST_TRACE=1` and
`SEAMS_INTENDED_TRACE_DIR` to retain the lifecycle trace beside the timing artifacts.

The primary timer covers the public SDK call, including automated confirmation,
through the assembled signature. Independent signature verification follows it.
The test does not time broadcast or blockchain confirmation. Stage timings can
overlap. Report samples with `refill_wait` separately from samples with ready
material. Each `mpc-signing-<workload>.json` artifact retains allowlisted Gateway timing and placement
headers, request activity, and browser automation overhead.
