# Transaction mocks

Frozen interactive snapshots of the approved wallet UI. Import `EthTransferMock`,
`EvmFunctionCallMock`, or `NearFunctionCallMock` from `./TransactionMock`, or use
`<TransactionMock example="evm" theme="dark" />`.

Inspect all three at `/transaction-mocks`. Each example supports transaction
details, simulated lifecycle stages, minimize/expand, reset, and light/dark themes.
Stages are advanced manually using the demo controls; confirm never authenticates
or sends a transaction. Sandboxing may block clipboard access; manual text copying
remains available. These are marketing/demo components, not wallet API adapters.

The frame contains trusted, checked-in UI code and retains same-origin access for
browser APIs used by that UI. Its CSP blocks network connections and form submits.
It is not a sandbox for untrusted application code. The gallery bypasses the site's
SDK provider entirely.

The checked-in `src/public/transaction-mocks` snapshot works independently of the
wallet repository. To intentionally refresh it after approving a new SDK preview,
build the wallet SDK, then run from this repository:

```sh
node apps/seams-site/scripts/build-transaction-mocks.mjs /absolute/path/to/seams-wallet
```

The generator bundles the wallet preview and copies its CSS. Do not edit generated
assets by hand. The bundle header records the source commit.
