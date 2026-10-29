"""Qualify released Wallet packages on two isolated Google runtime nodes.

Usage: python3 google-wallet.e2e.py RESOURCE_DIRECTORY WALLET_PACKAGE WALLET_CHECKOUT WALLET_SDK_PACKAGE
The ledger supplies owned VMs, separate GCS buckets, SSH credentials, and a
verified runtime installed on both nodes. The run retains evidence and stops
both VMs. It uses synthetic wallets and the existing public browser contracts.
"""

import importlib.util
import json
import os
from pathlib import Path
import shlex
import shutil
import socket
import subprocess
import sys
import tarfile
import tempfile
import time

source = Path(__file__).resolve()
repository = source.parents[3]
if len(sys.argv) != 5:
    raise SystemExit(__doc__)
ledger_directory, package, checkout, sdk_package = [
    Path(argument).resolve() for argument in sys.argv[1:]
]
ledger = json.loads((ledger_directory / "resources.json").read_text())
assert ledger["project"] == "seams-501403"
assert len(set(ledger["buckets"].values())) == 3
runtime = json.loads((ledger_directory / "runtime-build.json").read_text())
spec = importlib.util.spec_from_file_location(
    "wallet_harness", source.with_name("packaged-wallet.e2e.py")
)
harness = importlib.util.module_from_spec(spec)
spec.loader.exec_module(harness)
root = Path(tempfile.mkdtemp(prefix="google-wallet-", dir=ledger_directory))
root.chmod(0o700)
identifier = root.name.replace("_", "-")
# Reuse the existing remote process controller and its restricted task directory.
remote_directory = "/tmp/seams-celld-google-" + identifier
fleet = "gs://" + ledger["buckets"]["fleet"] + "/" + identifier
environment = {
    "PATH": os.environ["PATH"],
    "HOME": os.environ["HOME"],
    "TMPDIR": os.environ.get("TMPDIR", "/tmp"),
    "NODE_PATH": str(repository / "node_modules"),
    "GOOGLE_OIDC_CLIENT_ID": os.environ["GOOGLE_OIDC_CLIENT_ID"],
    "SEAMS_INTENDED_GOOGLE_ID_TOKEN": os.environ["SEAMS_INTENDED_GOOGLE_ID_TOKEN"],
    "SEAMS_INTENDED_GOOGLE_CLIENT_ID": os.environ["GOOGLE_OIDC_CLIENT_ID"],
}
package, sdk_package, package_hashes = harness.freeze_packages(
    package, sdk_package, root
)
nodes = [
    {"kind": "ordinary", "name": ledger["ordinaryVm"], "zone": ledger["zone"]},
    {
        "kind": "confidential",
        "name": ledger["confidentialVm"],
        "zone": ledger["confidentialZone"],
    },
]
processes = []
tunnels = []
prepared_nodes = []
tagged_nodes = []
firewalls = []
tag = "celld-" + identifier
app_origin = "http://localhost:" + str(harness.free_port())
wallet_origin = "http://localhost:" + str(harness.free_port())
gateway_port = harness.free_port()
address = "http://127.0.0.1:" + str(gateway_port)
environment["SEAMS_LOCAL_PORT_OFFSET"] = str(gateway_port - 4100)
result = {
    "status": "running",
    "stage": "prepare",
    "project": ledger["project"],
    "scope": "two Google nodes with fresh GCS state, tenant-root crash replay, released Wallet browser contracts, and Console onboarding",
    "artifactDirectory": str(root),
    "fleet": fleet,
    "runtime": runtime,
    "packageSnapshotHashes": package_hashes,
    "sourceRevision": subprocess.check_output(
        ["git", "rev-parse", "HEAD"],
        cwd=repository,
        text=True,
    ).strip(),
    "walletRevision": subprocess.check_output(
        ["git", "rev-parse", "HEAD"],
        cwd=checkout,
        text=True,
    ).strip(),
    "sourceHashes": {
        file.name: harness.sha256(file)
        for file in (
            source,
            source.with_name("google-runtime.remote.py"),
            source.with_name("packaged-wallet.e2e.py"),
            source.with_name("prepare-wallet.mjs"),
            source.with_name("prepare-gateway.mjs"),
            source.with_name("console.e2e.ts"),
            source.with_name("google-console-count.py"),
            repository / "deployment/celld/render.mjs",
        )
    },
}
(root / "sources").mkdir(mode=0o700)
for name in result["sourceHashes"]:
    file = (
        repository / "deployment/celld/render.mjs"
        if name == "render.mjs"
        else source.with_name(name)
    )
    shutil.copyfile(file, root / "sources" / name)
