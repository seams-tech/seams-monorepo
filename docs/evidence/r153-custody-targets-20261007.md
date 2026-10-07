# R153 physical custody and hosted relocation evidence

The scoped hosted acceptance passed on October 7, 2026. A real staging wallet moved
APAC → US → APAC, with ownership generations 1 → 2 → 3. Both moves completed source
cleanup. Fresh destination unlock, ECDSA transaction signing, and NEAR message
signing passed after each move. The E2E took 28.5 minutes.

The [machine-readable receipt](r153-custody-targets-20261007.json) records candidate
commits, deployed versions, exact custody locators, placement observations, timing
samples, and artifact hashes. Activation workflow
[37595927309](https://github.com/seams-tech/seams-monorepo/actions/runs/37595927309)
passed. The deployed backend remained fixed throughout the final run.

## Implementation and placement

Admission pins each custody role's account, namespace, class, deployment version,
and source/destination object IDs. It rejects a source/destination collision before
pause. Exact retries reuse the persisted targets. Linked-presign targets use the
server presignature identity and remain stable across preparation retries.

Generation-specific physical routing preserves logical cryptographic identities.
Fresh owner-presign hosts receive the admitted region locally. Routine signing and
refill gain no Console lookup or additional network call from this selection.
Ordinary locking retains valid durable presignatures. Relocation invalidates them.

The final observations were:

| Role          | Source APAC | Destination US | Return APAC |
| ------------- | ----------- | -------------- | ----------- |
| Router        | HKG         | ORD            | HKG         |
| Deriver A     | HKG         | ATL            | HKG         |
| Deriver B     | HKG         | ATL            | HKG         |
| SigningWorker | HKG         | IAD            | HKG         |

Each move used distinct physical object IDs. The probes originated inside those
objects. They establish broad regional placement, not city-level co-location.
D1 primary-query observations independently confirmed IAD, LHR, HKG, and SYD for
US, WEUR, APAC, and OC. Signer migration `0075` was present in all four regions.
Console migration `0088` stores immutable late presign targets. Existing credential
bindings were reused. No relocation-specific secret was added.

## Measurements

Pause is admission through the stored destination activation receipt. Cleanup time
is additional time after activation. Signing samples include automated UI approval.
The client ran in Japan. These are individual samples, not percentile benchmarks.

| Move      |                  Pause | Admission through cleanup |
| --------- | ---------------------: | ------------------------: |
| APAC → US |  513,190 ms / 8.55 min |    670,515 ms / 11.18 min |
| US → APAC | 744,056 ms / 12.40 min |    922,834 ms / 15.38 min |

| ECDSA sample                | Public SDK call |   Commit | Refill wait observed |
| --------------------------- | --------------: | -------: | -------------------: |
| APAC baseline 1             |        1,755 ms |   726 ms |                    — |
| APAC baseline 2             |        2,614 ms | 2,071 ms |               966 ms |
| First US signature          |        2,255 ms | 1,897 ms |                    — |
| Subsequent US signature 1   |        2,783 ms | 2,466 ms |               975 ms |
| Subsequent US signature 2   |        2,883 ms | 2,439 ms |             1,020 ms |
| First APAC return signature |        1,155 ms |   833 ms |                    — |

A dash means no refill-wait event was observed. It does not mean a zero-duration
refill. The receipt includes 14 successful refill-availability observations.
The multi-minute relocation pause remains a material performance limitation.
This run does not establish a signing-latency improvement or regression.

## Verification and repeatability

Existing directory, provider-binding, release-Worker transfer, and reusable owner
presign E2Es passed. Owner-presign evidence covers eight signatures, concurrency,
expiry, and eviction. The wallet-server build, hosted-test type check, and public
bloat check passed. The private aggregate type check still has six pre-existing
errors outside the changed relocation paths.

Earlier hosted runs exposed two production issues: country attribution used the
request IP instead of the observed datacenter, and move-read approvals were absent
from the authorization snapshot. Both were fixed before the final candidate.
Later assertion failures came from expecting a warm session or a passkey step-up
at a specific point after relocation. The final test uses the existing NEAR message
verifier. It verifies the original public key, signature, and altered-message
rejection. ECDSA retains its transaction and authentication assertions.

Raw artifacts are under `.artifacts/r153/custody-targets/`. Repeat from the private
repository with `sh .artifacts/r153/custody-targets/reproduce.sh`. The receipt pins
the tested source and browser-asset hashes. The command requires the same staging
projection, candidate assets, and deployed backend. Earlier failed runs remain in
separate artifact directories and are excluded from the final acceptance result.

Remaining broader measurements are total transferred bytes and hosted interference
with unrelated wallets. This owner-wallet scenario has no linked-presign transfer.
Linked transfer and exact retries have separate composed/Worker evidence. Fresh
owner-presign location hints have release-Worker coverage, but their physical
locations were not independently observed by this hosted scenario. Package
publication and production rollout remain separate release work.
