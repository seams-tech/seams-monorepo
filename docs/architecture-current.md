# Architecture Current

Status: active documentation map. The older architecture snapshot was deleted
because it described stale implementation assumptions.

## Current Authority

1. Signing-session architecture:
   [signing-session-architecture/](signing-session-architecture/).
2. Email OTP architecture:
   [otp/email-otp.md](otp/email-otp.md).
3. Ed25519 model:
   [router-ab/ed25519-yao/implementation-plan.md](./router-ab/ed25519-yao/implementation-plan.md).
4. ECDSA model:
   [ecdsa_threshold_signing.md](ecdsa_threshold_signing.md).
5. Route auth planes:
   [auth-gating-routes.md](auth-gating-routes.md).

## Boundary and state ownership

Untrusted HTTP, token, worker/iframe, RPC, CLI, configuration, and persistence
values enter as `unknown`. One domain-owned decoder verifies object shape,
required/forbidden keys, representations, discriminant, and branch invariants,
then returns a precise result. Normalize identity and encoding once. Encode
explicitly at the next wire or storage boundary; raw DTOs stay inside adapters.

A shallow object predicate such as `isRecord` cannot establish domain validity.
Object-category inspection may remain local to an exact decoder. Parsed core
functions accept narrow domain values, and recoverable failure remains an
explicit result branch. Decoding structure does not prove authorization,
cryptographic verification, material possession, freshness, or one-use
consumption. Proof-bearing values require their owning verifier or constructor.

Use distinct identity types, discriminated lifecycle unions, branch-specific
builders, `never` exclusions where required, and exhaustive switches.
Diagnostics cannot select lifecycle behavior. Reuse current types and parsers;
older refactor examples are historical rationale and cannot restore retired
compatibility branches or weaken current intended-behaviour contracts.

### Mutable ownership and equality

- `readonly` properties and `ReadonlyMap` do not eliminate mutable aliases.
  Store adapters carry encoded values; decoders allocate request-owned mutable
  collections. Keep immutable baseline encodings or scalar revisions for CAS.
- Do not replace `structuredClone` with another generic deep-copy helper.
  Allocate only the owning request's changed state; immutable partitions may
  be shared only after ownership is established. Explicitly copy byte buffers
  at ownership boundaries or retain canonical encoded values in persistence.
- Domain equality uses named field/branch comparators or the protocol's
  existing versioned, branded digest. Verify persisted digests during decoding;
  a supplied digest cannot certify the payload it accompanies.
- Canonical serialization remains appropriate for protocol bytes, persistence,
  and preimages. Generic serialization or deep equality must not define core
  domain equality. Do not create a cryptographic digest merely to compare a
  transient object when direct field comparison suffices.

### Gateway persistence and registration effects

Gateway product state uses request-scoped partitioned persistence, batch reads,
typed claims before non-idempotent effects, atomic compare-and-swap transitions,
and exact replay receipts. No mutable tenant snapshot or adapter alias may
cross requests. Reconcile ambiguous effects before attempting another effect;
terminal outcomes cannot depend on mutable aliasing. Domain record-store ports
and codecs remain host-neutral; Cloudflare D1 composition owns host adapters.

The completed boundary cleanup preserved an acceptance target of at most two
D1 roundtrips for successful Yao registration execution. This is not a fresh
measurement or a claim of current hosted acceptance. Its clone/equality cleanup
had no dedicated before/after performance baseline. Current behavior, alias
isolation, protocol vectors, and type fixtures remain evidence owners;
historical targeted checks do not certify today's broad suites or deployment.

For lifecycle authority, consult intended-behaviour contracts and the current
owning specs, including the exact R103F integration boundary frozen by R120.
Preserve crypto and security rules in their protocol/custody documents. The
[testing policy](../tests/README.md) describes the separate evidence owners.