print(root, flush=True)


def cloud(arguments, label, timeout=300):
    path = root / (label + ".log")
    with path.open("w") as log:
        subprocess.run(
            ["gcloud", *arguments],
            stdout=log,
            stderr=subprocess.STDOUT,
            check=True,
            timeout=timeout,
        )
    return path


def instance_options(node):
    return ["--project=" + ledger["project"], "--zone=" + node["zone"]]


def ssh_options(node):
    return [
        *instance_options(node),
        "--ssh-key-file=" + str(ledger_directory / "ssh-key"),
        "--quiet",
    ]


def remote(node, action, label):
    command = shlex.join(
        [
            "python3",
            remote_directory + "/remote.py",
            remote_directory,
            action,
        ]
    )
    path = cloud(
        [
            "compute",
            "ssh",
            node["name"],
            *ssh_options(node),
            "--command=" + command,
        ],
        label,
    )
    records = [
        json.loads(line)
        for line in path.read_text().splitlines()
        if line.startswith("{")
    ]
    assert len(records) == 1, (label, len(records))
    return records[0]


def upload(node, file, destination, label):
    cloud(
        [
            "compute",
            "scp",
            str(file),
            node["name"] + ":" + destination,
            *ssh_options(node),
        ],
        label,
    )


def render(role):
    harness.run(
        [
            "node",
            repository / "deployment/celld/render.mjs",
            root / (role + ".json"),
            root / "empty-secrets.json",
            root / "rendered" / role,
        ],
        root,
        environment,
        "render-" + role + ".log",
    )


def publish(node, roles, label):
    archive = root / (label + ".tar.gz")
    with tarfile.open(archive, "w:gz") as output:
        for role in roles:
            output.add(
                root / "rendered" / role,
                arcname=Path(remote_directory).name + "/rendered/" + role,
            )
        output.add(
            source.with_name("google-runtime.remote.py"),
            arcname=Path(remote_directory).name + "/remote.py",
        )
    archive.chmod(0o600)
    upload(node, archive, remote_directory + ".tar.gz", label + "-upload")
    command = (
        "umask 077; tar -xzf " + shlex.quote(remote_directory + ".tar.gz") + " -C /tmp"
    )
    cloud(
        ["compute", "ssh", node["name"], *ssh_options(node), "--command=" + command],
        label + "-extract",
    )


def configure(node, roles, label):
    provider = dict(
        node,
        id=identifier,
        fleet=fleet,
        mapping=mapping,
        roles=roles,
        runtimeSha256=runtime["executableSha256"],
    )
    path = root / (label + "-provider.json")
    harness.write_json(path, provider)
    path.chmod(0o600)
    upload(node, path, remote_directory + "/provider.json", label + "-provider")


def stop_and_collect(node, label):
    stopped = remote(node, "stop", label + "-stop")
    remote(node, "collect", label + "-collect")
    cloud(
        [
            "compute",
            "scp",
            node["name"] + ":" + remote_directory + "/diagnostics.tar.gz",
            str(root / (label + "-diagnostics.tar.gz")),
            *ssh_options(node),
        ],
        label + "-download",
    )
    return stopped


def wait_ready(node, process):
    deadline = time.monotonic() + 90
    while time.monotonic() < deadline:
        assert process.poll() is None, "Owned SSH tunnel stopped before readiness"
        try:
            if (
                harness.response(node["address"] + "/.well-known/celld/health")[
                    "status"
                ]
                == 200
            ):
                return
        except OSError:
            pass
        time.sleep(0.2)
    raise RuntimeError("Google runtime readiness timed out")


def bootstrap(node, label):
    command = [
        "node",
        package / "cloudflare-router-ab/scripts/bootstrap-local-tenant-root.mjs",
        "--root",
        root,
        "--issuer-env-path",
        prepared["issuerPath"],
        "--grant-file",
        root / "tenant-root-grant.json",
        "--org-id",
        "org_local_wallet",
        "--project-id",
        "local-smoke-project",
        "--env-id",
        "local-smoke-project:dev",
        "--signing-root-id",
        "local-smoke-project:dev",
        "--signing-root-version",
        "default",
        "--router-url",
        node["address"],
    ]
    deadline = time.monotonic() + 120
    attempts = 0
    while True:
        path = root / (label + "-" + str(attempts) + ".log")
        with path.open("w") as log:
            attempt = subprocess.run(
                command,
                cwd=root,
                env=environment,
                stdout=log,
                stderr=subprocess.STDOUT,
                timeout=90,
            )
        if attempt.returncode == 0:
            reply = json.loads(path.read_text())
            assert reply["kind"] == "wallet_local_tenant_root_ready_v1"
            return reply
        failure = path.read_text()
        if "owner_unreachable" not in failure or time.monotonic() >= deadline:
            raise RuntimeError("Tenant-root bootstrap failed: " + path.name)
        attempts += 1
        time.sleep(1)


