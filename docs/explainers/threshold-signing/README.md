# Threshold signing, as a two-party press

Open `index.html` directly. It contains the drawing kit, styles, and interaction.
The page makes no network requests and performs no cryptography.

The two sealed actuator housings represent the client and SigningWorker. Both
must participate before the press produces one signature. Their cartridges stay
separate. The rear provisioning station represents Deriver A and Deriver B.
The admission gate represents Gateway authorization. Router coordinates the
admitted protocol messages.

The mechanical press explains participation and lifecycle boundaries. Its
dimensions, travel, and timing are illustrative. It does not model the cryptographic
equations, network latency, or private-key reconstruction.

## Sources

Checked against `seams-wallet` commit `235a37ae` on 2026-10-11:

- `docs/router-ab/protocol.md`: roles, lane provisioning, normal signing, trust model.
- `docs/router-ab/ed25519-yao.md`: fixed Yao roles and recipient isolation.
- `docs/threshold-ecdsa/ecdsa-threshold-signing.md`: presignature ownership and consumption.
- `crates/signer-core/src/near_threshold_ed25519.rs`: FROST signing operations.
- `crates/router-ab-cloudflare/src/ecdsa_pool_lifecycle.rs`: terminal presignature consumption.

The diagram leaves recovery, refresh, explicit export, and tenant-root control-plane
operations outside its scope. The wallet custody seed and tenant derivation root
remain distinct. Lane holder shares come from the curve-specific provisioning
protocol. They are absent from tenant-root recovery packages.

## Build and check

Install [Anatomy](https://github.com/wheresryan22/anatomy) as a Codex skill first.
The build reads it from `$CODEX_HOME/skills/anatomy`, with `~/.codex` as the default.
An explicit `ANATOMY_SKILL_DIR` can select another installation.

```sh
node docs/explainers/threshold-signing/build.mjs --audit
node ~/.codex/skills/anatomy/scripts/lines.mjs docs/explainers/threshold-signing/index.html
node ~/.codex/skills/anatomy/scripts/lines.mjs docs/explainers/threshold-signing/dark.html
node tests/e2e/threshold-signing-anatomy.e2e.mjs
```

Both pages come from the same source. Do not edit them directly. The generated
pages include Anatomy’s MIT license. No project dependency or runtime service is required.
The browser scenario writes screenshots and a result with the artifact SHA-256 to
`.artifacts/threshold-signing-anatomy/`. It checks the educational model only.

## Parts plan

- Base: four feet, plate, inset seam, four fasteners.
- Provisioning station: platform, two housings, two lids, two cartridge seats,
  two cartridges, two retention bars, four fasteners.
- Signing holders: two mounting plates, two housings, two lids, two cartridge
  seats, two cartridges, two collars, two knobs, four fasteners, two linkages,
  and four linkage collars.
- Press: two mounting feet, two columns, crosshead, cylinder, rod, platen, die,
  four fasteners, bed, message sheet, seal.
- Admission gate: two mounts, two posts, crossbar, latch, two fasteners.
- One-use store: tray, three preparation tokens, terminal receptacle.

Each solid has a recorded shape. The build checks geometry and depth order for
the full press stroke. Surface seams and fasteners add detail to these parts.
