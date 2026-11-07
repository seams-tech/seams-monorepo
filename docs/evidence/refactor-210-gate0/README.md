# Refactor 210 Gate 0: OutLayer feasibility evidence

Date: 2026-11-07. Plan: [Refactor 210](../../refactor-210-voice-intents.md),
Section 10. Probe source: the new local repository `seams-voice-intents`
(`gate0/`), beside `seams-wallet`. It has no GitHub remote yet.

## Result

Gate 0 passes for the speaker check and the word check, with three limits.
A `verify`-sized run of ReDimNet and Aurora ran inside the OutLayer TEE on
testnet: 23.4 billion instructions, 13–18 s, about 0.003 NEAR.

- ReDimNet B1, Aurora INT8 and Citrinet INT8 run in `wasm32-wasip2` with
  `tract` 0.23.10. Their outputs match ONNX Runtime Web 1.30.0.
- A `verify` run with ReDimNet and Aurora on 8 s of audio needs about
  15.4 billion instructions on the local machine. The live limit is 500 billion.
- OutLayer storage, the manifest allowlist, the callback values and the
  version pin work on testnet as the plan needs.

The limits:

1. Silero VAD does not load in `tract`. The verifier needs another speech gate.
2. ReDimNet loads only without `tract`'s declutter and optimizer passes.
3. The OutLayer worker refuses a WASM above 10 MB: "File too large: 25 MB
   (max 10 MB)". The models cannot be embedded. The verifier must fetch them
   over HTTPS and check pinned SHA-256 digests. A size-optimized `tract` build
   is 7.9 MB and fits.

## Environment

- macOS on an Apple M4 Pro. Rust 1.97.1. Target `wasm32-wasip2` with
  `-C target-feature=+simd128`.
- `gate0-fuel-runner` runs a component with wasmtime 28, `consume_fuel(true)`
  and a memory limiter. These are the settings of the OutLayer worker
  (`worker/src/executor/wasi_p2.rs` and `worker/Cargo.toml` in
  `out-layer/outlayer`, read on 2026-11-07). OutLayer reports
  `instructions` as fuel used.
- Testnet account `w3a-dev-1766307589.testnet` (the user approved it). The
  probe contract is on its sub-account `probe.w3a-dev-1766307589.testnet`.
  The OutLayer project is `w3a-dev-1766307589.testnet/seams-gate0-probe`
  (uuid `p0000000000000105`).

## Item 1: inference runtime

| Model         | Bytes      | `tract` plan | Result                                      |
| ------------- | ---------- | ------------ | ------------------------------------------- |
| ReDimNet B1   | 8,859,593  | typed        | Runs. The optimized plan fails (see below). |
| Aurora INT8   | 1,342,384  | optimized    | Runs.                                       |
| Citrinet INT8 | 10,483,704 | optimized    | Runs.                                       |
| Silero VAD    | 2,327,524  | —            | Does not load: `If` node analysis fails.    |

- ReDimNet fails in the declutter pass at `/pool/linear1/Conv`:
  "Trying to substitute a 128,534,F32 by 128,1,F32". The typed plan skips
  that pass and gives the correct output.
- Silero fails in fact inference on `If_0`, in the else branch
  (`/decoder/Squeeze`), also with a constant `sr` input. Options: an energy
  gate in the verifier, a VAD export without `If` nodes, or the Wallet's VAD
  trim alone. The speaker and word checks do not need Silero.
- No INT8 operator was missing. Aurora and Citrinet use the INT8 operators
  that `tract` supports.

### Same outputs as ONNX Runtime Web

`gate0/compare-ort.mjs` runs each model in ONNX Runtime Web 1.30.0, the
Wallet's engine, on the same input as the WASM build.

