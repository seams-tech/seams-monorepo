# Minimal Nitro compatibility adapter

This adapter runs the existing Linux `celld` executable and Worker artifacts in
one AWS Nitro Enclave. It adds no runtime or cryptographic protocol changes.
It provides packaging and I/O compatibility. Live Nitro execution remains
unqualified until an enclave run passes.

The first target is one enclave containing the existing role fleet. Independent
A/B enclaves and multi-node peer routing are outside this adapter's scope.
The parent and its deployment configuration remain trusted.

## Build

Use the verified Linux executable produced by [the existing build](../README.md).
Its architecture must match the parent instance and enclave image. The following
example uses the existing x86-64 build:

```sh
docker build --platform linux/amd64 \
  --build-context runtime=/absolute/path/to/verified-runtime-directory \
  -t seams-celld-nitro deployment/celld/nitro
nitro-cli build-enclave --docker-uri seams-celld-nitro --output-file celld.eif
```

The runtime directory must contain `celld`. Do not put credentials or Worker
secret files in the image. The existing deployment renderer and `celld deploy`
publish the Worker fleet to S3 before startup, as in the EC2 runbook.

## Configure

Prepare a protected, operator-owned **Bash environment file** on the parent.
It uses the existing runtime environment variables. `NITRO_HTTPS_HOSTS` is the
space-separated list of additional HTTPS destinations the Workers require.

```sh
AWS_REGION=ap-southeast-1
CELLD_BUCKET=s3://YOUR_FLEET_BUCKET
CELLD_R2_BUCKETS='{"router-ab-deriver-a-tenant-root-managed-backup":"s3://YOUR_A_BUCKET","router-ab-deriver-b-tenant-root-managed-backup":"s3://YOUR_B_BUCKET"}'
NITRO_HTTPS_HOSTS='YOUR_RPC_HOST YOUR_OTHER_REQUIRED_HTTPS_HOST'
```

Use S3 buckets in that region, including the physical R2 mappings. The adapter
sets both S3 endpoint variables to the regional HTTPS endpoint and keeps TLS
verification intact. Additional destinations must use port 443. Include every
required destination, including redirect targets. This is fixed destination
forwarding, not general Internet routing or an HTTP proxy.

The adapter forwards IMDSv2 through the parent, preserving the runtime's existing
instance-role credential chain and refresh behavior. Give the parent instance
role the existing bucket permissions. No metadata response or credential value
is logged by the adapter. Static AWS environment credentials can also be supplied
through the protected file, but do not refresh automatically.

## Start

Install `bash`, `socat` with VSOCK support, and `setsid` from `util-linux` on the parent. Enable Nitro Enclaves
and allocate enough CPU and memory for the runtime, WASM, and ephemeral SQLite
files. Install the existing parent HTTPS proxy if public ingress is needed.

Start the parent bridge first. Reserve CID 16 and the listed ports for this
deployment. Only one adapter instance may run on a parent.

```sh
chmod 600 /absolute/path/to/runtime.env
bash deployment/celld/nitro/nitro.sh parent /absolute/path/to/runtime.env 16
```

In another terminal, start the enclave with the same CID:

```sh
nitro-cli run-enclave --eif-path celld.eif --enclave-cid 16 \
  --cpu-count 2 --memory 4096
```

CPU and memory values are starting allocations, not measured capacity guidance.
The parent exposes application port 8080 and operator port 8081 on loopback only.
The existing Nginx configuration can forward HTTPS to parent port 8080. Keep
8081 private. Raw streams preserve HTTP bodies and WebSocket traffic.

| VSOCK port   | Direction         | Purpose                                    |
| ------------ | ----------------- | ------------------------------------------ |
| 9000         | Enclave to parent | Read the startup environment file          |
| 9001         | Enclave to parent | EC2 metadata and instance-role credentials |
| 9002         | Parent to enclave | Application listener                       |
| 9003         | Parent to enclave | Private operator listener                  |
| 10000 onward | Enclave to parent | Regional S3, then additional HTTPS hosts   |

The enclave maps each HTTPS hostname to a separate loopback address. `socat`
forwards the encrypted stream through VSOCK. DNS resolution for the real target
occurs on the parent. No TLS termination is added.

## State and restart

Enclave-local files are ephemeral. The adapter sets `CELLD_DURABILITY=bucket`
so acknowledged writes require bucket durability, and starts with a fresh node
identity. Existing S3 restore and ownership rules remain in force. Restart can
wait for an old ownership lease to expire.

Stopping a bridge stops the adapter's other child processes. Terminate the
enclave separately with `nitro-cli terminate-enclave --enclave-id ENCLAVE_ID`.
Keep the fleet buckets and deployment artifacts for the replacement enclave.

Before claiming Nitro readiness, run the existing Worker lifecycle scenario
through these listeners, restart with empty local storage, and verify recovery.
Local bridge checks cannot establish Nitro kernel, VSOCK, or memory compatibility.

## Local adapter check

```sh
python3 tests/e2e/celld/nitro.e2e.py seams-celld-nitro
```

This uses the packaged runtime in two Docker containers with external networking
disabled. Unix sockets replace only the VSOCK addresses. Moto supplies local S3
over verified TLS, and a local metadata server supplies synthetic IMDSv2
credentials. Image preparation downloads test dependencies.

The [retained result](../evidence/nitro-adapter.json) verifies HTTPS egress,
metadata access, a 512 KiB streamed body, WebSocket echo, and durable counter
recovery after replacing the enclave container with empty local storage. Each
run writes logs and `result.json` under `.artifacts/nitro-adapter-*`.
It does not run a wallet ceremony or qualify AWS Nitro itself.

AWS references: [application communication](https://docs.aws.amazon.com/enclaves/latest/user/developing-applications.html)
and [enclave constraints](https://docs.aws.amazon.com/enclaves/latest/user/nitro-enclave.html).
