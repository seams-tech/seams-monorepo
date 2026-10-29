# Celld provider qualification runbook

Status: Wallet 0.28.0 passes 18 selected browser contracts on a two-node Google
fleet with celld `.7`, ordinary and SEV-SNP VMs, and real GCS in `us-central1`.
Tenant-root creation replay also passes after a node kill and takeover.
See [the retained result](evidence/google-wallet-028-console-incomplete.json).

The combined run stopped at a Console fixture failure after all Wallet cases
passed. The fixture omitted eight required regional service bindings. A local
workerd control reproduces the 500 and returns the required 401 with those
bindings. The fixture is corrected. Its Google retest remains incomplete because
the user stopped qualification on October 30, 2026. The retained overall result
therefore remains failed at `console-onboarding`.

This establishes the recorded Wallet execution scope. Public ingress, complete
upgrade qualification, and Cloudflare outage recovery remain separate work.

Earlier Google runtime primitives and 16 selected Wallet contracts also pass.
The native `.5` x86-64 release passes on an ordinary `n2d-standard-4` VM in `us-central1-a`
and a SEV-SNP `n2d-standard-2` VM in `us-central1-c`, using the pinned Ubuntu 24.04 image.
The kernel confirms active SEV-SNP operation. The source build and Clippy pass with locked dependencies.
External objects, raw EC operations, A/B streams, conditional writes, direct buckets, and forced-kill recovery pass.
A Google IAM denial test observes B failure while A remains writable. The B grant was restored.
The two-VM object ownership scenario also passes. Local 0.11.0 Wallet and Console checks pass on both runtimes.
The final 0.11.0 archives pass the same 16 contracts on both Google VM types.
The [one-node Wallet failure check](evidence/google-wallet-one-node-failure.json) and [Google Console onboarding](evidence/google-console.json) also pass.
The `.7` Linux release also passes timed Yao owner loss across the ordinary and SEV-SNP VMs.
Both claims are running before SIGKILL, confirmed within 6,195 ms of execute submission.
The survivor takes ownership at epoch 2, retains burned state, refuses replay, and completes independent registration.
Both VMs stop with no remaining temporary peer rules. Shared storage stays available during the test.
See [the `.7` runtime evidence](evidence/websocket-passthrough.json).
The broader distributed lifecycle matrix, release promotion, and live cutover checks remain open.
See [final Google package evidence](evidence/google-wallet-final-packages.json) and [earlier evidence and limitations](evidence/google-wallet.json).
On AWS, a `.7` executable built on EC2 passes on two ordinary `m7i.xlarge` instances in `ap-southeast-1` with S3 storage.
It passes the single-VM check and timed Yao owner loss, TCP rejection and silent packet loss with Wallet Server 0.17.0.
See [AWS EC2 evidence](evidence/aws-ec2.json). The browser contracts, S3 denial, Console and SEV-SNP remain open on AWS.
The deleted project `eigen-413918` must not be used.
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
The proxy replaces forwarded host, protocol, and client-IP fields and buffers request bodies before forwarding.
Client IP comes from the direct socket peer. Caller-supplied Cloudflare and forwarding headers cannot select it.
A separate upstream load balancer requires an explicitly trusted real-IP configuration before using its client address.
Verify this boundary locally with `python3 tests/e2e/celld/nginx-ingress.e2e.py NGINX deployment/celld/nginx.conf.example`.
This uses loopback listeners and a synthetic TLS certificate. See [the review evidence](evidence/local-review.json).
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

## AWS EC2

Use region `ap-southeast-1` and one subnet in `ap-southeast-1a`. Both qualification nodes use `m7i.xlarge`
and the current Canonical Ubuntu 24.04 x86-64 image from the public SSM parameter.
The three buckets have the same roles as in the Google fleet: fleet, A backup and B backup.
An instance role grants object access to those three buckets only. Require IMDSv2 with a hop limit of 1.

celld reads the instance-role credentials itself. Set `AWS_REGION` for the service and for every `celld` command.
Without it, `celld deploy` addresses `us-east-1` and fails with `Received redirect without LOCATION`.
Keep `S3_ENDPOINT` and `AWS_ENDPOINT_URL` unset. Those variables belong to the emulator runs only.

The security group admits SSH from the operator address only. It has no standing rule for the peer port.
The Yao driver opens TCP 19081 between the two private addresses for one run and revokes the rule afterwards.
Singapore offers no AMD SEV-SNP instance types. The AWS run therefore covers ordinary instances only.