| Input                          | Model    | Cosine           | Max abs difference | Same top token per frame |
| ------------------------------ | -------- | ---------------- | ------------------ | ------------------------ |
| 8 s synthetic (native build)   | ReDimNet | 0.99999999999    | 4.3e-5             | —                        |
| 8 s synthetic (native build)   | Aurora   | 0.99999999998    | 1.9e-4             | 100%                     |
| 8 s synthetic (native build)   | Citrinet | 0.99999999990    | 1.8e-4             | 100%                     |
| 4 real recordings (WASM build) | ReDimNet | ≥ 0.999999999998 | ≤ 3.8e-5           | —                        |
| 4 real recordings (WASM build) | Aurora   | ≥ 0.99999999990  | ≤ 8.9e-4           | 100%                     |
| 4 real recordings (WASM build) | Citrinet | ≥ 0.99999999995  | ≤ 2.4e-4           | 100%                     |

The real recordings came from the private fixtures in `voiceId/fixtures`: two
owner verifications, one different speaker and one wrong phrase. The decoded
audio was deleted after the comparison. No audio is in this folder.

## Items 2 and 3: model delivery and cost of one run

Local fuel on 8 s of synthetic audio (128,000 samples):

| Model    | Load (instructions) | Load + run (instructions) | Run only      | Wall time, load + run | Peak memory |
| -------- | ------------------- | ------------------------- | ------------- | --------------------- | ----------- |
| Aurora   | 1.75 billion        | 3.21 billion              | 1.46 billion  | 332 ms                | 27 MB       |
| Citrinet | 23.09 billion       | 28.81 billion             | 5.71 billion  | 1,973 ms              | 78 MB       |
| ReDimNet | 0.32 billion        | 12.23 billion             | 11.91 billion | 809 ms                | 58 MB       |

- ReDimNet and Aurora together: about 15.4 billion instructions, 3% of the
  500 billion limit. With Citrinet in place of Aurora: about 41 billion.
- Citrinet spends 80% of its instructions in `tract`'s optimizer. A plan
  built ahead of time (for example NNEF) can remove most of that cost.
- Real recordings of 2.3–3.4 s: ReDimNet 3.8–5.4 billion, Aurora 2.1–2.3
  billion, Citrinet 24.8–25.6 billion.
- With the models embedded, the instructions are the same and peak memory
  grows by about 22 MB.

WASM sizes (stripped, LTO):

| Build                                | Bytes      | Gzip       |
| ------------------------------------ | ---------- | ---------- |
| `tract` probe, no models             | 16,650,988 | 4,240,935  |
| `tract` probe, four models embedded  | 39,664,644 | 24,016,034 |
| OutLayer worker, ReDimNet and Aurora | 27,166,184 | —          |
| OutLayer worker, no models           | 462,273    | —          |

- FastFS accepts files of at most 32 MiB (33,554,432 bytes), in 1 MiB
  chunks (`fastnear/fastdata-drag-and-drop`, `src/hooks/fastfs.js`). A worker
  with ReDimNet, Aurora and `tract` fits. One with Citrinet does not, unless
  the code shrinks.
- The 462 KB worker uploaded in one transaction and was served within
  seconds. The 27.2 MB worker uploaded in 26 transactions, but FastFS
  answered 404 for more than 20 minutes: its index had lost chunks. A
  two-chunk test file worked at once. A second upload of all 26 chunks with
  a new nonce was served at once, with the correct SHA-256.
- **The OutLayer worker then refused it**: three `infer` runs, pinned to that
  version, failed with "File too large: 25 MB (max 10 MB)". The worker used
  0 instructions, and OutLayer refunded 0.049 of the 0.05 NEAR deposit.
  Records: [`tee-infer.jsonl`](tee-infer.jsonl).
- `opt-level = "z"` shrinks the `tract` probe to 7,922,836 bytes (2,189,419
  gzip). Its fuel on 8 s of audio: ReDimNet 17.5 billion, Aurora 4.8 billion,
  about 22.3 billion in all. This is 4.5% of the live limit.
- wasmtime compiled each component in about 1.2 s. The OutLayer worker
  caches compiled components (`compiled_cache.rs`).

## Model run inside the OutLayer TEE

The worker `ea04f90a…c47757` (8,175,042 bytes, `opt-level = "z"`, manifest
allowlist `test.sign.seams.sh`) fetches ReDimNet and Aurora from the Wallet
host, which already serves them, and checks each pinned SHA-256. It then runs
both on 8 s of synthetic audio. Three contract runs pinned to that version.
Records: [`tee-verify.jsonl`](tee-verify.jsonl).

