"""Load the released Wallet role graph with celld and verify request rejection.

Usage: python3 packaged-role-graph.py CELLD WALLET_PACKAGE MOTO_PYTHON ESBUILD
Requires Python 3.11+, AWS CLI, and Moto 5.1.14 in the supplied environment.
This checks module loading and dispatch. It does not test wallet lifecycle parity.
"""

import hashlib
import json
import os
from pathlib import Path
import shutil
import signal
import socket
import subprocess
import sys
import tempfile
import time
import tomllib
import urllib.error
import urllib.request

ROLES = {"router", "deriver-a", "deriver-b", "signing-worker", "tenant-root-control-plane"}
CONFIG_KEYS = (
    "name", "compatibility_date", "vars", "durable_objects", "migrations",
    "services", "d1_databases", "r2_buckets",
)
OBSERVER = """export default {
  async fetch(request, env) {
    const role = new URL(request.url).pathname.slice(1);
    return env[role].fetch('http://role/__capability_missing_route');
  }
};
"""


def sha256(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def free_port():
    with socket.socket() as listener:
        listener.bind(("127.0.0.1", 0))
        return listener.getsockname()[1]


def write_json(path, value):
    path.write_text(json.dumps(value, indent=2) + "\n")


def run(args, directory, environment, log_name):
    with (directory / log_name).open("w") as log:
        subprocess.run(
            args, cwd=directory, env=environment, stdout=log,
            stderr=subprocess.STDOUT, check=True, timeout=90,
        )


def start(args, directory, environment, log_name, processes):
    with (directory / log_name).open("w") as log:
        process = subprocess.Popen(
            args, cwd=directory, env=environment, stdout=log,
            stderr=subprocess.STDOUT, start_new_session=True,
        )
    processes.append(process)
    return process


def wait_for_http(url, process):
    for _ in range(100):
        if process.poll() is not None:
            raise RuntimeError("process exited before listening; inspect node.log")
        try:
            with urllib.request.urlopen(url, timeout=0.3):
                return
        except urllib.error.HTTPError:
            return
        except (OSError, TimeoutError):
            time.sleep(0.1)
    raise RuntimeError("listener readiness timed out")


def response(url):
    try:
        with urllib.request.urlopen(url, timeout=15) as reply:
            return {"status": reply.status, "body": reply.read().decode()}
    except urllib.error.HTTPError as error:
        return {"status": error.code, "body": error.read().decode()}


def stop(process):
    if process.poll() is not None:
        return
    os.killpg(process.pid, signal.SIGTERM)
    try:
        process.wait(timeout=8)
    except subprocess.TimeoutExpired:
        os.killpg(process.pid, signal.SIGKILL)
        process.wait()


def prepare(package, directory):
    manifest = json.loads((package / "artifact-manifest.json").read_text())
    assert manifest["schemaVersion"] == "seams_wallet_server_artifact_manifest_v1"
    assert manifest["package"]["name"] == "@seams/wallet-server"
    assert set(manifest["workers"]) == ROLES
    configs = {}
    mapping = {}
    for role, worker in manifest["workers"].items():
        for artifact in worker["files"]:
            source = (package / artifact["path"]).resolve()
            destination = (directory / artifact["path"]).resolve()
            assert source.is_relative_to(package)
            assert destination.is_relative_to(directory)
            assert source.stat().st_size == artifact["bytes"]
            assert sha256(source) == artifact["sha256"]
            destination.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(source, destination)
        manifest_path = package / "cloudflare-router-ab" / f"wrangler.{role}.toml"
        source_config = tomllib.loads(manifest_path.read_text())
        config = {}
        for key in CONFIG_KEYS:
            if key in source_config:
                config[key] = source_config[key]
        config["main"] = worker["entry"]
        # The packaged entry is a shim that imports another JS module.
        config["no_bundle"] = False
        config.setdefault("vars", {})["ROUTER_AB_INTERNAL_SERVICE_AUTH_SECRET"] = "synthetic-graph-test-secret"
        for database in config.get("d1_databases", []):
            database.pop("migrations_dir", None)
        for bucket in config.get("r2_buckets", []):
            mapping[bucket["bucket_name"]] = f"s3://backup-{role}"
        configs[role] = config
        write_json(directory / f"{role}.json", config)
    return manifest, configs, mapping


def main():
    if len(sys.argv) != 5:
        raise SystemExit(__doc__)
    binary, package, python, esbuild = [Path(value).absolute() for value in sys.argv[1:]]
    package = package.resolve()
    repository = Path(__file__).resolve().parents[3]
    artifacts = repository / ".artifacts"
    artifacts.mkdir(exist_ok=True)
    directory = Path(tempfile.mkdtemp(prefix="celld-role-graph-", dir=artifacts))
    endpoint = f"http://127.0.0.1:{free_port()}"
    environment = {
        "PATH": os.environ["PATH"], "HOME": os.environ["HOME"],
        "TMPDIR": os.environ.get("TMPDIR", "/tmp"),
        "AWS_ACCESS_KEY_ID": "local-test", "AWS_SECRET_ACCESS_KEY": "local-test-secret",
        "AWS_DEFAULT_REGION": "us-east-1", "AWS_ENDPOINT_URL": endpoint,
        "AWS_EC2_METADATA_DISABLED": "true", "AWS_PAGER": "",
        "RUST_LOG": "error", "CELLD_ESBUILD": str(esbuild),
    }
    result = {
        "status": "running", "stage": "artifact-verification", "responses": {},
        "runtimeSha256": sha256(binary), "harnessSha256": sha256(Path(__file__)),
        "sourceCommit": subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=repository, text=True).strip(),
        "scope": "packaged role graph loading and unauthenticated request rejection only",
    }
    processes = []
    try:
        result["runtime"] = subprocess.check_output([binary, "--version"], env=environment, text=True).strip()
        result["esbuild"] = subprocess.check_output([esbuild, "--version"], text=True).strip()
        result["moto"] = subprocess.check_output([
            python, "-c", 'import importlib.metadata; print(importlib.metadata.version("moto"))',
        ], text=True).strip()
        assert result["moto"] == "5.1.14"
        manifest, configs, mapping = prepare(package, directory)
        result["package"] = manifest["package"]
        result["manifestSha256"] = sha256(package / "artifact-manifest.json")
        result["fingerprints"] = {}
        for role, worker in manifest["workers"].items():
            result["fingerprints"][role] = worker["fingerprint"]
        environment["CELLD_R2_BUCKETS"] = json.dumps(mapping)
        result["stage"] = "object-store"
        emulator = start([
            python, "-m", "moto.server", "-H", "127.0.0.1", "-p", endpoint.rsplit(":", 1)[1],
        ], directory, environment, "moto.log", processes)
        wait_for_http(endpoint, emulator)
        for bucket in ("fleet-test", "backup-deriver-a", "backup-deriver-b"):
            run(["aws", "s3api", "create-bucket", "--bucket", bucket], directory, environment, f"create-{bucket}.log")
        result["stage"] = "deploy-packaged-workers"
        for role in configs:
            run([binary, "deploy", f"{role}.json", "--bucket", "fleet-test"], directory, environment, f"deploy-{role}.log")
        (directory / "observer.mjs").write_text(OBSERVER)
        services = []
        for role, config in configs.items():
            services.append({"binding": role.upper().replace("-", "_"), "service": config["name"]})
        write_json(directory / "observer.json", {
            "name": "observer", "main": "observer.mjs", "no_bundle": True,
            "compatibility_date": "2026-06-12", "services": services,
        })
        run([binary, "deploy", "observer.json", "--bucket", "fleet-test"], directory, environment, "deploy-observer.log")
        result["stage"] = "load-complete-graph"
        address = f"http://127.0.0.1:{free_port()}"
        node = start([
            binary, "--no-control-plane", "--bucket", "fleet-test", "--listen",
            address.removeprefix("http://"), "--internal-listen", "127.0.0.1:0",
        ], directory, environment, "node.log", processes)
        wait_for_http(address + "/ROUTER", node)
        for role in configs:
            reply = response(address + "/" + role.upper().replace("-", "_"))
            result["responses"][role] = reply
            expected_status = 405 if role == "router" else 403
            assert reply["status"] == expected_status, (role, reply)
            if role != "router":
                assert "missing valid service auth" in reply["body"], (role, reply)
        result["status"] = "passed"
    except Exception as error:
        result["status"] = "failed"
        result["error"] = str(error)
    finally:
        for process in reversed(processes):
            stop(process)
        result["cleanup"] = "runtime and temporary emulator stopped; evidence retained"
        write_json(directory / "result.json", result)
        print(f"Role graph {result['status']}: {directory}")
    return 0 if result["status"] == "passed" else 1


if __name__ == "__main__":
    raise SystemExit(main())
