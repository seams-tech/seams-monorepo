# Yao peer-disconnect qualification

The local Durable Object transport passes the real Yao disconnect scenario on both runtimes.
The celld run also keeps the interrupted pair burned across restart.
The runtime patch and application handlers are unchanged.
See [the qualification record](evidence/yao-peer-disconnect.json).

The shared proxy interrupts the second message from Deriver B.
Both roles report the pair as burned. An exact retry opens no new protocol connection.
A separate wallet then completes registration through the real roles.
After celld restarts, both roles still report burned state. A retry still opens no connection.
The test retains each temporary owner-unreachable response until the proxy's old lease expires.

These checks use a local synthetic S3 service. They do not establish distributed Yao recovery on Google Cloud.
They do not establish all-replica restore, relocation or tenant-root retirement.
The test verifies registration outcomes. The separate selected Wallet contracts verify signatures.

## Facts and instruments

| Fact | Instrument and control | Limit |
| --- | --- | --- |
| The original workerd script returns `MalformedWirePayload: Wallet object addresses are missing`. | An instrumented copy of the committed script reproduces the error before Deriver A runs. | This diagnoses the fixture, not a Wallet regression. |
| Current pair-status input requires `wallet_route`. | The Rust pair-scope types and neighboring placement E2E use this field. The corrected workerd scenario passes. | No production parser was widened. |
| The original native Worker proxy opens one connection, transfers zero protocol messages and closes before the selected fault. | Native evidence records counters, pair states and close callbacks. Workerd transfers one A message and two B messages. | A close callback does not identify the initial transport cause. |
| Celld returns a Worker-created upgrade response without `response.webSocket` across the sampled service binding. | Identical frozen echo scripts run on both runtimes. Workerd echoes in both retention arms. Celld returns 101 without a socket in both arms. | The observation arrays accumulate across arms. The recorded return phase precedes host-side request retirement. |
| An equivalent Durable Object bridge echoes on both runtimes. | The same client and owner scripts exercise a bridge owned by an object. Both retention arms receive `echo:ping`. | Celld's sampled upstream close callback reports 1006. This does not prove general close-event parity. |
| The shared object proxy reaches the selected Yao fault on both runtimes. | One A message and two B messages precede the injected disconnect. Burned states, exact retry and independent-wallet outcomes pass. | The native test does not require equal close-event ordering. |
| The interrupted native pair stays burned after restart. | The same namespace-issued addresses and captured execution are reused. Pair-state readback remains burned; the proxy records zero new protocol connections. | Persistent local state remains available. This is not complete storage-loss recovery. |

## Causes against the no-message failure

| Candidate | Echo control without Yao | Retaining the Worker request | Object bridge control | Result |
| --- | --- | --- | --- | --- |
| Yao cryptographic failure | Contradicted: the echo control also loses the Worker socket. | Says nothing. | Says nothing. | Removed as an explanation of this transport symptom. |
| Request retention alone | Fits the initial symptom. | Contradicted: retention still returns 101 without a socket. | Says nothing. | Removed as a sufficient fix. |
| Worker-created socket handoff across this service binding | Fits. | Fits. | Fits: the object-owned bridge transfers messages. | Measured runtime API limitation; the precise runtime defect remains unproved. |
| Measurement or fixture alone | The identical workerd scripts produce a non-zero echo. | Both arms keep the same client. | The native object control also produces a non-zero echo. | A broken zero-only instrument is contradicted. Other setup differences remain documented. |

## Test boundary and review

The fault proxy now runs in a Durable Object on both runtimes.
It uses the same WebSocket handler and the Wallet's existing peer transport model.
This adjustment changes the test launch boundary. It changes no Wallet route, protocol or storage owner.
Independent review required a successful object-bridge control before accepting the Yao evidence.
The recorded object control passes.

The Worker-created socket handoff remains an unqualified runtime API limitation.
The passing object scenario does not resolve it or establish general WebSocket parity.
A runtime fix would require the frozen Worker echo control and matching request-lifetime evidence.
No upstream issue or PR was opened.

## Earlier setup failures

The first native attempt lacked the Node test tool's `dotenv` resolution path.
A second attempt resolved the Moto virtual-environment executable to its base Python and lost Moto.
These are `environment_or_infrastructure_failure` cases. The driver now preserves the supplied Python path.

The old address and pair-status shapes are `obsolete_test_or_fixture` cases.
The early restart probe is `valid_test_needs_update`: public readiness precedes per-object takeover.
The final driver retries only the measured owner-unreachable error. Other failures stop the test.
All failed run records remain under the private `.artifacts` directory.