| Run | Compile | Instructions   | OutLayer `time_ms` | Time inside the guest | Model fetch (ReDimNet, Aurora) | Cost (NEAR) | Blocks to callback |
| --- | ------- | -------------- | ------------------ | --------------------- | ------------------------------ | ----------- | ------------------ |
| 1   | fresh   | 23,429,490,489 | 18,425             | 2,715 ms              | 832 ms, 169 ms                 | 0.00305     | 48                 |
| 2   | cached  | 23,431,537,018 | 17,985             | 3,258 ms              | 272 ms, 230 ms                 | 0.00280     | 41                 |
| 3   | cached  | 23,428,587,533 | 13,208             | 2,198 ms              | 261 ms, 114 ms                 | 0.00232     | 31                 |

- The output sums equal the local WASM run (ReDimNet 31.082746, Aurora
  −102256.515625).
- Inference inside the guest: ReDimNet 1.1–1.7 s, Aurora 0.1–0.2 s.
- OutLayer's `time_ms` is 10–15 s more than the guest's own clock. Two
  `echo` runs of the same 8.2 MB worker, with no download and no inference
  (78,000 instructions), took 8,606 ms and 12,865 ms. The 462 KB worker's
  `echo` takes about 0.7 s. So most of the time is a fixed cost that grows
  with the WASM size (load, compile or instantiation in the worker), not the
  verify work. Its parts are not measured.
- The pass rule (p95 run of at most 30 s within the live limits) holds for
  these three runs. Three runs give no reliable p95.

### Smaller `tract` builds

- `tract-nnef` with the ONNX extension ops, without the ONNX parser
  (`gate0/nnef-probe`, `opt-level = "z"`): 6,416,147 bytes (1,731,615 gzip),
  against 7,922,836 bytes for `tract-onnx`. Most of the size is `tract` core
  and its kernels, not the parser.
- Aurora as an NNEF archive (decluttered) is 7.7 MB, against 1.3 MB as INT8
  ONNX: the archive stores float32 weights. It runs in 4.35 billion
  instructions for 4 s. ReDimNet as an NNEF archive fails `tract`'s declutter
  pass again when it loads with `into_optimized`.

## Item 4: latency on testnet

20 contract runs of `echo` between blocks 276,567,063 and 276,568,191
(about 01:50–02:10 UTC on 2026-11-07). All 20 returned a value. Records:
[`latency.jsonl`](latency.jsonl).

| Measure                                         | Min | Median | p95 | Max |
| ----------------------------------------------- | --- | ------ | --- | --- |
| Blocks from the contract call to its callback   | 10  | 11     | 87  | 118 |
| Blocks from the transaction to the last receipt | 12  | 13     | 89  | 120 |

- 14 runs took 10–11 blocks, about 6.5 s at 0.6 s blocks.
- 6 runs took 32, 54, 64, 66, 87 and 118 blocks (19–71 s). The worker's own
  run time stayed at 0.7–1.0 s, so the delay was before the run: in the
  worker queue or in its pickup of the event. The cause is not measured.
- The slowest run used 118 of the 200 blocks of a yield window. Gate 0's pass
  rule (p95 at most 30 s) is met for the run time but not for the end-to-end
  time: p95 is about 52 s. A multisig challenge window must allow for this
  tail, or the flow must give the approver a retry.

## Item 5: storage

| Run                                 | `predecessor` seen by the worker   | `set_if_absent` first | Second call in the same run |
| ----------------------------------- | ---------------------------------- | --------------------- | --------------------------- |
| Contract run 1, key `audio:gate0-a` | `probe.w3a-dev-1766307589.testnet` | true                  | false                       |
| Contract run 2, same key            | `probe.w3a-dev-1766307589.testnet` | false                 | false                       |
| Direct run, same key                | `w3a-dev-1766307589.testnet`       | true                  | false                       |

The manifest sets `storage_account: "predecessor"`. The direct run, with the
user as predecessor, has its own cell. So each calling contract has its own
namespace, and a used audio digest is refused on a later run.

## Item 6: outbound HTTPS

- `https://rpc.testnet.near.org/status`, in the manifest allowlist: status
  200, 1,673 bytes, 48 ms.
