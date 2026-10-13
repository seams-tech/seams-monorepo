"""Prove a real Yao pair stays burned after disconnect, exact retry and restart.

Usage: python3 yao-peer-disconnect.e2e.py CELLD WALLET_PACKAGE MOTO_PYTHON ESBUILD WALLET_CHECKOUT
Uses the public workerd scenario's unchanged WebSocket fault proxy and fixture builder.
"""

import importlib.util
import json
import os
import shutil
from pathlib import Path
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request

spec = importlib.util.spec_from_file_location(
    "wallet_harness", Path(__file__).with_name("packaged-wallet.e2e.py")
)
harness = importlib.util.module_from_spec(spec)
spec.loader.exec_module(harness)


def post(address, role, path, body, credential, addresses):
    request = urllib.request.Request(
        address + "/" + role + path,
        data=json.dumps(body).encode(),
        headers={
            "content-type": "application/json",
            "x-router-ab-internal-service-auth": credential,
            "x-seams-wallet-home-region": "US",
            "x-seams-wallet-object-addresses": json.dumps(addresses),
        },
    )
    try:
        reply = urllib.request.urlopen(request, timeout=120)
    except urllib.error.HTTPError as error:
        reply = error
    with reply:
        return {"status": reply.status, "body": json.loads(reply.read())}


def read(address, role, path):
    with urllib.request.urlopen(address + "/" + role + path, timeout=15) as reply:
        return json.loads(reply.read())


def read_proxy_after_restart(address):
    refusals = []
    deadline = time.monotonic() + 60
    while time.monotonic() < deadline:
        try:
            return {"evidence": read(address, "PROXY", "/evidence"), "refusals": refusals}
        except urllib.error.HTTPError as error:
            body = error.read().decode()
            if error.code != 500 or not (
                "DurableObjectRoutingError" in body
                and "owner is currently unreachable" in body
            ):
                raise RuntimeError((error.code, body)) from error
            refusals.append({"status": error.code, "body": body})
            time.sleep(0.25)
    raise RuntimeError("Proxy ownership did not recover after restart")


def require_pair_state(address, role, scope, credential, addresses, expected):
    for _ in range(80):
        reply = post(address, role.upper().replace("-", "_"),
                     "/router-ab/" + role + "/ed25519-yao/read-pair-status", scope, credential, addresses)
        assert reply["status"] == 200, reply
        if reply["body"]["status"] == expected:
            return expected
        time.sleep(0.1)
    raise AssertionError((role, expected, reply))