def qualify_console():
    global remote_directory, fleet
    result["stage"] = "console-onboarding"
    result["walletStopBeforeConsole"] = {
        node["kind"]: stop_and_collect(node, "wallet-" + node["kind"])
        for node in prepared_nodes
    }
    prepared_nodes.clear()
    remote_directory += "-console"
    fleet += "-console"
    result["consoleFleet"] = fleet
    directory = root / "console"
    directory.mkdir(mode=0o700)
    driver = directory / "console-driver.cjs"
    reader = directory / "google-console-count.py"
    shutil.copyfile(source.with_name("google-console-count.py"), reader)
    reader.chmod(0o700)
    console_environment = dict(environment, SEAMS_WALLET_SERVER_CANDIDATE=str(package))
    node = nodes[0]
    harness.write_json(
        directory / "google-count.json",
        {
            "project": ledger["project"],
            "instance": node["name"],
            "zone": node["zone"],
            "sshKey": str(ledger_directory / "ssh-key"),
            "remoteDirectory": remote_directory,
        },
    )
    harness.run(
        [
            repository / "node_modules/.bin/esbuild",
            source.with_name("console.e2e.ts"),
            "--bundle",
            "--platform=node",
            "--format=cjs",
            "--main-fields=module,main",
            "--conditions=workerd,worker,browser",
            "--external:esbuild",
            "--external:@playwright/test",
            "--external:node:*",
            "--loader:.wasm=file",
            "--tsconfig=" + str(repository / "tests/tsconfig.playwright.json"),
            "--outfile=" + str(driver),
        ],
        root,
        environment,
        "console-bundle.log",
    )
    harness.run(
        [
            "node",
            driver,
            "prepare",
            directory,
            reader,
            address,
            repository,
        ],
        root,
        console_environment,
        "console-prepare.log",
    )
    (directory / "guard.mjs").write_text(
        'export default { fetch() { return new Response("Dependency unavailable", { status: 503 }); } };\n'
    )
    harness.write_json(
        directory / "guard.json",
        {
            "name": "guard",
            "main": "guard.mjs",
            "no_bundle": True,
            "compatibility_date": "2026-04-17",
        },
    )
    roles = ["guard", "console", "consumer"]
    for role in roles:
        harness.run(
            [
                "node",
                repository / "deployment/celld/render.mjs",
                directory / (role + ".json"),
                root / "empty-secrets.json",
                root / "rendered" / role,
            ],
            root,
            environment,
            "console-render-" + role + ".log",
        )
    for node in nodes:
        publish(node, roles, "console-" + node["kind"])
        configure(node, roles, "console-" + node["kind"])
        prepared_nodes.append(node)
    result["consoleDeployment"] = remote(nodes[0], "deploy", "console-deploy")
    result["consoleStart"] = {
        node["kind"]: remote(node, "start", "console-start-" + node["kind"])
        for node in nodes
    }
    result["consoleMigrations"] = remote(nodes[0], "migrate", "console-migrate")
    harness.run(
        [
            "node",
            driver,
            "verify",
            directory,
            reader,
            address,
            repository,
        ],
        root,
        environment,
        "console-verify.log",
        timeout=300,
    )
    result["console"] = {
        "preparation": json.loads((directory / "prepared-proof.json").read_text()),
        "onboarding": json.loads((directory / "onboarding-proof.json").read_text()),
        "bundleSha256": harness.sha256(root / "rendered/console/worker.mjs"),
    }


