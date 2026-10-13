# Celld provider qualification runbook

Status: Google runtime primitives and all 16 selected Wallet contracts pass in project `seams-501403`, region `us-central1`.
The native `.5` x86-64 release passes on an ordinary `n2d-standard-4` VM in `us-central1-a`
and a SEV-SNP `n2d-standard-2` VM in `us-central1-c`, using the pinned Ubuntu 24.04 image.
The kernel confirms active SEV-SNP operation. The source build and Clippy pass with locked dependencies.
External objects, raw EC operations, A/B streams, conditional writes, direct buckets, and forced-kill recovery pass.
A Google IAM denial test observes B failure while A remains writable. The B grant was restored.
The two-VM object ownership scenario also passes. Final package, private Console, distributed Wallet, and production ingress checks remain open.
See [Google Wallet evidence and limitations](evidence/google-wallet.json).
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
The local acceptance preparation scripts are test fixtures; they do not define a production configuration renderer.
Production Console composition and configuration rendering remain implementation gates.

For a Google qualification fleet, an operator-owned environment file can contain:

```dotenv
CELLD_BUCKET=gs://QUALIFICATION_FLEET_BUCKET
CELLD_WATCH=/var/lib/celld
CELLD_R2_BUCKETS='{"router-ab-deriver-a-tenant-root-managed-backup":"gs://QUALIFICATION_BACKUP_A","router-ab-deriver-b-tenant-root-managed-backup":"gs://QUALIFICATION_BACKUP_B"}'
```

Use the same physical mapping during deployment and on every node. Do not map both roles to one bucket.
The sample logical names come from the released role configuration. Confirm them against the selected package.
Keep emulator credentials and endpoint variables out of provider runs.

Install the verified executable as `/opt/seams/celld`. Run it under a dedicated account with access to `/var/lib/celld`.
For a one-node qualification run behind local HTTPS ingress, the process command is:

```sh
/opt/seams/celld --no-control-plane \
  --listen 127.0.0.1:8080 \
  --internal-listen 127.0.0.1:8081
```

Load the environment file through the existing process manager. Keep its permissions restricted.
Use the existing `celld deploy` and `celld d1 migrations apply` commands for each released role and the Gateway.
Deploy the Gateway as the public entrypoint and verify the effective manifest before opening ingress.
The private listener includes operator capabilities. Keep it on loopback for one VM.
For multiple nodes, bind and advertise private VPC addresses and restrict peer access to that fleet.
Verify the peer transport and ingress rules before allowing signing traffic.

## Google Cloud

Use project `seams-501403`, region `us-central1`, and zone `us-central1-a`.
Qualification resources use unique task-owned names and a dedicated service account.
Record resource identities and cleanup under the private `.artifacts` directory.
The ordinary candidate uses `n2d-standard-4`, AMD Milan, and the pinned Ubuntu 24.04 x86-64 image.
The Confidential candidate uses `n2d-standard-2` in `us-central1-c` with AMD SEV-SNP.
The requested four-vCPU configurations in zones a and b lacked capacity. The two-vCPU candidate in zone c succeeded.
Use an SSH tunnel for initial loopback-only qualification; production HTTPS ingress remains a separate gate.
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

Before retiring any classic host, identify its deployed consumers and durable state.
Give each consumer a verified replacement and a state-safe cutover procedure.
After adapter deletion, repeat acceptance with the final packaged release on both supported hosting models.
