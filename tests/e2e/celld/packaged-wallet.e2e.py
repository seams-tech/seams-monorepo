"""Run released Wallet Workers through provisioning, crash replay, and browser signing.

Usage: python3 packaged-wallet.e2e.py CELLD WALLET_PACKAGE MOTO_PYTHON ESBUILD PREVIOUS_CELLD WALLET_CHECKOUT WALLET_SDK_PACKAGE
Requires Python 3.11+, AWS CLI, and Moto 5.1.14 in the supplied environment.
Uses the unchanged public mixed-wallet registration and signing contract.
Full lifecycle and distributed parity remain unverified.
"""

import hashlib
import json
import os
import re
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

ROLES = {
    "router",
    "deriver-a",
    "deriver-b",
    "signing-worker",
    "tenant-root-control-plane",
}
BROWSER_FILES = (
    "passkey.registration.contract.test.ts",
    "passkey.presign-pool.contract.test.ts",
    "passkey.unlock.contract.test.ts",
    "passkey.recovery.contract.test.ts",
    "passkey.device-linking.contract.test.ts",
)
BROWSER_CONTRACTS = (
    "EVM registration and signatures complete while NEAR execution is held",
    "concurrent prepare and admitted ECDSA finalize lost_response retry preserve one signing effect",
    "distinct concurrent prepares consume the last quota use once and preserve the winning claim",
    "exact finalize retry at the Router returns the SigningWorker stored signature",
    "passkey unlock restores immediate export and shared-budget signing",
    "a committed Passkey recovery survives a lost finalization response and runtime reset",
    "lock retains durable presignatures across a fresh unlock",
    "a cross-tab lock prevents delayed restoration from recreating its credential",
    "a fresh unlock survives a delayed restoration response from another tab",
    "sustained Tempo and Arc signing uses fresh presignatures beyond pool capacity",
    "a fresh browser recovers a Passkey-founded wallet with one code, signs, and refuses reuse",
    "a recovery retires the replaced activation: a delayed finalize is refused, a made signature answers, and the recovered wallet signs",
    "a superseded recovery attempt that reaches the SigningWorker late is refused, and the current attempt signs",
    "a linked device links a third device on an ECDSA-only wallet, which signs Tempo",
    "a linked device links a third device, which signs NEAR and Tempo and exports both keys",
    "a linked device revoked with an email code across a refused commit is answered from what committed",
)
CONFIG_KEYS = (
    "name",
    "compatibility_date",
    "vars",
    "durable_objects",
    "migrations",
    "services",
    "d1_databases",
    "r2_buckets",
)
OBSERVER = """export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const role = url.pathname.split('/')[1];
    url.pathname = url.pathname.slice(role.length + 1) || '/__capability_missing_route';
    return env[role].fetch(new Request(url, request));
  }
};
"""