## Minimal AWS resource setup

Use a unique task identifier. It names the buckets, role, key pair and security group.
Tag every resource with it. Build the runtime on one node with [build.mjs](build.mjs) and the pinned toolchain.
Install the same executable on both nodes.

```sh
export AWS_REGION=ap-southeast-1 TASK=celld-aws-TASK_ID
for kind in fleet backup-a backup-b; do
  aws s3api create-bucket --bucket "$TASK-$kind" --create-bucket-configuration LocationConstraint=$AWS_REGION
  aws s3api put-public-access-block --bucket "$TASK-$kind" --public-access-block-configuration \
    BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true
done

# EC2_TRUST_POLICY lets ec2.amazonaws.com assume the role.
# BUCKET_POLICY allows ListBucket on the three buckets and Get/Put/Delete/AbortMultipartUpload on their objects.
aws iam create-role --role-name "$TASK" --assume-role-policy-document file://EC2_TRUST_POLICY
aws iam put-role-policy --role-name "$TASK" --policy-name buckets --policy-document file://BUCKET_POLICY
aws iam create-instance-profile --instance-profile-name "$TASK"
aws iam add-role-to-instance-profile --instance-profile-name "$TASK" --role-name "$TASK"

aws ec2 import-key-pair --key-name "$TASK" --public-key-material fileb://RESOURCE_DIRECTORY/ssh-key.pub
GROUP=$(aws ec2 create-security-group --group-name "$TASK" --description "$TASK" \
  --vpc-id VPC_ID --query GroupId --output text)
aws ec2 authorize-security-group-ingress --group-id "$GROUP" --protocol tcp --port 22 --cidr OPERATOR_IP/32

aws ec2 run-instances --count 2 --instance-type m7i.xlarge --subnet-id SUBNET_ID \
  --image-id resolve:ssm:/aws/service/canonical/ubuntu/server/24.04/stable/current/amd64/hvm/ebs-gp3/ami-id \
  --security-group-ids "$GROUP" --key-name "$TASK" --iam-instance-profile "Name=$TASK" \
  --metadata-options HttpTokens=required,HttpEndpoint=enabled,HttpPutResponseHopLimit=1 \
  --block-device-mappings 'DeviceName=/dev/sda1,Ebs={VolumeSize=60,VolumeType=gp3,Encrypted=true}'
```

Record the account, region, security group, buckets, and both instance IDs in `RESOURCE_DIRECTORY/resources.json`.
Use `"provider": "aws"` and a `nodes` list of `{kind, instance}` entries.
Place `runtime-build.json`, `native-release.tar.gz` and the SSH key beside it, as for the Google ledger.
Each node needs `python3`, `iptables`, `iproute2`, the AWS CLI and the verified runtime at `/opt/seams/celld`.

```sh
python3 tests/e2e/celld/aws-single-vm.e2e.py RESOURCE_DIRECTORY node-1
python3 tests/e2e/celld/aws-yao.e2e.py RESOURCE_DIRECTORY WALLET_SERVER_PACKAGE WALLET_CHECKOUT owner-loss
```

The AWS drivers mirror the Google drivers. Only the provider operations differ.
SSH and SCP replace `gcloud compute`, and S3 replaces GCS.
A temporary security-group rule replaces the temporary firewall rules and tags.
The Yao driver starts both instances and stops them again during cleanup.
A new account can refuse its first launch with `PendingVerification`. On 2026-10-21 this cleared within minutes.

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

## Repeat current Google Wallet qualification

Use two owned qualification VMs and fresh fleet state. The resource ledger names
both VMs, their zones, and three separate GCS buckets. It also contains the SSH
key and the runtime build record. Install that exact executable on both VMs.

Supply `GOOGLE_OIDC_CLIENT_ID` and `SEAMS_INTENDED_GOOGLE_ID_TOKEN` through the
protected test environment. Refresh the token with the public repository's
existing `ensure:intended-google-token` command before a long run.

```sh
python3 tests/e2e/celld/google-wallet.e2e.py \
  RESOURCE_DIRECTORY WALLET_SERVER_PACKAGE WALLET_CHECKOUT WALLET_SDK_PACKAGE
```