try:
    manifest = json.loads((package / "artifact-manifest.json").read_text())
    sdk_version = json.loads((sdk_package / "package.json").read_text())["version"]
    assert manifest["package"]["version"] == sdk_version
    result["package"] = manifest["package"]
    result["manifestSha256"] = harness.sha256(package / "artifact-manifest.json")
    harness.run(
        [
            "node",
            source.with_name("prepare-wallet.mjs"),
            package,
            root,
            address,
            app_origin,
            wallet_origin,
        ],
        root,
        environment,
        "prepare.log",
    )
    prepared = json.loads((root / "prepared.json").read_text())
    manifest, configs, local_mapping = harness.prepare(package, root, prepared)
    mapping = {
        key: "gs://"
        + ledger["buckets"]["backup-a" if value.endswith("deriver-a") else "backup-b"]
        for key, value in local_mapping.items()
    }
    assert len(set(mapping.values())) == 2
    result["backupBuckets"] = mapping
    (root / "operator-router.mjs").write_text(
        "export default { fetch(request, env) { return env.ROUTER.fetch(request); } };\n"
    )
    harness.write_json(
        root / "operator-router.json",
        {
            "name": "operator-router",
            "main": "operator-router.mjs",
            "no_bundle": True,
            "compatibility_date": "2026-06-12",
            "services": [{"binding": "ROUTER", "service": configs["router"]["name"]}],
        },
    )
    roles = [*configs, "operator-router"]
    (root / "empty-secrets.json").write_text("{}\n")
    (root / "rendered").mkdir(mode=0o700)
    for role in roles:
        render(role)
    result["stage"] = "google-runtime"
    for node in nodes:
        cloud(
            [
                "compute",
                "instances",
                "start",
                node["name"],
                *instance_options(node),
                "--quiet",
            ],
            "start-vm-" + node["kind"],
        )
        path = cloud(
            [
                "compute",
                "instances",
                "describe",
                node["name"],
                *instance_options(node),
                "--format=json(name,status,labels,networkInterfaces,machineType,confidentialInstanceConfig)",
            ],
            "instance-" + node["kind"],
        )
        instance = json.loads(path.read_text())
        assert instance["status"] == "RUNNING"
        assert instance["labels"]["purpose"] == "r190-qualification"
        node["privateIp"] = instance["networkInterfaces"][0]["networkIP"]
        node["machine"] = instance["machineType"]
    allow, deny = tag + "-allow", tag + "-deny"
    for name, arguments in (
        (
            allow,
            [
                "--priority=900",
                "--allow=tcp:19081",
                "--source-ranges="
                + ",".join(node["privateIp"] + "/32" for node in nodes),
            ],
        ),
        (
            deny,
            [
                "--priority=1000",
                "--action=DENY",
                "--rules=tcp:19081",
                "--source-ranges=0.0.0.0/0",
            ],
        ),
    ):
        cloud(
            [
                "compute",
                "firewall-rules",
                "create",
                name,
                "--project=" + ledger["project"],
                "--network=default",
                "--target-tags=" + tag,
                *arguments,
                "--quiet",
            ],
            "create-" + name,
        )
        firewalls.append(name)
    for index, node in enumerate(nodes):
        cloud(
            [
                "compute",
                "instances",
                "add-tags",
                node["name"],
                *instance_options(node),
                "--tags=" + tag,
                "--quiet",
            ],
            "tag-" + node["kind"],
        )
        tagged_nodes.append(node)
        publish(node, roles, "roles-" + node["kind"])
        configure(node, roles, "roles-" + node["kind"])
        prepared_nodes.append(node)
        if index == 0:
            result["deployedRoles"] = remote(node, "deploy", "deploy-roles")
        node["start"] = remote(node, "start", "start-runtime-" + node["kind"])
        port = gateway_port if index == 0 else harness.free_port()
        node["address"] = "http://127.0.0.1:" + str(port)
        tunnel = harness.start(
            [
                "gcloud",
                "compute",
                "ssh",
                node["name"],
                *ssh_options(node),
                "--",
                "-N",
                "-o",
                "ExitOnForwardFailure=yes",
                "-L",
                str(port) + ":127.0.0.1:19080",
            ],
            root,
            environment,
            "tunnel-" + node["kind"] + ".log",
            processes,
        )
        tunnels.append((tunnel, port))
        wait_ready(node, tunnel)
    result["nodes"] = nodes
    result["migrations"] = remote(nodes[0], "migrate", "migrate-roles")
    result["stage"] = "tenant-root-crash-replay"
    first = bootstrap(nodes[0], "bootstrap-first")
    harness.write_json(root / "bootstrap-first.log", first)
    result["ownerKill"] = remote(nodes[0], "kill", "kill-first-node")
    replay = bootstrap(nodes[1], "bootstrap-replay")
    assert replay["replayed"] is True
    for field in (
        "identityDigestB64u",
        "custodyLineageB64u",
        "revision",
        "rootCommitmentB64u",
    ):
        assert replay[field] == first[field], field
    result["tenantRootCrashReplay"] = {
        "identityDigestB64u": first["identityDigestB64u"],
        "custodyLineageB64u": first["custodyLineageB64u"],
        "replayed": True,
    }
    node = nodes[0]
    result["replacement"] = remote(node, "start", "restart-first-node")
    result["stage"] = "gateway"
    harness.prepare_gateway(
        package, root, address, app_origin, wallet_origin, environment, result
    )
    render("gateway")
    for node in nodes:
        publish(node, ["gateway"], "gateway-" + node["kind"])
        configure(node, ["gateway"], "gateway-" + node["kind"])
    result["gatewayDeployment"] = remote(nodes[0], "deploy", "deploy-gateway")
    result["gatewayMigrations"] = remote(nodes[0], "migrate", "migrate-gateway")
    deadline = time.monotonic() + 90
    while time.monotonic() < deadline:
        reply = harness.response(address + "/readyz")
        if reply["status"] == 200:
            break
        time.sleep(1)
    assert reply["status"] == 200, reply
    result["gatewayReady"] = reply
    harness.run_browser_contracts(
        root,
        checkout,
        sdk_package,
        address,
        app_origin,
        wallet_origin,
        environment,
        result,
        processes,
    )
    result["residency"] = {
        node["kind"]: remote(node, "runtime-state", "residency-" + node["kind"])
        for node in nodes
    }
    qualify_console()
    assert harness.directory_sha256(package) == package_hashes["wallet-server"]
    assert harness.directory_sha256(sdk_package) == package_hashes["wallet"]
    result["status"] = "passed"
