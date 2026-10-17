"""Run the existing Console onboarding scenario through production Workers on celld.

Usage: python3 console.e2e.py CELLD MOTO_PYTHON
Uses synthetic accounts, the local object-store emulator, and the existing D1 CLI.
"""

import importlib.util
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import urllib.error
import urllib.request

source = Path(__file__).resolve()
repository = source.parents[3]
spec = importlib.util.spec_from_file_location(
    "wallet_harness", source.with_name("packaged-wallet.e2e.py")
)
harness = importlib.util.module_from_spec(spec)
spec.loader.exec_module(harness)
binary = Path(sys.argv[1]).resolve()
python = Path(sys.argv[2]).absolute()
root = Path(
    tempfile.mkdtemp(prefix="celld-console-", dir=repository / ".artifacts")
)
root.chmod(0o700)
endpoint = "http://127.0.0.1:" + str(harness.free_port())
address = "http://127.0.0.1:" + str(harness.free_port())
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
    "RUST_LOG": "warn,cell_console=info",
    "CELLD_DEPLOY_POLL_S": "1",
    "CELLD_WATCH": str(root / "watch"),
}
candidate = os.environ.get("SEAMS_WALLET_SERVER_CANDIDATE")
if candidate:
    environment["SEAMS_WALLET_SERVER_CANDIDATE"] = candidate
    result_candidate = str(Path(candidate).resolve())
else:
    result_candidate = "installed exact Wallet package"
driver = source.with_suffix(".ts")
esbuild = repository / "node_modules/.bin/esbuild"
bundled_driver = root / "console-driver.cjs"
processes = []
result = {
    "status": "running",
    "scope": (
        "production Console onboarding, exact replay, service binding and D1 "
        "persistence; no Wallet activation or Google claim"
    ),
    "runtimeSha256": harness.sha256(binary),
    "harnessSha256": harness.sha256(source),
    "driverSha256": harness.sha256(driver),
    "artifactDirectory": str(root),
    "walletServerCandidate": result_candidate,
}
print(root, flush=True)


def request_status(url):
    try:
        with urllib.request.urlopen(url, timeout=10) as response:
            return response.status
    except urllib.error.HTTPError as error:
        return error.code


def application_schema(log_name):
    sql = (
        "SELECT COUNT(*) AS count FROM sqlite_master WHERE name IN "
        "('billing_funds_admission', 'platform_service_instances', 'organizations')"
    )
    harness.run(
        [
            binary, "d1", "execute", "console-celld-acceptance", "console.json",
            "--bucket", "fleet-test", "--command", sql, "--json",
        ],
        root, environment, log_name,
    )
    row = json.loads((root / log_name).read_text().splitlines()[-1])
    if not isinstance(row, dict) or type(row.get("count")) is not int:
        raise RuntimeError("The runtime CLI did not return an application schema count")
    return row


try:
    result["stage"] = "tool-identities"
    result["moto"] = subprocess.check_output(
        [python, "-c", 'import importlib.metadata; print(importlib.metadata.version("moto"))'],
        text=True,
    ).strip()
    assert result["moto"] == "5.1.14"
    result["runtime"] = subprocess.check_output(
        [binary, "--version"], env=dict(environment, RUST_LOG="error"), text=True
    ).strip()
    harness.run(
        [
            esbuild, driver, "--bundle", "--platform=node", "--format=cjs",
            "--main-fields=module,main", "--conditions=workerd,worker,browser",
            "--external:esbuild", "--external:@playwright/test", "--external:node:*",
            "--loader:.wasm=file",
            "--tsconfig=" + str(repository / "tests/tsconfig.playwright.json"),
            "--outfile=" + str(bundled_driver),
        ],
        root, environment, "bundle-driver.log",
    )
    harness.run(
        ["node", bundled_driver, "prepare", root, binary, address, repository],
        root, environment, "prepare.log",
    )
    result["stage"] = "local-object-store"
    emulator = harness.start(
        [python, "-m", "moto.server", "-H", "127.0.0.1", "-p", endpoint.rsplit(":", 1)[1]],
        root, environment, "moto.log", processes,
    )
    harness.wait_for_http(endpoint, emulator)
    harness.run(
        ["aws", "s3api", "create-bucket", "--bucket", "fleet-test"],
        root, environment, "bucket.log",
    )
    (root / "guard.mjs").write_text(
        'export default { fetch() { return new Response("Dependency unavailable", '
        '{ status: 503 }); } };\n'
    )
    (root / "guard.json").write_text(json.dumps({
        "name": "guard", "main": "guard.mjs", "no_bundle": True,
        "compatibility_date": "2026-04-17",
    }))
    result["stage"] = "render-production-console"
    (root / "empty-secrets.json").write_text("{}\n")
    renderer = repository / "deployment/celld/render.mjs"
    result["rendererSha256"] = harness.sha256(renderer)
    harness.run(
        ["node", renderer, root / "console.json", root / "empty-secrets.json", root / "rendered"],
        root, environment, "render.log",
    )
    result["deployedConsoleBundleSha256"] = harness.sha256(root / "rendered/worker.mjs")
    result["stage"] = "deploy-production-console"
    for role in ("guard", "console", "consumer"):
        deployment = root / "rendered/wrangler.json" if role == "console" else root / (role + ".json")
        harness.run(
            [binary, "deploy", deployment, "--bucket", "fleet-test"],
            root, environment, "deploy-" + role + ".log",
        )
    runtime = harness.start(
        [
            binary, "--no-control-plane", "--bucket", "fleet-test",
            "--listen", address.removeprefix("http://"),
            "--internal-listen", "127.0.0.1:0", "--trust-forwarded-headers",
        ],
        root, environment, "runtime.log", processes,
    )
    harness.wait_for_http(address + "/.well-known/celld/health", runtime)
    result["stage"] = "pre-migration-schema"
    result["initialSchema"] = application_schema("initial-schema.json")
    assert result["initialSchema"]["count"] == 0
    result["premigrationApplicationStatus"] = request_status(
        address + "/console/__acceptance_ready"
    )
    assert result["premigrationApplicationStatus"] in (404, 500)
    result["schemaAfterPremigrationRequest"] = application_schema(
        "after-premigration-request.json"
    )
    assert result["schemaAfterPremigrationRequest"]["count"] == 0
    result["stage"] = "apply-console-migrations"
    harness.run(
        [
            binary, "d1", "migrations", "apply", "console-celld-acceptance",
            "console.json", "--bucket", "fleet-test",
        ],
        root, environment, "migrate.log", timeout=180,
    )
    result["stage"] = "unchanged-onboarding-scenario"
    harness.run(
        ["node", bundled_driver, "verify", root, binary, address, repository],
        root, environment, "verify.log", timeout=180,
    )
    result["preparation"] = json.loads((root / "prepared-proof.json").read_text())
    result["onboarding"] = json.loads((root / "onboarding-proof.json").read_text())
    result["status"] = "passed"
except Exception as error:
    result["status"] = "failed"
    result["error"] = repr(error)
finally:
    for process in reversed(processes):
        harness.stop(process)
    result["cleanup"] = "runtime and emulator stopped; synthetic local evidence retained"
    harness.write_json(root / "result.json", result)
    print("Console celld", result["status"], flush=True)

raise SystemExit(0 if result["status"] == "passed" else 1)