The runner freezes both packages and verifies the packaged Worker manifest.
It uses the existing deployment renderer and GCS mappings. It creates a tenant
root, kills its initial node, verifies exact creation replay on the survivor,
and restarts the killed node. It then runs the selected public Wallet browser
contracts against the Google Gateway with both runtime nodes available. The
selection includes Email OTP execution recovery and Google recovery of an
Email-founded wallet.

The same run bundles the current Console Worker, applies its unchanged
migrations, and executes the shared onboarding scenario through a service
binding in a separate fleet namespace after stopping the Wallet processes.
Read-only count proofs use the native D1 CLI over the owned SSH
connection. The scenario checks exact onboarding replay and unauthorized
activation refusal. It does not activate a tenant deployment.

Each run retains source snapshots, artifact hashes, migration logs, browser
results, runtime logs, and `result.json`. A failed cleanup fails the run. The
runner stops both VMs and removes its temporary peer rules and network tags.
Synthetic accounts and credentials remain inside the protected artifact folder.

The browser connects through SSH forwarding. Public DNS, certificates, external
ingress, storage-provider failures, and recovery after losing all replicas need
separate evidence. This scenario does not establish Cloudflare-to-Google cutover.

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
  RESOURCE_DIRECTORY WALLET_SERVER_PACKAGE WALLET_CHECKOUT owner-loss

# Explicit TCP rejection, with existing peer sockets closed:
python3 tests/e2e/celld/google-yao.e2e.py \
  RESOURCE_DIRECTORY WALLET_SERVER_PACKAGE WALLET_CHECKOUT peer-partition

# Silent packet loss, without forced socket closure:
python3 tests/e2e/celld/google-yao.e2e.py \
  RESOURCE_DIRECTORY WALLET_SERVER_PACKAGE WALLET_CHECKOUT silent-partition

# Drained executable cycle after owner loss:
python3 tests/e2e/celld/google-yao.e2e.py \
  RESOURCE_DIRECTORY WALLET_SERVER_PACKAGE WALLET_CHECKOUT runtime-cycle
```

Install the same reviewed Linux runtime on both ledger VMs before running this command.
The executable digest must match `runtime-build.json`. The driver refuses mismatched executables.
The driver uses project `seams-501403`, the ordinary VM, the SEV-SNP VM, and the three task buckets.
The owner-loss mode records A/B owners, holds B's second reply, kills B's owner, and checks burned state after takeover.
That mode also checks the replacement ownership epoch and the unchanged surviving process.
The partition modes filter only A-side OUTPUT traffic to the other VM with TCP source or destination port 19081.
SSH and shared storage remain available. Both processes retain their PIDs, owner records stay unchanged, and leases renew.
After healing, the interrupted pair stays burned and a retry opens no new protocol connection.
The silent case releases its held reply before the ceremony timeout and places the fresh control's A/B objects on separate VMs.
See [the measured partition scope and limits](evidence/peer-partitions.json).

The driver stops both VMs, removes its host rules and temporary cloud rules/tags, then reaps its local SSH processes.
Each forwarding port must refuse connections. Cleanup failures make the result fail.
Each retained run includes the controller sources, rendered artifact hashes, ownership records, native logs, and `result.json`.

The required peer-WebSocket feature proves loader refusal only. A safe mixed-version rollout requires separate evidence.
Before publishing a manifest that requires it, drain old processes and verify every serving node uses the current reviewed executable.
Do not start `.5` against that manifest or remove its required feature to permit a downgrade.
Keep durable state and consumed material intact. Full state-safe upgrade and rollback qualification remains open.

The `runtime-cycle` scenario adds a drained `.7` to `.6` to `.7` cycle after owner loss and an independent registration.
Keep the reviewed `.6` executable at `/opt/seams/celld.seams6` and its build record at `RESOURCE_DIRECTORY/release-6/runtime-build.json`.
The runner verifies the file hash and running executable hash at startup.
It uses the same GCS fleet and watch directory throughout the cycle. It does not restore a storage snapshot or deploy new manifests.
Both checkpoints require burned A/B claims, no new protocol connection on retry, nondecreasing runtime ownership epochs, and exact creation receipt replay.
The earlier runtime must stop successfully before its replacement starts.
See [the Google runtime cycle evidence](evidence/google-runtime-cycle.json).

This case tests durable-state compatibility. Known `.6` WebSocket defects still prevent recommending `.6` for production.
Only the ordinary survivor runs the cycle. The Confidential peer remains stopped after its injected failure.
Fresh claims during drain, mixed-version serving, and ECDSA state across provider upgrades remain separate checks.

## Repeat the local tenant-root restore and upgrade check

```sh
python3 tests/e2e/celld/tenant-root-restore.e2e.py \
  CELLD_7 WALLET_SERVER_PACKAGE MOTO_PYTHON ESBUILD WALLET_CHECKOUT CELLD_5