- `https://example.com/`, not in the allowlist: refused with "host
  \"example.com\" is not in the project's manifest network allowlist".

## Item 7: callback format

The OutLayer contract returns the worker's stdout JSON bytes to the caller, or
`null` (`output_return_bytes` in `contract/src/execution.rs`).

| Run                        | What the contract callback received                               |
| -------------------------- | ----------------------------------------------------------------- |
| Worker exits with status 1 | `null`                                                            |
| Output of 861 bytes        | The JSON value                                                    |
| Output of 1,161 bytes      | The JSON value                                                    |
| Output of 3,061 bytes      | The JSON value                                                    |
| Output of 20,061 bytes     | Delivered; the probe's own log line passed the 16 KB log limit    |
| Unknown `version_key`      | A promise error: `request_execution` panicked "Version not found" |

The 900-byte output limit on the WASI docs page is out of date. Output above
the 1024-byte yield payload goes through the two-call path
(`submit_execution_output_and_resolve`).

## Item 8: version pin

- `version_key` set to the active hash: the run works.
- `version_key` set to an unknown hash: `request_execution` panics with
  "Version not found". The caller's callback gets a promise error. The vault
  must treat that as a failed check.

## Item 9: cost in NEAR

Live pricing (`get_pricing` on `outlayer.testnet`): base fee 0.001 NEAR,
1e14 yoctoNEAR per million instructions, 1e17 yoctoNEAR per millisecond, and
1e17 yoctoNEAR per compile millisecond. Memory has no price.

- The deposit is the estimate for the requested limits. For example,
  `estimate_execution_cost` gives 0.007001 NEAR for 10 billion instructions
  and 60 s, and 0.01905 NEAR for 500 billion and 180 s. The unused part comes
  back after the run.
- Small runs cost 0.00107–0.00121 NEAR each: 0.001 NEAR base plus about
  0.0001 NEAR for each second of run time.
- A 10 s `verify` run would cost about 0.002 NEAR. This is an estimate from
  the price list. The model run is not measured on testnet yet.

## Item 10: HPKE

`gate0/hpke-probe` uses `hpke` 0.15.1 with X25519-HKDF-SHA256, HKDF-SHA256 and
ChaCha20-Poly1305.

- `wasm32-wasip2`: 256,000 bytes of audio sealed and opened. Encapsulated key
  32 bytes, ciphertext 256,016 bytes. A wrong associated-data string and a
  changed byte are both refused. Seal and three opens used 78.6 million
  instructions.
- `wasm32-unknown-unknown`: the library links as a 105,298-byte `cdylib`. Its
  only import is `crypto.getRandomValues` through wasm-bindgen, as in the
  Wallet's wasm builds.

## New facts for the plan

- The manifest field `callers.contract.only` can admit only named contracts
  (at most 32). The verifier can admit only the vault contract and refuse
  direct and HTTPS calls (`worker/src/callers.rs`).
- The manifest's `network` list is enforced, so the verifier can reach only
  the relay host.
- `rpc.testnet.near.org` is deprecated and answers 429. Use FastNEAR
  (`test.rpc.fastnear.com`) or another provider.
- `get_max_limits` returns (instructions, execution seconds, compile seconds):
  (500 billion, 180, 300). The contract caps memory at 4096 MB, and the worker
  gives each run between 1024 MB and 4096 MB.

## Open items

1. Measure more TEE runs for a real p95, and split OutLayer's `time_ms`
   into its parts.
2. A VAD that loads in `tract`, or a decision to drop the VAD from the
   verifier.
3. A plan built ahead of time for Citrinet, if Citrinet is chosen.

## How to run again

From `seams-voice-intents/gate0`:

1. Build `model-probe` and `fuel-runner`, then run
   `PROBE_PLAN=<plan> fuel-runner/target/release/gate0-fuel-runner <wasm> <dir> -- <model> <file> 8 run`.
2. Compare with `node compare-ort.mjs <onnxruntime-web dir> <models dir> <dump dir> <models>`.
3. Run testnet probes with `scripts/probe-call.sh` and read them with
   `python3 -I scripts/tx_record.py <tx>`.
