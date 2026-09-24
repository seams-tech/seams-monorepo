# Private test workspace

Public Wallet lifecycle contracts, Rust vectors, and Wallet-owned browser tests live in
[`seams-wallet`](https://github.com/seams-tech/seams-wallet). This workspace covers
private Console composition and deployed product flows.

## Gates

- `pnpm test` runs the Console operating E2E cases on a fresh managed local stack.
- `pnpm test:console` runs the same browser suite directly.
- `pnpm test:relayer` runs focused private Console service and D1 checks.
- `pnpm check` runs lint, application and private fixture type checks, and the
  Console-core import boundary.
- `pnpm -C tests test:unit` remains available for existing focused private invariants.
  Do not add new unit tests. Prefer a medium-to-hard product E2E scenario that leaves
  repeatable evidence.

The managed Console suite owns local ports 4001, 4002, 4100, and 4101. Its launcher
refuses to run while another local Wallet stack owns those ports; stop the other stack
before running the suite.

## Existing Wallet composition cases

`e2e/linked-device.operating-path.test.ts` and
`e2e/intended-behaviours/tenant-root.rotation.contract.test.ts` encode distinct composed
product flows. They still import pre-split Wallet internals and are not part of the
default gate. Migrate them to supported package APIs before using `test:intended` as a
gate. The public Wallet lifecycle suite runs in `seams-wallet`.

## Test policy

A failure in a focused test must be classified against the current domain types and
owning product specification before editing code or fixtures. Preserve cross-language
wire, cryptographic, type-level, and persistence invariants that browser flows cannot
observe. Remove tests that only restate fixtures, inspect source text, or depend on
retired paths. E2E tests should exercise a meaningful user journey and save a
verifiable, repeatable artifact.