def sha256(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def directory_sha256(directory):
    digest = hashlib.sha256()
    for file in sorted(directory.rglob("*")):
        if file.is_file():
            digest.update(file.relative_to(directory).as_posix().encode())
            digest.update(b"\0")
            digest.update(bytes.fromhex(sha256(file)))
    return digest.hexdigest()


def freeze_packages(package, sdk_package, directory):
    inputs = directory / "inputs"
    inputs.mkdir()
    (directory / "node_modules").symlink_to(
        package.parents[1], target_is_directory=True
    )
    hashes = {}
    copies = []
    for name, source in (("wallet-server", package), ("wallet", sdk_package)):
        before = directory_sha256(source)
        destination = inputs / name
        shutil.copytree(source, destination)
        assert directory_sha256(source) == before == directory_sha256(destination)
        hashes[name] = before
        copies.append(destination)
    return copies[0], copies[1], hashes


def browser_outcomes(suites):
    outcomes = []
    for suite in suites:
        outcomes.extend(browser_outcomes(suite.get("suites", [])))
        for spec in suite.get("specs", []):
            for test in spec["tests"]:
                outcomes.append(
                    {
                        "title": spec["title"],
                        "expectedStatus": test["expectedStatus"],
                        "results": [result["status"] for result in test["results"]],
                    }
                )
    return outcomes


def verify_browser_report(path):
    report = json.loads(path.read_text())
    outcomes = browser_outcomes(report["suites"])
    assert sorted(outcome["title"] for outcome in outcomes) == sorted(BROWSER_CONTRACTS)
    for outcome in outcomes:
        assert outcome["expectedStatus"] == "passed", outcome
        assert outcome["results"] == ["passed"], outcome
    assert report["stats"]["skipped"] == 0
    assert report["stats"]["unexpected"] == 0
    return outcomes


def free_port():
    while True:
        with socket.socket() as listener:
            listener.bind(("127.0.0.1", 0))
            port = listener.getsockname()[1]
            if 4100 <= port <= 65529:
                return port


def write_json(path, value):
    path.write_text(json.dumps(value, indent=2) + "\n")


def run(args, directory, environment, log_name, timeout=90):
    with (directory / log_name).open("w") as log:
        with subprocess.Popen(
            args,
            cwd=directory,
            env=environment,
            stdout=log,
            stderr=subprocess.STDOUT,
            start_new_session=True,
        ) as process:
            try:
                code = process.wait(timeout=timeout)
            except subprocess.TimeoutExpired:
                stop(process)
                raise
            if code != 0:
                raise subprocess.CalledProcessError(code, args)


def start(args, directory, environment, log_name, processes):
    with (directory / log_name).open("w") as log:
        process = subprocess.Popen(
            args,
            cwd=directory,
            env=environment,
            stdout=log,
            stderr=subprocess.STDOUT,
            start_new_session=True,
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
    try:
        os.killpg(process.pid, signal.SIGTERM)
    except ProcessLookupError:
        process.wait()
        return
    deadline = time.monotonic() + 8
    while time.monotonic() < deadline:
        process.poll()
        try:
            os.killpg(process.pid, 0)
        except ProcessLookupError:
            break
        time.sleep(0.1)
    else:
        try:
            os.killpg(process.pid, signal.SIGKILL)
        except ProcessLookupError:
            pass
    process.wait()


def prepare(package, directory, prepared):
    manifest = json.loads((package / "artifact-manifest.json").read_text())
    assert manifest["schemaVersion"] == "seams_wallet_server_artifact_manifest_v1"
    assert manifest["package"]["name"] == "@seams/wallet-server"
    assert set(manifest["workers"]) == ROLES
    configs = {}
    mapping = {}
    role_configs = {}
    for role_config in prepared["configs"]:
        role_configs[role_config["role"]] = role_config
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
        manifest_path = Path(role_configs[role]["configPath"])
        source_config = tomllib.loads(manifest_path.read_text())
        config = {}
        for key in CONFIG_KEYS:
            if key in source_config:
                config[key] = source_config[key]
        config["main"] = worker["entry"]
        # The packaged entry is a shim that imports another JS module.
        config["no_bundle"] = False
        config.setdefault("vars", {}).update(role_configs[role]["secrets"])
        for database in config.get("d1_databases", []):
            migration = (manifest_path.parent / database["migrations_dir"]).resolve()
            relative_migration = f"migrations/{role}"
            shutil.copytree(migration, directory / relative_migration)
            database["migrations_dir"] = relative_migration
        for bucket in config.get("r2_buckets", []):
            mapping[bucket["bucket_name"]] = f"s3://backup-{role}"
        configs[role] = config
        write_json(directory / f"{role}.json", config)
        (directory / f"{role}.json").chmod(0o600)
    return manifest, configs, mapping


def main():
    if len(sys.argv) != 8:
        raise SystemExit(__doc__)
    binary, package, python, esbuild, previous, wallet_checkout, sdk_package = [
        Path(value).absolute() for value in sys.argv[1:]
    ]
    package = package.resolve()
    sdk_package = sdk_package.resolve()
    sdk_metadata = json.loads((sdk_package / "package.json").read_text())
    assert sdk_metadata["name"] == "@seams/wallet"
    repository = Path(__file__).resolve().parents[3]
    artifacts = repository / ".artifacts"
    artifacts.mkdir(exist_ok=True)
    directory = Path(tempfile.mkdtemp(prefix="celld-wallet-", dir=artifacts))
    package, sdk_package, input_hashes = freeze_packages(
        package, sdk_package, directory
    )
    endpoint = f"http://127.0.0.1:{free_port()}"
    gateway_port = free_port()
    address = f"http://127.0.0.1:{gateway_port}"
    app_origin = f"http://localhost:{free_port()}"
    wallet_origin = f"http://localhost:{free_port()}"
    environment = {
        "PATH": os.environ["PATH"],
        "GOOGLE_OIDC_CLIENT_ID": os.environ["GOOGLE_OIDC_CLIENT_ID"],
        "SEAMS_LOCAL_PORT_OFFSET": str(gateway_port - 4100),
        "SEAMS_INTENDED_GOOGLE_CLIENT_ID": os.environ["GOOGLE_OIDC_CLIENT_ID"],
        "SEAMS_INTENDED_GOOGLE_ID_TOKEN": os.environ["SEAMS_INTENDED_GOOGLE_ID_TOKEN"],
        "HOME": os.environ["HOME"],
        "TMPDIR": os.environ.get("TMPDIR", "/tmp"),
        "AWS_ACCESS_KEY_ID": "local-test",
        "AWS_SECRET_ACCESS_KEY": "local-test-secret",
        "AWS_DEFAULT_REGION": "us-east-1",
        "AWS_ENDPOINT_URL": endpoint,
        "S3_ENDPOINT": endpoint,
        "AWS_EC2_METADATA_DISABLED": "true",
        "AWS_PAGER": "",
        "RUST_LOG": "error",
        "CELLD_ESBUILD": str(esbuild),
        "CELLD_DEPLOY_POLL_S": "1",
        "NODE_PATH": str(package.parents[1]),
    }
    result = {
        "status": "running",
        "stage": "artifact-verification",
        "responses": {},
        "runtimeSha256": sha256(binary),
        "packageSnapshotHashes": input_hashes,
        "harnessSha256": sha256(Path(__file__)),
        "sourceCommit": subprocess.check_output(
            ["git", "rev-parse", "HEAD"], cwd=repository, text=True
        ).strip(),
        "scope": "packaged roles, tenant-root provisioning, crash replay, Gateway, and mixed-wallet browser signing",
    }
    processes = []
    try:
        result["runtime"] = subprocess.check_output(
            [binary, "--version"], env=environment, text=True
        ).strip()
        result["esbuild"] = subprocess.check_output(
            [esbuild, "--version"], text=True
        ).strip()
        result["moto"] = subprocess.check_output(
            [
                python,
                "-c",
                'import importlib.metadata; print(importlib.metadata.version("moto"))',
            ],
            text=True,
        ).strip()
        assert result["moto"] == "5.1.14"
        setup = Path(__file__).with_name("prepare-wallet.mjs")
        result["preparationSha256"] = sha256(setup)
        run(
            ["node", setup, package, directory, address, app_origin, wallet_origin],
            directory,
            environment,
            "prepare.log",
        )
        prepared = json.loads((directory / "prepared.json").read_text())
        manifest, configs, mapping = prepare(package, directory, prepared)
        assert manifest["package"]["version"] == sdk_metadata["version"]
        result["sdkPackage"] = sdk_metadata["version"]
        result["package"] = manifest["package"]
        result["manifestSha256"] = sha256(package / "artifact-manifest.json")
        result["fingerprints"] = {}
        for role, worker in manifest["workers"].items():
            result["fingerprints"][role] = worker["fingerprint"]
        environment["CELLD_R2_BUCKETS"] = json.dumps(mapping)
        result["stage"] = "object-store"
        emulator = start(
            [
                python,
                "-m",
                "moto.server",
                "-H",
                "127.0.0.1",
                "-p",
                endpoint.rsplit(":", 1)[1],
            ],
            directory,
            environment,
            "moto.log",
            processes,
        )
        wait_for_http(endpoint, emulator)
        for bucket in ("fleet-test", "backup-deriver-a", "backup-deriver-b"):
            run(
                ["aws", "s3api", "create-bucket", "--bucket", bucket],
                directory,
                environment,
                f"create-{bucket}.log",
            )
        result["stage"] = "deploy-packaged-workers"
        for role in configs:
            run(
                [binary, "deploy", f"{role}.json", "--bucket", "fleet-test"],
                directory,
                environment,
                f"deploy-{role}.log",
            )
        (directory / "observer.mjs").write_text(OBSERVER)
        services = []
        for role, config in configs.items():
            services.append(
                {"binding": role.upper().replace("-", "_"), "service": config["name"]}
            )
        write_json(
            directory / "observer.json",
            {
                "name": "observer",
                "main": "observer.mjs",
                "no_bundle": True,
                "compatibility_date": "2026-06-12",
                "services": services,
            },
        )
        run(
            [binary, "deploy", "observer.json", "--bucket", "fleet-test"],
            directory,
            environment,
            "deploy-observer.log",
        )
        result["stage"] = "load-complete-graph"
        node = start(
            [
                binary,
                "--no-control-plane",
                "--bucket",
                "fleet-test",
                "--listen",
                address.removeprefix("http://"),
                "--internal-listen",
                "127.0.0.1:0",
            ],
            directory,
            environment,
            "node.log",
            processes,
        )
        wait_for_http(address + "/ROUTER", node)
        for role in configs:
            reply = response(address + "/" + role.upper().replace("-", "_"))
            result["responses"][role] = reply
            expected_status = 405 if role == "router" else 403
            assert reply["status"] == expected_status, (role, reply)
            if role != "router":
                assert "missing valid service auth" in reply["body"], (role, reply)
        result["stage"] = "role-database-migrations"
        for role, config in configs.items():
            for database in config.get("d1_databases", []):
                run(
                    [
                        binary,
                        "d1",
                        "migrations",
                        "apply",
                        database["database_name"],
                        f"{role}.json",
                        "--bucket",
                        "fleet-test",
                    ],
                    directory,
                    environment,
                    f"migrate-{role}.log",
                )
        result["stage"] = "tenant-root-provisioning"
        bootstrap = (
            package / "cloudflare-router-ab/scripts/bootstrap-local-tenant-root.mjs"
        )
        grant_path = directory / "tenant-root-grant.json"
        bootstrap_args = [
            "node",
            bootstrap,
            "--root",
            directory,
            "--issuer-env-path",
            prepared["issuerPath"],
            "--grant-file",
            grant_path,
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
            address + "/ROUTER/",
        ]
        # The bootstrap helper uses an absolute route, so use an operator ingress
        # whose only service target is Router during this provisioning stage.
        router_ingress = {
            "name": "operator-router",
            "main": "operator-router.mjs",
            "no_bundle": True,
            "compatibility_date": "2026-06-12",
            "services": [{"binding": "ROUTER", "service": configs["router"]["name"]}],
        }
        (directory / "operator-router.mjs").write_text(
            "export default { fetch(request, env) { return env.ROUTER.fetch(request); } };\n"
        )
        write_json(directory / "operator-router.json", router_ingress)
        run(
            [binary, "deploy", "operator-router.json", "--bucket", "fleet-test"],
            directory,
            environment,
            "deploy-operator-router.log",
        )
        # A fresh node removes pointer-poll timing from the measurement.
        stop(node)
        node = start(
            [
                binary,
                "--no-control-plane",
                "--bucket",
                "fleet-test",
                "--listen",
                address.removeprefix("http://"),
                "--internal-listen",
                "127.0.0.1:0",
            ],
            directory,
            environment,
            "provision-node.log",
            processes,
        )
        wait_for_http(address, node)
        bootstrap_args[-1] = address
        run(bootstrap_args, directory, environment, "bootstrap-first.log")
        first = json.loads((directory / "bootstrap-first.log").read_text())
        assert first["kind"] == "wallet_local_tenant_root_ready_v1"
        result["stage"] = "tenant-root-replay-after-crash"
        os.killpg(node.pid, signal.SIGKILL)
        node.wait()
        node = start(
            [
                binary,
                "--no-control-plane",
                "--bucket",
                "fleet-test",
                "--listen",
                address.removeprefix("http://"),
                "--internal-listen",
                "127.0.0.1:0",
            ],
            directory,
            environment,
            "crash-restart-node.log",
            processes,
        )
        wait_for_http(address, node)
        replay_started = time.monotonic()
        replay_deadline = replay_started + 120
        result["takeoverRefusals"] = 0
        while True:
            attempt_path = (
                directory / f"bootstrap-replay-{result['takeoverRefusals']}.log"
            )
            with attempt_path.open("w") as log:
                attempt = subprocess.run(
                    bootstrap_args,
                    cwd=directory,
                    env=environment,
                    stdout=log,
                    stderr=subprocess.STDOUT,
                    timeout=90,
                )
            if attempt.returncode == 0:
                break
            failure = attempt_path.read_text()
            if (
                "owner_unreachable" not in failure
                or time.monotonic() >= replay_deadline
            ):
                raise RuntimeError(
                    "exact grant replay failed; inspect bootstrap-replay.log"
                )
            result["takeoverRefusals"] += 1
            time.sleep(1)
        shutil.copyfile(attempt_path, directory / "bootstrap-replay.log")
        replay = json.loads(attempt_path.read_text())
        assert replay["replayed"] is True
        for field in (
            "kind",
            "identityDigestB64u",
            "custodyLineageB64u",
            "revision",
            "rootCommitmentB64u",
        ):
            assert first[field] == replay[field], field
        result["takeoverSeconds"] = time.monotonic() - replay_started
        result["tenantRoot"] = first
        result["exactGrantReplay"] = "same-result-after-process-kill-and-fresh-node"
        result["stage"] = "gateway-load-and-migrations"
        gateway_setup = Path(__file__).with_name("prepare-gateway.mjs")
        result["gatewayPreparationSha256"] = sha256(gateway_setup)
        run(
            [
                "node",
                gateway_setup,
                package,
                directory,
                address,
                app_origin,
                wallet_origin,
            ],
            directory,
            environment,
            "gateway-prepare.log",
        )
        gateway_prepared = json.loads((directory / "gateway-prepared.json").read_text())
        gateway_source = tomllib.loads(Path(gateway_prepared["configPath"]).read_text())
        gateway_config = {}
        for key in CONFIG_KEYS + ("compatibility_flags", "triggers"):
            if key in gateway_source:
                gateway_config[key] = gateway_source[key]
        shutil.copytree(package / "dist", directory / "wallet-package/dist")
        shutil.copyfile(
            package / "package.json", directory / "wallet-package/package.json"
        )
        gateway_config["main"] = (
            "wallet-package/dist/esm/local-hosted-wallet-gateway-worker.js"
        )
        gateway_config["vars"].update(gateway_prepared["secrets"])
        for database in gateway_config["d1_databases"]:
            database.pop("preview_database_id", None)
            database["migrations_dir"] = "migrations/gateway"
        shutil.copytree(
            package / "migrations/d1-signer", directory / "migrations/gateway"
        )
        write_json(directory / "gateway.json", gateway_config)
        (directory / "gateway.json").chmod(0o600)
        result["gatewayEntrySha256"] = sha256(
            package / "dist/esm/local-hosted-wallet-gateway-worker.js"
        )
        run(
            [binary, "deploy", "gateway.json", "--bucket", "fleet-test"],
            directory,
            environment,
            "deploy-gateway.log",
        )
        wait_for_http(address + "/readyz", node)
        run(
            [
                binary,
                "d1",
                "migrations",
                "apply",
                gateway_config["d1_databases"][0]["database_name"],
                "gateway.json",
                "--bucket",
                "fleet-test",
            ],
            directory,
            environment,
            "migrate-gateway.log",
        )
        result["gatewayReady"] = response(address + "/readyz")
        assert result["gatewayReady"]["status"] == 200
        result["stage"] = "browser-wallet-contract"
        result["walletCheckout"] = subprocess.check_output(
            ["git", "rev-parse", "HEAD"], cwd=wallet_checkout, text=True
        ).strip()
        browser_environment = dict(environment)
        browser_environment.update(
            {
                "SEAMS_INTENDED_APP_URL": app_origin,
                "SEAMS_INTENDED_WALLET_HOST": "celld",
                "SEAMS_INTENDED_ROUTER_URL": address,
                "SEAMS_INTENDED_WALLET_ORIGIN": wallet_origin,
                "SEAMS_INTENDED_ROUTER_AB_ROOT": str(directory),
                "SEAMS_INTENDED_PROJECT_ENVIRONMENT_ID": "local-smoke-project:dev",
                "SEAMS_INTENDED_PUBLISHABLE_KEY": "pk_local",
                "VITE_RELAYER_URL": address,
                "VITE_ROUTER_AB_NORMAL_SIGNING_WORKER_ID": "local-signing-worker",
                "VITE_SEAMS_PROJECT_ENVIRONMENT_ID": "local-smoke-project:dev",
                "VITE_SEAMS_PUBLISHABLE_KEY": "pk_local",
                "VITE_SEAMS_WALLET_DIST_ROOT": str(sdk_package / "dist"),
                "VITE_SIGNING_SESSION_PERSISTENCE_MODE": "sealed_refresh_v1",
                "VITE_WALLET_ORIGIN": wallet_origin,
            }
        )
        for name, origin, asset_host in (
            ("app", app_origin, "0"),
            ("wallet", wallet_origin, "1"),
        ):
            app_environment = dict(browser_environment)
            app_environment["VITE_SEAMS_WALLET_ASSET_HOST"] = asset_host
            app_environment["VITE_CACHE_DIR"] = str(directory / f"vite-{name}")
            server = start(
                [
                    "pnpm",
                    "-C",
                    str(wallet_checkout / "tests/intended-app"),
                    "exec",
                    "vite",
                    "--host",
                    "127.0.0.1",
                    "--port",
                    origin.rsplit(":", 1)[1],
                    "--strictPort",
                ],
                directory,
                app_environment,
                f"vite-{name}.log",
                processes,
            )
            wait_for_http(
                origin + ("/__intended-e2e" if name == "app" else "/wallet-service"),
                server,
            )
        browser_output = directory / "browser-results"
        browser_report = directory / "browser-report.json"
        browser_environment["PLAYWRIGHT_JSON_OUTPUT_FILE"] = str(browser_report)
        result["sdkDistSha256"] = directory_sha256(sdk_package / "dist")
        result["sdkPackageSha256"] = sha256(sdk_package / "package.json")
        selection = "(" + "|".join(re.escape(name) for name in BROWSER_CONTRACTS) + ")$"
        test_paths = [f"e2e/intended-behaviours/{name}" for name in BROWSER_FILES]
        result["browserContracts"] = list(BROWSER_CONTRACTS)
        result["browserSourceHashes"] = {
            name: sha256(wallet_checkout / "tests/e2e/intended-behaviours" / name)
            for name in BROWSER_FILES
        }
        run(
            [
                "pnpm",
                "-C",
                str(wallet_checkout / "tests"),
                "exec",
                "playwright",
                "test",
                "-c",
                "playwright.wallet-intended.config.ts",
                *test_paths,
                "--grep",
                selection,
                "--output",
                str(browser_output),
                "--reporter",
                "line,json",
                "--max-failures",
                "1",
            ],
            directory,
            browser_environment,
            "browser.log",
            timeout=1800,
        )
        result["browserOutcomes"] = verify_browser_report(browser_report)
        result["stage"] = "peer-durable-websockets-downgrade-refusal"
        stop(node)
        # The preceding release must refuse the required peer transport before serving.
        refusal = subprocess.run(
            [
                previous,
                "--no-control-plane",
                "--bucket",
                "fleet-test",
                "--listen",
                "127.0.0.1:0",
                "--internal-listen",
                "127.0.0.1:0",
            ],
            cwd=directory,
            env=environment,
            capture_output=True,
            text=True,
            timeout=15,
        )
        refusal_output = refusal.stdout + refusal.stderr
        (directory / "runtime-feature-downgrade.log").write_text(refusal_output)
        assert refusal.returncode == 1
        assert "peer-durable-websockets-v1" in refusal_output
        result["previousRuntime"] = subprocess.check_output(
            [previous, "--version"],
            env=environment,
            text=True,
        ).strip()
        result["previousRuntimeSha256"] = sha256(previous)
        result["runtimeFeatureDowngrade"] = {
            "exitCode": refusal.returncode,
            "output": refusal_output,
        }
        result["status"] = "passed"
    except Exception as error:
        result["status"] = "failed"
        result["error"] = str(error)
    finally:
        for process in reversed(processes):
            stop(process)
        result["cleanup"] = "runtime and temporary emulator stopped; evidence retained"
        write_json(directory / "result.json", result)
        print(f"Packaged wallet {result['status']}: {directory}")
    return 0 if result["status"] == "passed" else 1


if __name__ == "__main__":
    raise SystemExit(main())