def main():
    if len(sys.argv) != 6:
        raise SystemExit(__doc__)
    binary, package, python, esbuild, checkout = [Path(value).absolute() for value in sys.argv[1:]]
    package = package.resolve()
    repository = Path(__file__).resolve().parents[3]
    root = Path(tempfile.mkdtemp(prefix="celld-yao-disconnect-", dir=repository / ".artifacts"))
    root.chmod(0o700)
    shutil.copyfile(__file__, root / "effective-driver.py")
    shutil.copyfile(Path(__file__).with_name("prepare-yao.mjs"), root / "effective-preparer.mjs")
    address = "http://127.0.0.1:" + str(harness.free_port())
    endpoint = "http://127.0.0.1:" + str(harness.free_port())
    environment = {
        "PATH": os.environ["PATH"], "HOME": os.environ["HOME"],
        "TMPDIR": os.environ.get("TMPDIR", "/tmp"),
        "SEAMS_LOCAL_PORT_OFFSET": str(int(address.rsplit(":", 1)[1]) - 4100),
        "AWS_ACCESS_KEY_ID": "local-test", "AWS_SECRET_ACCESS_KEY": "local-test-secret",
        "AWS_DEFAULT_REGION": "us-east-1", "AWS_ENDPOINT_URL": endpoint,
        "S3_ENDPOINT": endpoint, "AWS_EC2_METADATA_DISABLED": "true", "AWS_PAGER": "",
        "CELLD_ESBUILD": str(esbuild), "CELLD_DEPLOY_POLL_S": "1", "RUST_LOG": "warn",
        "ROUTER_AB_WORKER_BUILD_PROFILE": "release",
        "NODE_PATH": str(repository / "node_modules"),
    }
    result = {
        "status": "running", "stage": "prepare", "scope": "real packaged Yao pair disconnect, exact retry, independent wallet and restart; local synthetic S3",
        "runtimeSha256": harness.sha256(binary), "packageSha256": harness.directory_sha256(package),
        "manifestSha256": harness.sha256(package / "artifact-manifest.json"),
        "publicRevision": subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=checkout, text=True).strip(),
        "sourceHashes": {
            "driver": harness.sha256(Path(__file__)),
            "preparer": harness.sha256(Path(__file__).with_name("prepare-yao.mjs")),
            "proxy": harness.sha256(checkout / "crates/router-ab-cloudflare/scripts/yao-peer-disconnect-proxy.mjs"),
        },
    }
    processes = []
    print(root, flush=True)
    try:
        setup = Path(__file__).with_name("prepare-wallet.mjs")
        harness.run(["node", setup, package, root, address, "http://localhost:4201", "http://localhost:4202"],
                    root, environment, "prepare.log")
        prepared = json.loads((root / "prepared.json").read_text())
        manifest, configs, mapping = harness.prepare(package, root, prepared)
        result["package"] = manifest["package"]
        harness.run(["node", Path(__file__).with_name("prepare-yao.mjs"), root, checkout],
                    root, environment, "prepare-yao.log", timeout=240)
        environment["CELLD_R2_BUCKETS"] = json.dumps(mapping)
        emulator = harness.start([python, "-m", "moto.server", "-H", "127.0.0.1", "-p", endpoint.rsplit(":", 1)[1]],
                                 root, environment, "moto.log", processes)
        harness.wait_for_http(endpoint, emulator)
        for bucket in ("fleet-test", "backup-deriver-a", "backup-deriver-b"):
            harness.run(["aws", "s3api", "create-bucket", "--bucket", bucket], root, environment, "create-" + bucket + ".log")
        services = []
        for role in configs:
            config = json.loads((root / (role + ".json")).read_text())
            services.append({"binding": role.upper().replace("-", "_"), "service": config["name"]})
        services.extend([
            {"binding": "CAPTURE", "service": "yao-execution-capture"},
            {"binding": "PROXY", "service": "yao-connection-proxy"},
        ])
        observer = harness.OBSERVER.replace(
            "const role = url.pathname.split('/')[1];",
            """if (url.pathname === '/addresses') return Response.json({
      router: env.ROUTER_WALLET.newUniqueId().toString(),
      deriver_a: env.DERIVER_A_WALLET.newUniqueId().toString(),
      deriver_b: env.DERIVER_B_WALLET.newUniqueId().toString(),
      signing_worker: env.SIGNING_WORKER_WALLET.newUniqueId().toString()
    });
    const role = url.pathname.split('/')[1];""",
        )
        (root / "observer.mjs").write_text(observer)
        object_bindings = []
        for role, binding, class_name in (
            ("router", "ROUTER_WALLET", "RouterAbRouterWalletDurableObject"),
            ("deriver-a", "DERIVER_A_WALLET", "RouterAbDeriverAWalletDurableObject"),
            ("deriver-b", "DERIVER_B_WALLET", "RouterAbDeriverBWalletDurableObject"),
            ("signing-worker", "SIGNING_WORKER_WALLET", "RouterAbSigningWorkerWalletDurableObject"),
        ):
            object_bindings.append({"name": binding, "class_name": class_name, "script_name": configs[role]["name"]})
        harness.write_json(root / "observer.json", {
            "name": "yao-observer", "main": "observer.mjs", "compatibility_date": "2026-06-12",
            "services": services, "durable_objects": {"bindings": object_bindings},
        })
        result["stage"] = "deploy"
        for role in [*configs, "proxy", "capture", "order", "observer"]:
            harness.run([binary, "deploy", role + ".json", "--bucket", "fleet-test"], root, environment, "deploy-" + role + ".log")
        command = [binary, "--no-control-plane", "--bucket", "fleet-test", "--listen", address.removeprefix("http://"),
                   "--internal-listen", "127.0.0.1:0"]
        node = harness.start(command, root, environment, "node.log", processes)
        harness.wait_for_http(address + "/ROUTER", node)
        for role in configs:
            config = json.loads((root / (role + ".json")).read_text())
            for database in config.get("d1_databases", []):
                harness.run([binary, "d1", "migrations", "apply", database["database_name"], role + ".json", "--bucket", "fleet-test"],
                            root, environment, "migrate-" + role + ".log")
        inputs = json.loads((root / "yao-inputs.json").read_text())
        credential = inputs["internalCredential"]
        addresses = read(address, "", "addresses")
        result["stage"] = "create-tenant"
        created = post(address, "ROUTER", "/router-ab/internal/tenant-root/creation/v1/create", inputs["creation"], credential, addresses)
        assert created["status"] == 200 and created["body"]["status"]["kind"] == "ready", created
        envelope = inputs["envelope"]
        envelope["tenant_root"]["custody_lineage_b64u"] = created["body"]["custody_lineage_b64u"]
        result["stage"] = "disconnect"
        first = post(address, "ROUTER", "/router-ab/router/ed25519-yao/execute", envelope, inputs["gatewayCredential"], addresses)
        assert first["body"].get("status") != "succeeded", first
        execution = read(address, "CAPTURE", "/captured")
        assert execution is not None
        scope = {
            "wallet_route": execution["tenant_root"]["wallet_route"],
            "ownership_generation": execution["tenant_root"]["ownership_generation"],
            "root_identity": execution["tenant_root"]["identity"], "pair_binding": execution["pair_binding"],
        }
        states = {}
        for role in ("deriver-a", "deriver-b"):
            states[role] = require_pair_state(address, role, scope, credential, addresses, "burned")
        evidence = read(address, "PROXY", "/evidence")
        result["faultObservation"] = {
            "httpStatus": first["status"], "reply": first["body"],
            "roleStates": states, "connection": evidence,
        }
        assert evidence["disconnected"] and evidence["connectionAttempts"] == 1, evidence
        assert evidence["aMessages"] >= 1 and evidence["bMessages"] == 2, evidence
        retry = post(address, "DERIVER_A", "/router-ab/deriver-a/ed25519-yao/execute-pair", execution, credential, addresses)
        assert retry["status"] >= 400, retry
        assert read(address, "PROXY", "/evidence")["connectionAttempts"] == 1
        result["fault"] = {"httpStatus": first["status"], "status": first["body"].get("status"),
                           "roleStates": states, "connection": evidence, "exactRetryStatus": retry["status"]}
        result["stage"] = "independent-wallet-control"
        second = post(address, "ROUTER", "/router-ab/internal/tenant-root/creation/v1/create", inputs["secondCreation"], credential, addresses)
        assert second["status"] == 200 and second["body"]["status"]["kind"] == "ready", second
        independent = inputs["secondEnvelope"]
        independent["tenant_root"]["custody_lineage_b64u"] = second["body"]["custody_lineage_b64u"]
        answer = post(address, "ROUTER", "/router-ab/router/ed25519-yao/execute", independent, inputs["gatewayCredential"], read(address, "", "addresses"))
        assert answer["status"] == 200 and answer["body"]["status"] == "succeeded", answer
        result["independentWalletCompleted"] = True
        result["stage"] = "restart"
        harness.stop(node)
        processes.remove(node)
        node = harness.start(command, root, environment, "node-restarted.log", processes)
        harness.wait_for_http(address + "/ROUTER", node)
        for role in ("deriver-a", "deriver-b"):
            require_pair_state(address, role, scope, credential, addresses, "burned")
        retry = post(address, "DERIVER_A", "/router-ab/deriver-a/ed25519-yao/execute-pair", execution, credential, addresses)
        assert retry["status"] >= 400, retry
        takeover = read_proxy_after_restart(address)
        assert takeover["evidence"]["connectionAttempts"] == 0
        result["proxyTakeoverAfterRestart"] = takeover
        result["restart"] = {"roleStates": states, "exactRetryStatus": retry["status"], "newProtocolConnections": 0}
        result["status"] = "passed"
    except Exception as error:
        result["status"] = "failed"
        result["error"] = repr(error)
        raise
    finally:
        for process in reversed(processes):
            harness.stop(process)
        result["cleanup"] = "owned native process and local S3 emulator stopped"
        harness.write_json(root / "result.json", result)
        print(json.dumps(result), flush=True)


if __name__ == "__main__":
    main()
