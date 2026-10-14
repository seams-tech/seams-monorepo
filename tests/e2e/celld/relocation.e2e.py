"""Run the existing mixed relocation scenario with celld custody Workers.

Usage: python3 relocation.e2e.py CELLD MOTO_PYTHON WALLET_CHECKOUT WALLET_PACKAGE
Directory storage and browser composition remain in the workerd/Node harness.
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
    "harness", Path(__file__).with_name("packaged-wallet.e2e.py")
)
harness = importlib.util.module_from_spec(spec)
spec.loader.exec_module(harness)


def revision(directory):
    return subprocess.check_output(
        ["git", "rev-parse", "HEAD"], cwd=directory, text=True
    ).strip()


def source_files(repo, checkout):
    private = [
        Path(__file__),
        Path(harness.__file__),
        Path(__file__).with_name("relocation-topology.mjs"),
        Path(__file__).with_name("relocation-inspector.mjs"),
        repo / "deployment/celld/render.mjs",
        repo / "tests/e2e/relocation-custody.e2e.mjs",
        repo / "tests/helpers/presign-alarm-observer.mjs",
        *sorted((repo / "tests/helpers").glob("relocation-*.mjs")),
    ]
    public = sorted((checkout / "crates/router-ab-cloudflare/scripts").glob("*.mjs"))
    files = {}
    for prefix, directory, sources in (
        ("private", repo, private), ("public", checkout, public)
    ):
        for source in sources:
            files[prefix + "/" + source.relative_to(directory).as_posix()] = source
    return files


def input_trees(repo, checkout):
    # The composed handlers compile these inputs during the scenario.
    trees = {}
    for prefix, directory, names in (
        ("private", repo, (
            "packages/console-server-ts/src", "packages/console-server-ts/dist",
            "packages/wallet-console-server-ts/src", "tests/helpers",
        )),
        ("public", checkout, (
            "packages/wallet-server/src", "packages/wallet-server/migrations",
            "packages/shared-ts/src", "packages/wallet/src",
            "tests/unit/helpers", "tests/e2e", "wasm/router_ab_ecdsa_client/pkg",
            "crates/router-ab-dev", "crates/router-ab-cloudflare/migrations",
        )),
    ):
        for name in names:
            trees[prefix + "/" + name] = directory / name
    return trees


def generated_hashes(root, checkout):
    files = {}
    for file in root.rglob("*"):
        if not file.is_file() or file.suffix not in {".json", ".js", ".mjs", ".wasm"}:
            continue
        if "sources" not in file.relative_to(root).parts:
            files[file.relative_to(root).as_posix()] = harness.sha256(file)
    for relative in (
        ".artifacts/relocation-destination-workers", ".artifacts/r155b"
    ):
        for file in sorted((checkout / relative).glob("*.mjs")):
            name = "public/" + file.relative_to(checkout).as_posix()
            files[name] = harness.sha256(file)
            copy = root / "sources" / name
            copy.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(file, copy)
    return files


def main():
    if len(sys.argv) != 5:
        raise SystemExit(__doc__)
    binary, python, checkout, package = [Path(value).absolute() for value in sys.argv[1:]]
    repo = Path(__file__).resolve().parents[3]
    root = Path(tempfile.mkdtemp(prefix="celld-relocation-", dir=repo / ".artifacts"))
    root.chmod(0o700)
    endpoint = "http://127.0.0.1:" + str(harness.free_port())
    environment = {
        "PATH": os.environ["PATH"],
        "HOME": os.environ["HOME"],
        "TMPDIR": os.environ.get("TMPDIR", "/tmp"),
        "AWS_ACCESS_KEY_ID": "local-test",
        "AWS_SECRET_ACCESS_KEY": "local-test-secret",
        "AWS_DEFAULT_REGION": "us-east-1",
        "AWS_ENDPOINT_URL": endpoint,
        "S3_ENDPOINT": endpoint,
        "AWS_EC2_METADATA_DISABLED": "true",
        "AWS_PAGER": "",
        "CELLD_ESBUILD": str(repo / "node_modules/.bin/esbuild"),
        "CELLD_DEPLOY_POLL_S": "1",
        "CELLD_RELOCATION_DIRECTORY": str(root),
        "CELLD_RELOCATION_BINARY": str(binary),
        "CELLD_RELOCATION_ADDRESS": "http://127.0.0.1:" + str(harness.free_port()),
        "CELLD_RELOCATION_OPERATOR": "http://127.0.0.1:" + str(harness.free_port()),
        "SEAMS_RELOCATION_OUTPUT": str(root / "proofs"),
        "SEAMS_WALLET_SERVER_CANDIDATE": str(checkout / "packages/wallet-server"),
        "ROUTER_AB_WORKER_BUILD_PROFILE": "release",
        "RUST_LOG": "warn",
    }
    manifest = json.loads((package / "artifact-manifest.json").read_text())
    checked = []
    for worker in manifest["workers"].values():
        for item in worker["files"]:
            source = checkout / "crates/router-ab-cloudflare" / item["path"].removeprefix(
                "cloudflare-router-ab/"
            )
            assert harness.sha256(source) == item["sha256"] == harness.sha256(package / item["path"])
            checked.append(item["path"])
    sources = source_files(repo, checkout)
    hashes = {name: harness.sha256(source) for name, source in sources.items()}
    trees = input_trees(repo, checkout)
    tree_hashes = {name: harness.directory_sha256(tree) for name, tree in trees.items()}
    for name, source in sources.items():
        copy = root / "sources" / name
        copy.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(source, copy)
    result = {
        "status": "running",
        "scope": (
            "Generation 1 to 2 mixed relocation with one celld node and synthetic S3. "
            "Custody Workers, regional D1 and R2 run on celld. Directory storage uses "
            "Miniflare. Directory/Runtime handlers run in Node. Destination exports "
            "use distinct class aliases. No hosted deployment or latency claim."
        ),
        "runtimeSha256": harness.sha256(binary),
        "manifestSha256": harness.sha256(package / "artifact-manifest.json"),
        "publicRevision": revision(checkout),
        "privateRevision": revision(repo),
        "matchedWorkerFiles": checked,
        "sourceHashes": hashes,
        "inputTreeHashes": tree_hashes,
    }
    processes = []
    print(root, flush=True)
    try:
        emulator = harness.start(
            [python, "-m", "moto.server", "-H", "127.0.0.1", "-p", endpoint.rsplit(":", 1)[1]],
            root, environment, "moto.log", processes,
        )
        harness.wait_for_http(endpoint, emulator)
        for bucket in ("fleet-test", "backup-deriver-a", "backup-deriver-b"):
            harness.run(
                ["aws", "s3api", "create-bucket", "--bucket", bucket],
                root, environment, "create-" + bucket + ".log",
            )
        harness.run(
            ["node", repo / "tests/e2e/relocation-custody.e2e.mjs", "--with-ecdsa"],
            repo, environment, str(root / "scenario.log"), timeout=1200,
        )
        assert (root / "proofs/custody-topology.json").is_file()
        runtime_stop = json.loads((root / "runtime-stop.json").read_text())
        assert runtime_stop["exitCode"] == 0 and runtime_stop["signal"] is None, runtime_stop
        result["runtimeStop"] = runtime_stop
        for name, source in sources.items():
            assert hashes[name] == harness.sha256(source), name
        for name, tree in trees.items():
            assert tree_hashes[name] == harness.directory_sha256(tree), name
        result["generatedHashes"] = generated_hashes(root, checkout)
        result["status"] = "passed"
    except Exception as error:
        result["status"] = "failed"
        result["error"] = repr(error)
        raise
    finally:
        errors = []
        for process in reversed(processes):
            try:
                harness.stop(process)
            except Exception as error:
                errors.append(repr(error))
        result["cleanupErrors"] = errors
        if errors:
            result["status"] = "failed"
        harness.write_json(root / "result.json", result)
    assert result["status"] == "passed", result.get("cleanupErrors")


if __name__ == "__main__":
    main()
