# Celld provider qualification runbook

Status: Google runtime primitives and all 16 selected Wallet contracts pass in project `seams-501403`, region `us-central1`.
The native `.5` x86-64 release passes on an ordinary `n2d-standard-4` VM in `us-central1-a`
and a SEV-SNP `n2d-standard-2` VM in `us-central1-c`, using the pinned Ubuntu 24.04 image.
The kernel confirms active SEV-SNP operation. The source build and Clippy pass with locked dependencies.
External objects, raw EC operations, A/B streams, conditional writes, direct buckets, and forced-kill recovery pass.
A Google IAM denial test observes B failure while A remains writable. The B grant was restored.
The two-VM object ownership scenario also passes. Local 0.11.0 Wallet and Console checks pass on both runtimes.
The final 0.11.0 archives pass the same 16 contracts on both Google VM types.
The [one-node Wallet failure check](evidence/google-wallet-one-node-failure.json) and [Google Console onboarding](evidence/google-console.json) also pass.
The broader distributed lifecycle matrix, release promotion, and live cutover checks remain open.
See [final Google package evidence](evidence/google-wallet-final-packages.json) and [earlier evidence and limitations](evidence/google-wallet.json).
AWS qualification is outside the current scope. The deleted project `eigen-413918` must not be used.
Qualification resources remain task-owned and tracked under the private `.artifacts` directory.

## Shared deployment

Start qualification with one VM, one attached persistent disk, and three physical object-storage buckets:

| Resource                | Purpose                                                               |
| ----------------------- | --------------------------------------------------------------------- |
| Fleet bucket            | Celld deployments, leases, durable replicas, and shared runtime state |
| Deriver A backup bucket | Only the A logical R2 binding                                         |
| Deriver B backup bucket | Only the B logical R2 binding                                         |
| Attached disk           | Node-local SQLite and replication work directory                      |
| HTTPS ingress           | Public Gateway listener                                               |

Celld provides the application's D1 and KV APIs. This topology requires no separate Postgres or Redis service.
Keep the Gateway, Router, A, B, SigningWorker, and tenant-root control plane as separate Workers and environments.
One VM remains one host failure domain and one trusted operator boundary.
Add a second VM before testing peer acknowledgement, partitions, or distributed takeover.

Use the pinned private build from [README.md](README.md). Build for the VM's actual CPU architecture.
Use the exact released Worker and WASM files already qualified locally. Verify the package artifact manifest before deployment.
Use the established deployment inputs for role bindings and application secrets.
Use [render.mjs](render.mjs) to consume the existing Wrangler configuration and a protected per-Worker JSON secrets file.
The renderer bundles the Worker, copies unchanged SQL, and writes a protected deployment directory.
It rejects binding types outside the supported Wallet scope. It adds no resource authority manifest.

```sh
node deployment/celld/render.mjs PATH_TO_EXISTING_WRANGLER_CONFIG WORKER_SECRETS_JSON NEW_DEPLOYMENT_DIRECTORY
```

Append the existing Wrangler environment name when deploying its staging or production section.
Use the established per-role deployment inputs for Gateway, Router, A, B, SigningWorker, tenant-root control plane, and Console.
The local acceptance preparation scripts generate synthetic test inputs only.

For a Google qualification fleet, an operator-owned environment file can contain:

```dotenv
CELLD_BUCKET=gs://QUALIFICATION_FLEET_BUCKET
CELLD_WATCH=/var/lib/celld
CELLD_R2_BUCKETS='{"router-ab-deriver-a-tenant-root-managed-backup":"gs://QUALIFICATION_BACKUP_A","router-ab-deriver-b-tenant-root-managed-backup":"gs://QUALIFICATION_BACKUP_B"}'
```

Use the same physical mapping during deployment and on every node. Do not map both roles to one bucket.
The sample logical names come from the released role configuration. Confirm them against the selected package.
Keep emulator credentials and endpoint variables out of provider runs.

Install the verified executable as `/opt/seams/celld`. Create the dedicated `celld` system account.
Install [celld.service](celld.service) in `/etc/systemd/system/` and the protected environment file at `/etc/seams/celld.env`.
The unit creates `/var/lib/celld`, restricts filesystem access, and restarts a failed runtime.
Both runtime listeners bind to loopback. The Gateway accepts traffic through the local HTTPS proxy.

```sh
sudo useradd --system --home-dir /var/lib/celld --shell /usr/sbin/nologin celld
sudo install -D -m 755 VERIFIED_CELLD /opt/seams/celld
sudo install -D -m 600 OPERATOR_ENVIRONMENT_FILE /etc/seams/celld.env
sudo install -m 644 deployment/celld/celld.service /etc/systemd/system/celld.service
sudo systemctl daemon-reload
sudo systemctl enable --now celld.service
```

