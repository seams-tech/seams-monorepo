"""Verify root restore and consumed ECDSA material across a celld upgrade.

Usage: python3 tenant-root-restore.e2e.py CELLD WALLET_PACKAGE MOTO_PYTHON ESBUILD WALLET_CHECKOUT PREVIOUS_CELLD
The inspection Worker has synthetic storage access and runs only on loopback.
"""

from concurrent.futures import ThreadPoolExecutor
from http.server import BaseHTTPRequestHandler, HTTPServer
import importlib.util
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import time
from threading import Event
import urllib.error
import urllib.parse
import urllib.request

spec = importlib.util.spec_from_file_location(
    "wallet_harness", Path(__file__).with_name("packaged-wallet.e2e.py")
)
harness = importlib.util.module_from_spec(spec)
spec.loader.exec_module(harness)


class ReplayGate(BaseHTTPRequestHandler):
    def do_GET(self):
        self.server.admitted.set()
        released = self.server.release.wait(timeout=10)
        self.send_response(200 if released else 504)
        self.send_header("Content-Length", "0")
        self.end_headers()

    def log_message(self, format, *args):
        pass


def held_replay(address, replay, gate):
    request = urllib.request.Request(
        address + "/held-signing-replay?" + urllib.parse.urlencode({"gate": gate}),
        data=json.dumps(replay["signed"]["finalizeRequest"]).encode(),
        headers={
            "content-type": "application/json",
            "x-router-ab-internal-service-auth": "private-d1-gateway-router-auth",
            "x-seams-wallet-home-region": "US",
            "x-seams-wallet-object-addresses": json.dumps(replay["addresses"]),
        },
    )
    with urllib.request.urlopen(request, timeout=15) as response:
        body = json.load(response)
        assert body == replay["signed"]["response"], "Shutdown changed the stored signing reply"
        return {"status": response.status, "storedReplyPreserved": True}


def stop_runtime(process, directory, address):
    admission_probe = urllib.request.Request(address + "/addresses", data=b"{}")
    with urllib.request.urlopen(admission_probe, timeout=2) as response:
        assert response.status == 200
    replay = json.loads((directory / "signing-replay.json").read_text())
    with HTTPServer(("127.0.0.1", 0), ReplayGate) as gate, ThreadPoolExecutor(max_workers=2) as executor:
        gate.timeout = 10
        gate.admitted = Event()
        gate.release = Event()
        gate_request = executor.submit(gate.handle_request)
        pending = executor.submit(
            held_replay, address, replay, "http://127.0.0.1:" + str(gate.server_port)
        )
        try:
            assert gate.admitted.wait(timeout=10), "Signing replay did not reach the gate"
            assert not pending.done(), "Replay must remain in flight before shutdown"
            started = time.monotonic()
            process.terminate()
            while time.monotonic() - started < 5:
                try:
                    with urllib.request.urlopen(admission_probe, timeout=1):
                        pass
                except urllib.error.HTTPError as error:
                    assert error.code == 503
                    assert json.load(error) == {"ok": False, "draining": True}
                    break
                time.sleep(0.05)
            else:
                raise AssertionError("Shutdown did not close public admission")
            assert not pending.done(), "Replay must remain in flight when admission closes"
            gate.release.set()
            reply = pending.result(timeout=15)
            gate_request.result(timeout=1)
            code = process.wait(timeout=max(1, 45 - (time.monotonic() - started)))
            assert code == 0, f"Runtime shutdown exited with {code}"
            return {
                "exitCode": code,
                "elapsedMs": round((time.monotonic() - started) * 1000),
                "freshApplicationRequest": {"status": 503, "draining": True},
                "admittedSigningReplay": reply,
            }
        finally:
            gate.release.set()