except KeyboardInterrupt:
    result["status"] = "cancelled"
    result["error"] = "Qualification stopped by the operator"
except Exception as error:
    result["status"] = "failed"
    result["error"] = repr(error)
finally:
    cleanup_errors = []
    for node in prepared_nodes:
        try:
            result["stop-" + node["kind"]] = stop_and_collect(node, node["kind"])
        except Exception as error:
            cleanup_errors.append(repr(error))
    for process, port in tunnels:
        try:
            harness.stop(process)
            assert process.poll() is not None
            try:
                with socket.create_connection(("127.0.0.1", port), timeout=1):
                    raise RuntimeError("Owned SSH forwarding port remains open")
            except ConnectionRefusedError:
                pass
        except Exception as error:
            cleanup_errors.append(repr(error))
    tunnel_pids = {process.pid for process, port in tunnels}
    for process in reversed(processes):
        if process.pid not in tunnel_pids:
            try:
                harness.stop(process)
            except Exception as error:
                cleanup_errors.append(repr(error))
    for name in firewalls:
        try:
            cloud(
                [
                    "compute",
                    "firewall-rules",
                    "delete",
                    name,
                    "--project=" + ledger["project"],
                    "--quiet",
                ],
                "delete-" + name,
            )
        except Exception as error:
            cleanup_errors.append(repr(error))
    for node in tagged_nodes:
        try:
            cloud(
                [
                    "compute",
                    "instances",
                    "remove-tags",
                    node["name"],
                    *instance_options(node),
                    "--tags=" + tag,
                    "--quiet",
                ],
                "untag-" + node["kind"],
            )
        except Exception as error:
            cleanup_errors.append(repr(error))
    for node in nodes:
        try:
            cloud(
                [
                    "compute",
                    "instances",
                    "stop",
                    node["name"],
                    *instance_options(node),
                    "--quiet",
                ],
                "stop-vm-" + node["kind"],
            )
            path = cloud(
                [
                    "compute",
                    "instances",
                    "describe",
                    node["name"],
                    *instance_options(node),
                    "--format=json(name,status,tags.items)",
                ],
                "final-vm-" + node["kind"],
            )
            final = json.loads(path.read_text())
            assert final["status"] == "TERMINATED"
            assert tag not in final.get("tags", {}).get("items", [])
        except Exception as error:
            cleanup_errors.append(repr(error))
    result["cleanupErrors"] = cleanup_errors
    result["limits"] = [
        "The browser runs locally through SSH forwarding. Public DNS, certificates and external ingress require separate acceptance.",
        "The crash check covers exact tenant-root creation replay. It does not establish full-wallet recovery after losing all replicas.",
        "Shared GCS remains available. Storage partitions, Google-hosted relocation and Cloudflare cutover require separate acceptance.",
    ]
    if cleanup_errors:
        result["status"] = "failed"
    harness.write_json(root / "result.json", result)
    print(
        json.dumps(
            {
                "status": result["status"],
                "stage": result["stage"],
                "error": result.get("error"),
                "cleanupErrors": cleanup_errors,
            }
        ),
        flush=True,
    )

if result["status"] != "passed":
    raise SystemExit(1)