```

Use the reviewed `.5` and `.7` executables and exact 0.11.0 Wallet Server candidate.
The test observer can inspect synthetic databases and buckets. The runner binds it to loopback only.
Never deploy this observer into a product fleet.

The runner creates a real ECDSA signature and applies the public restore and retirement assertions on `.5`.
It then stops that process before deploying `.7` manifests.
It starts `.7` with the same durable state and verifies the original restore receipt, revision, and current epoch records.
It also requires exact ECDSA signature replay and refuses both changed finalization input and consumed-presign reuse before request expiry.
It repeats those checks after another restart. It records temporary ownership refusals and waits at most 60 seconds for takeover.
Each run retains its source copies, source and package hashes, native logs, and result file.

This qualifies an offline local upgrade for these tenant-root records and consumed ECDSA material.
It does not qualify live claims during upgrade, mixed-version serving, all-replica recovery, or a provider storage partition.
The same local runner also injects a GET denial in the A backup bucket after one A share is removed.
It verifies B remains readable, restore fails, and selected role-share metadata does not advance.
After access returns, the identical authorized restore request must complete the existing restore and refresh assertions.
This synthetic S3 case does not qualify GCS IAM or loss of both shares.
See [backup-read refusal evidence](evidence/backup-read-refusal.json).
It then denies deletion of B's retired epoch-1 backup. The next refresh must remain pending without advancing active-share metadata.
After deletion access returns, the identical refresh must succeed and the selected old backup must return GET 404.
See [retirement-deletion evidence](evidence/retirement-delete-refusal.json), including an unresolved earlier `.5` macOS SIGILL.
These local checks do not establish GCS behavior or cryptographic erasure.

The runner now allows the existing 45-second service stop bound and requires exit status zero after SIGTERM.
It holds an admitted observer request, checks that a new application request receives the explicit draining refusal,
and releases the held request to replay the exact stored signature through the Router.
It then attempts the incompatible `.5` executable without changing the `.7` manifests or durable state.
That executable must refuse the required feature. The `.7` restart must preserve the stored outcomes and consumed-material refusals.
See [the current package qualification](evidence/registration-rebase-qualification.json) for the `.5` to `.7` run.
The [earlier shutdown evidence](evidence/shutdown-runtime-upgrade.json) records the `.5` to `.6` run.
This qualifies completion of an admitted stored-response replay during local shutdown. Fresh signing claims and fleet drain remain open.
Rollback must preserve current durable records. Never restore an older storage snapshot to undo an executable change.

The [Yao runtime upgrade check](evidence/yao-runtime-upgrade.json) additionally proves that an interrupted pair remains burned after `.5` to `.6` and another restart.
It observes both role states and zero new protocol connections on exact retry.
The [ECDSA upgrade check](evidence/ecdsa-runtime-upgrade.json) covers consumed presign material. Live mixed-version rollout remains unqualified.

## Repeat the composed workerd relocation control

Use the public checkout with its current release Worker and client WASM builds.
Build the private packages, then run the existing composition scenario:

```sh
pnpm -C packages/console-server-ts build
pnpm -C packages/wallet-console-server-ts build
SEAMS_WALLET_SERVER_CANDIDATE=WALLET_CHECKOUT/packages/wallet-server \
  ROUTER_AB_WORKER_BUILD_PROFILE=release \
  node tests/e2e/relocation-custody.e2e.mjs --with-ecdsa
```

Omit `--with-ecdsa` for the Ed25519-only control.
The scenario writes proofs under `.artifacts/r155d-addresses/composed-mixed-relocation` or `composed-relocation`.
The [recorded control](evidence/relocation-workerd-control.json) verifies that all 25 Worker files match the packed `0.11.0` candidate.
It covers generation 1 to 2, owner approval, signing settlement, source cleanup, persisted addresses, and destination signatures.
The local browser check uses direct session persistence. Hosted acceptance and return moves remain open.
The [two-process celld result](evidence/relocation-two-node.json) verifies the same mixed scenario with separate source and destination processes.
The older raw Miniflare harness does not provide the current stored-ID eviction hook and remains unqualified.
