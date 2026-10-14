"""Run shared tenant-root restore, refresh and retirement assertions on celld.

Usage: python3 tenant-root-restore.e2e.py CELLD WALLET_PACKAGE MOTO_PYTHON ESBUILD WALLET_CHECKOUT PREVIOUS_CELLD
The inspection Worker has synthetic storage access and runs only on loopback.
"""

import importlib.util
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile

spec = importlib.util.spec_from_file_location(
    "wallet_harness", Path(__file__).with_name("packaged-wallet.e2e.py")
)
harness = importlib.util.module_from_spec(spec)
spec.loader.exec_module(harness)


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
            "refresh, retirement and replay after a drained runtime upgrade and "
            "restart; one runtime node and synthetic S3"
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
        result["stage"] = "drained-upgrade"
        harness.stop(node)
        processes.remove(node)
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
            harness.stop(node)
            processes.remove(node)
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