def main():
    if len(sys.argv) != 7:
        raise SystemExit(__doc__)
    binary, package, python, esbuild, checkout, previous = [
        Path(value).absolute() for value in sys.argv[1:]
    ]
    package = package.resolve()
    repository = Path(__file__).resolve().parents[3]
    directory = Path(tempfile.mkdtemp(
        prefix="celld-tenant-root-restore-", dir=repository / ".artifacts"
    ))
    directory.chmod(0o700)
    boundary = Path(__file__).with_name("tenant-root-restore.mjs")
    setup = Path(__file__).with_name("prepare-wallet.mjs")
    scenario = checkout / "crates/router-ab-cloudflare/scripts/test-private-d1.mjs"
    sources = (Path(__file__), boundary, setup, Path(harness.__file__), scenario)
    for source in sources:
        shutil.copyfile(source, directory / source.name)
    address = "http://127.0.0.1:" + str(harness.free_port())
    endpoint = "http://127.0.0.1:" + str(harness.free_port())
    environment = {
        "PATH": os.environ["PATH"],
        "HOME": os.environ["HOME"],
        "TMPDIR": os.environ.get("TMPDIR", "/tmp"),
        "SEAMS_LOCAL_PORT_OFFSET": str(int(address.rsplit(":", 1)[1]) - 4100),
        "AWS_ACCESS_KEY_ID": "local-test",
        "AWS_SECRET_ACCESS_KEY": "local-test-secret",
        "AWS_DEFAULT_REGION": "us-east-1",
        "AWS_ENDPOINT_URL": endpoint,
        "S3_ENDPOINT": endpoint,
        "AWS_EC2_METADATA_DISABLED": "true",
        "AWS_PAGER": "",
        "CELLD_ESBUILD": str(esbuild),
        "CELLD_DEPLOY_POLL_S": "1",
        "RUST_LOG": "warn",
        "ROUTER_AB_WORKER_BUILD_PROFILE": "release",
        "NODE_PATH": str(repository / "node_modules"),
    }
    result = {
        "status": "running",
        "stage": "prepare",
        "scope": (
            "one missing tenant-root role share, dual-authorized restore, forward "
            "refresh, retirement and replay after an offline runtime upgrade and "
            "restart, admitted stored-signature replay during shutdown, incompatible "
            "downgrade refusal and consumed-presign refusal; "
            "one runtime node and synthetic S3"
        ),
        "previousRuntimeSha256": harness.sha256(previous),
        "runtimeSha256": harness.sha256(binary),
        "packageSha256": harness.directory_sha256(package),
        "manifestSha256": harness.sha256(package / "artifact-manifest.json"),
        "publicRevision": subprocess.check_output(
            ["git", "rev-parse", "HEAD"], cwd=checkout, text=True
        ).strip(),
        "sourceHashes": {source.name: harness.sha256(source) for source in sources},
    }
    processes = []
    print(directory, flush=True)
    try:
        harness.run(
            ["node", setup, package, directory, address,
             "http://localhost:4201", "http://localhost:4202"],
            directory, environment, "prepare.log",
        )
        prepared = json.loads((directory / "prepared.json").read_text())
        manifest, configs, mapping = harness.prepare(package, directory, prepared)
        result["package"] = manifest["package"]
        harness.run(
            ["node", boundary, "prepare", directory, checkout, address],
            directory, environment, "prepare-restore.log", timeout=240,
        )
        environment["CELLD_R2_BUCKETS"] = json.dumps(mapping)
        emulator = harness.start(
            [python, "-m", "moto.server", "-H", "127.0.0.1",
             "-p", endpoint.rsplit(":", 1)[1]],
            directory, environment, "moto.log", processes,
        )
        harness.wait_for_http(endpoint, emulator)
        for bucket in ("fleet-test", "backup-deriver-a", "backup-deriver-b"):
            harness.run(
                ["aws", "s3api", "create-bucket", "--bucket", bucket],
                directory, environment, "create-" + bucket + ".log",
            )
        result["stage"] = "deploy"
        for role in [*configs, "restore-observer"]:
            harness.run(
                [previous, "deploy", role + ".json", "--bucket", "fleet-test"],
                directory, environment, "deploy-" + role + ".log",
            )
        command = [
            previous, "--no-control-plane", "--bucket", "fleet-test",
            "--listen", address.removeprefix("http://"),
            "--internal-listen", "127.0.0.1:0",
        ]
        node = harness.start(command, directory, environment, "node.log", processes)
        harness.wait_for_http(address + "/router", node)
        for role, config in configs.items():
            for database in config.get("d1_databases", []):
                harness.run(
                    [previous, "d1", "migrations", "apply", database["database_name"],
                     role + ".json", "--bucket", "fleet-test"],
                    directory, environment, "migrate-" + role + ".log",
                )
        result["stage"] = "restore-refresh-retirement"
        harness.run(
            ["node", boundary, "run", directory, checkout, address],
            directory, environment, "restore.log", timeout=240,
        )
        result["scenario"] = json.loads((directory / "restore-result.json").read_text())
        result["stage"] = "offline-upgrade"
        result["shutdownBeforeUpgrade"] = stop_runtime(node, directory, address)
        processes.remove(node)
        result["previousRuntimeExitCode"] = node.returncode
        result["oldRuntimeStoppedBeforeDeployment"] = node.returncode is not None
        assert result["oldRuntimeStoppedBeforeDeployment"]
        for role in [*configs, "restore-observer"]:
            harness.run(
                [binary, "deploy", role + ".json", "--bucket", "fleet-test"],
                directory, environment, "upgrade-deploy-" + role + ".log",
            )
        command[0] = binary
        for checkpoint in ("upgrade", "restart"):
            result["stage"] = checkpoint
            node = harness.start(
                command, directory, environment, "node-" + checkpoint + ".log", processes
            )
            harness.wait_for_http(address + "/router", node)
            harness.run(
                ["node", boundary, "verify-state", directory, checkout, address],
                directory, environment, checkpoint + ".log",
            )
            result[checkpoint] = json.loads((directory / "state-result.json").read_text())
            result[checkpoint]["shutdown"] = stop_runtime(node, directory, address)
            processes.remove(node)
            if checkpoint == "upgrade":
                result["stage"] = "incompatible-downgrade-refusal"
                refusal = subprocess.run(
                    [previous, *command[1:]], cwd=directory, env=environment,
                    capture_output=True, text=True, timeout=15,
                )
                refusal_log = refusal.stdout + refusal.stderr
                (directory / "runtime-downgrade.log").write_text(refusal_log)
                assert refusal.returncode == 1, refusal_log
                assert "peer-durable-websockets-v1" in refusal_log
                assert "celld listening on" not in refusal_log
                result["incompatibleDowngrade"] = {
                    "exitCode": refusal.returncode,
                    "requiredFeature": "peer-durable-websockets-v1",
                    "servingAnnouncementObserved": False,
                }
        assert result["packageSha256"] == harness.directory_sha256(package), (
            "Package changed during the run"
        )
        for source in sources:
            assert result["sourceHashes"][source.name] == harness.sha256(source), (
                "Harness changed during the run"
            )
        result["status"] = "passed"
    except Exception as error:
        result["status"] = "failed"
        result["error"] = repr(error)
        raise
    finally:
        cleanup_errors = []
        for process in reversed(processes):
            try:
                harness.stop(process)
            except Exception as error:
                cleanup_errors.append(repr(error))
        result["cleanupErrors"] = cleanup_errors
        if cleanup_errors:
            result["status"] = "failed"
        harness.write_json(directory / "result.json", result)
        if cleanup_errors:
            raise RuntimeError(cleanup_errors)


if __name__ == "__main__":
    main()