Install Nginx and adapt [nginx.conf.example](nginx.conf.example) for the Gateway domain and its TLS certificate.
Use a certificate trusted by the application's clients. The acceptance certificate is synthetic and locally trusted only.
The proxy replaces the forwarded host and protocol fields and buffers request bodies before forwarding.
Its body limit accepts 1 MiB and rejects larger requests with `413`.
These settings follow Nginx's [body limit](https://nginx.org/en/docs/http/ngx_http_core_module.html#client_max_body_size)
and [request buffering](https://nginx.org/en/docs/http/ngx_http_proxy_module.html#proxy_request_buffering) documentation.
The native runtime also receives the existing body-limit setting through its unit.
The recorded ingress test measures the proxy boundary. It does not independently qualify the native body limit.

Restrict public access to HTTPS. Keep the operator listener private.
Enable trusted forwarded headers only with these loopback bindings and the controlled local proxy.
One VM per acceptance invocation is required. The driver uses fixed service names, configuration paths, and ports.
Use the existing `celld deploy` and `celld d1 migrations apply` commands for each released role and the Gateway.
Deploy the Gateway as the public entrypoint and verify the effective manifest before opening ingress.
The private listener includes operator capabilities. Keep it on loopback for one VM.
For multiple nodes, bind and advertise private VPC addresses and restrict peer access to that fleet.
Verify the peer transport and ingress rules before allowing signing traffic.

## Google Cloud

Use project `seams-501403` and region `us-central1`. The final ordinary and Confidential checks use `us-central1-c`.
Qualification resources use unique task-owned names and a dedicated service account.
Record resource identities and cleanup under the private `.artifacts` directory.
The initial ordinary proof used `n2d-standard-4` in zone a. Later starts lacked capacity for four and two vCPUs.
The final ordinary candidate uses `e2-standard-4` in zone c and the same pinned Ubuntu 24.04 x86-64 image.
The Confidential candidate uses `n2d-standard-2` in `us-central1-c` with AMD SEV-SNP.
The requested four-vCPU configurations in zones a and b lacked capacity. The two-vCPU candidate in zone c succeeded.
Use an SSH tunnel for initial loopback-only Wallet qualification.
The separate [single-VM check](evidence/google-single-vm.json) verifies TLS, proxy limits, private operator access, and supervised restarts.
Public certificate issuance and external ingress reachability remain deployment-specific work.
Use Compute Engine, an attached persistent disk, and regional Cloud Storage buckets in the selected location.
Grant the VM service account only the bucket operations needed by this qualification fleet.
Use Application Default Credentials from the attached service account.
The pinned runtime supports this credential path. It does not require an exported service-account key.

Set the VM's access scope to `cloud-platform`, then constrain access with bucket IAM.
A read-only storage scope blocks writes even when IAM grants object administration.
Google documents this interaction in [Compute Engine service accounts](https://docs.cloud.google.com/compute/docs/access/service-accounts).
Keep the instance credentials within the trusted operator model. Separate bucket bindings do not isolate a role from that operator.

Use an OS image supported by the selected machine type. Install the private runtime and configure the process command above.
Route HTTPS to the Gateway listener. Restrict the operator and peer listeners to their intended private access paths.
Run the local acceptance scenarios against this fresh fleet. Record resource IDs, runtime and package hashes, and cleanup.
No Wallet request handler should change for this target. An unsupported runtime behavior must fail qualification visibly.

## Minimal Google resource setup

Use unique bucket names. Keep the deployment service account and each bucket within project `seams-501403`.
The commands below create a fresh ordinary VM and its three storage boundaries.
Use the verified runtime build, package artifacts, renderer, service unit, and HTTPS configuration described above.

```sh
gcloud iam service-accounts create wallet-celld --project=seams-501403

for seams_bucket in FLEET_BUCKET BACKUP_A_BUCKET BACKUP_B_BUCKET; do
  gcloud storage buckets create "gs://${seams_bucket}" \
    --project=seams-501403 --location=us-central1 \
    --uniform-bucket-level-access --public-access-prevention
  gcloud storage buckets add-iam-policy-binding "gs://${seams_bucket}" \
    --member=serviceAccount:wallet-celld@seams-501403.iam.gserviceaccount.com \
    --role=roles/storage.objectAdmin
done

gcloud compute instances create wallet-celld \
  --project=seams-501403 --zone=us-central1-c \
  --machine-type=e2-standard-4 \
  --image-project=ubuntu-os-cloud \
  --image=ubuntu-2404-noble-amd64-v20261009 \
  --boot-disk-size=50GB --boot-disk-type=pd-balanced \
  --service-account=wallet-celld@seams-501403.iam.gserviceaccount.com \
  --scopes=cloud-platform \
  --metadata=block-project-ssh-keys=true \
  --tags=wallet-celld-https

gcloud compute firewall-rules create wallet-celld-https \
  --project=seams-501403 --network=default \
  --allow=tcp:443 --source-ranges=0.0.0.0/0 \
  --target-tags=wallet-celld-https
```

The VM command uses the image and ordinary machine type from qualification.
Adapt disk capacity to measured application needs. Use the operator's existing controlled SSH access.
The firewall permits only public HTTPS for that tag. Inspect other project rules before opening production traffic.
Do not expose port 8081 publicly. Keep application secrets in the protected per-Worker deployment inputs.

## Google Confidential VM

Choose a configuration from Google's current [supported configurations](https://docs.cloud.google.com/confidential-computing/confidential-vm/docs/supported-configurations).
Candidate families include N2D with AMD SEV-SNP and C3 with Intel TDX where the selected zone and OS support them.
Select the CPU platform, disk interface, maintenance policy, and image together according to the [creation procedure](https://docs.cloud.google.com/confidential-computing/confidential-vm/docs/create-a-confidential-vm-instance).
Build and test an x86-64 runtime for those configurations. The ARM64 container result does not qualify them.

Keep the Worker artifacts, bindings, application secrets, and acceptance expectations identical to the ordinary-VM run.
Record the project, zone, machine type, CPU platform, image, TEE technology, runtime digest, and acceptance results.
This test establishes compatibility with that Confidential VM configuration only.
Attestation-controlled key release requires a separate design and test. See [Confidential VM attestation](https://docs.cloud.google.com/confidential-computing/confidential-vm/docs/attestation).

## Required provider evidence

Run the 16 selected browser contracts from the packaged Wallet scenario against each fresh provider fleet.
Keep the test bodies and assertions unchanged. Record any environment-dependent exclusion as an open gate.
Repeat the tenant-root forced-kill and exact saved-grant replay with a fresh node work directory.
Verify actual A/B bucket contents and a denied or failed write without a successful application outcome.
Check graceful drain, restart, migration application, and refusal of an unsupported runtime feature.

Then run the broader lifecycle matrix from [refactor-190.md](../../docs/refactor-190.md).
Use at least two nodes for a killed owner, a partition, and peer failure.
Prove that one-use material and stale ownership remain fenced after failure and recovery.
Qualify backup and restore through the application's authorized flow. Do not roll back consumed signing material.

The operator confirmed on October 14 that only Workers are deployed. No wallet requires migration from a retired classic host.
Keep existing Workers state intact during release promotion. A future Cloudflare-to-celld transfer requires the authorized relocation or recovery flow.
After adapter deletion, repeat acceptance with the final packaged release on both supported hosting models.

## Repeat the single-VM operational check

Use a task-owned VM from the qualification resource ledger. Run one check per VM at a time.
The resource directory contains `resources.json`, `runtime-build.json`, `native-release.tar.gz`, and a restricted `ssh-key`.

```sh
python3 tests/e2e/celld/google-single-vm.e2e.py RESOURCE_DIRECTORY ordinary
```

Use `confidential` for the ledger's SEV-SNP VM. The driver records input hashes, journals, listeners, and the result.
It trusts its synthetic certificate explicitly and removes the synthetic private key after the test.
It stops both owned test services. The VM and task buckets remain available for the next qualification.
The final ordinary proof checks a fresh acknowledged counter write immediately before SIGKILL.
Its successful read after automatic restart establishes single-node continuity only.

## Repeat the two-node Yao check

Use the owned Google resource ledger and the exact packed Wallet Server directory:

```sh
python3 tests/e2e/celld/google-yao.e2e.py \
  RESOURCE_DIRECTORY WALLET_SERVER_PACKAGE WALLET_CHECKOUT
```

Install the same reviewed Linux runtime on both ledger VMs before running this command.
The executable digest must match `runtime-build.json`. The driver refuses mismatched executables.
The driver uses project `seams-501403`, the ordinary VM, the SEV-SNP VM, and the three task buckets.
It records actual A/B owners, interrupts Yao after B's second message, kills B's owner, and checks burned state after takeover.
It also checks the replacement ownership epoch and the unchanged surviving process.
The driver stops both VMs and removes its temporary peer rules and tags. Cleanup failures make the result fail.
Each retained run includes the controller sources, rendered artifact hashes, ownership records, native logs, and `result.json`.

The `.6` manifest feature proves loader refusal only. A safe mixed-version rollout requires separate evidence.
Before publishing a `.6` manifest, drain old runtime processes and verify every serving node uses the reviewed `.6` executable.
Do not start `.5` against that manifest or remove its required feature to permit a downgrade.
Keep durable state and consumed material intact. Full state-safe upgrade and rollback qualification remains open.
