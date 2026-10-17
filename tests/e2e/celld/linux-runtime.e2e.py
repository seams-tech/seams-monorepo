"""Verify the Linux release with the shared Worker binding fixtures.

Usage: python3 linux-runtime.e2e.py IMAGE WALLET_CHECKOUT BINDING_REFERENCE_JSON
Requires Docker and a passed public celld-bindings.e2e.mjs result.
This checks a single Linux container, object restart, and streaming copies.
"""

import hashlib
import json
from pathlib import Path
import shutil
import socket
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request
import uuid


def command(args):
    return subprocess.check_output(args, text=True, stderr=subprocess.STDOUT).strip()


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def request(address, path):
    with urllib.request.urlopen(address + path, timeout=10) as response:
        assert response.status == 200
        return json.loads(response.read())


def start(image, directory, config, port, name):
    command(
        [
            "docker",
            "run",
            "--detach",
            "--name",
            name,
            "--publish",
            f"127.0.0.1:{port}:8080",
            "--mount",
            f"type=bind,source={directory},target=/probe",
            "--workdir",
            "/probe",
            image,
            "dev",
            f"/probe/{config}.json",
            "--host",
            "0.0.0.0",
            "--port",
            "8080",
            "--no-watch",
            "--logs",
        ]
    )
    address = f"http://127.0.0.1:{port}"
    deadline = time.monotonic() + 30
    while time.monotonic() < deadline:
        try:
            with urllib.request.urlopen(address + "/health", timeout=0.5) as response:
                if response.read() == b"ready":
                    return address
        except (OSError, TimeoutError):
            pass
        state = json.loads(command(["docker", "inspect", name]))[0]["State"]
        if not state["Running"]:
            raise RuntimeError(command(["docker", "logs", name]))
        time.sleep(0.1)
    raise RuntimeError("Linux runtime readiness timed out")


def stop(name, directory, stage):
    subprocess.run(
        ["docker", "stop", "--time", "10", name], check=True, capture_output=True
    )
    (directory / f"{stage}.log").write_text(command(["docker", "logs", name]))
    command(["docker", "rm", name])


def main():
    if len(sys.argv) != 4:
        raise SystemExit(__doc__)
    image, checkout_argument, reference_argument = sys.argv[1:]
    checkout = Path(checkout_argument).resolve()
    reference_path = Path(reference_argument).resolve()
    reference = json.loads(reference_path.read_text())
    assert reference["status"] == "passed"
    fixtures = checkout / "tests/e2e/celld-bindings"
    for role in ("owner", "caller"):
        assert digest(fixtures / f"{role}.mjs") == reference["fixtureHashes"][role]
    repository = Path(__file__).resolve().parents[3]
    directory = Path(
        tempfile.mkdtemp(prefix="celld-linux-", dir=repository / ".artifacts")
    )
    for file in reference_path.parent.glob("*.json"):
        if file.name != "result.json":
            shutil.copyfile(file, directory / file.name)
    for file in fixtures.glob("*.mjs"):
        shutil.copyfile(file, directory / file.name)
    with socket.socket() as listener:
        listener.bind(("127.0.0.1", 0))
        port = listener.getsockname()[1]
    name = "seams-celld-r190-" + uuid.uuid4().hex[:12]
    metadata = json.loads(command(["docker", "image", "inspect", image]))[0]
    assert metadata["Os"] == "linux"
    result = {
        "sourceCommit": command(["git", "-C", str(repository), "rev-parse", "HEAD"]),
        "walletCheckout": command(["git", "-C", str(checkout), "rev-parse", "HEAD"]),
        "platform": metadata["Os"] + "-" + metadata["Architecture"],
        "binarySha256": command(
            [
                "docker",
                "run",
                "--rm",
                "--entrypoint",
                "sha256sum",
                image,
                "/usr/local/bin/celld",
            ]
        ).split()[0],
        "status": "running",
        "scope": "single-container Linux object and stream behavior",
        "image": metadata["Id"],
        "version": command(["docker", "run", "--rm", image, "--version"]),
        "referenceSha256": digest(reference_path),
        "harnessSha256": digest(Path(__file__)),
        "fixtureHashes": reference["fixtureHashes"],
    }
    try:
        address = start(image, directory, "owner", port, name)
        first = request(address, "/increment")
        assert first["count"] == 1 and first["owner"] == "router"
        stop(name, directory, "owner")
        address = start(image, directory, "external", port, name)
        second = request(address, "/object/increment")
        assert second["count"] == 2 and second["owner"] == "router"
        assert second["id"] == first["id"]
        assert request(address, "/alias/read") == second
        assert request(address, "/service/read") == second
        result["streamClone"] = request(address, "/stream-clone")
        assert result["streamClone"] == reference["streamClone"]
        stop(name, directory, "external")
        address = start(image, directory, "restart", port, name)
        assert request(address, "/object/read") == second
        stop(name, directory, "restart")
        result["object"] = second
        result["status"] = "passed"
    except Exception as error:
        result["status"] = "failed"
        result["error"] = str(error)
    finally:
        # The name is unique to this run. Preserve logs before removing its container.
        logs = subprocess.run(["docker", "logs", name], capture_output=True, text=True)
        if logs.returncode == 0:
            (directory / "failure.log").write_text(logs.stdout + logs.stderr)
        subprocess.run(["docker", "rm", "--force", name], capture_output=True)
        remaining = subprocess.run(
            [
                "docker",
                "ps",
                "--all",
                "--filter",
                "name=^/" + name + "$",
                "--format",
                "{{.ID}}",
            ],
            capture_output=True,
            text=True,
        )
        if remaining.returncode == 0 and not remaining.stdout.strip():
            result["cleanup"] = "owned runtime container removed; evidence retained"
        else:
            result["status"] = "failed"
            result["cleanup"] = "owned container removal could not be verified"
        (directory / "result.json").write_text(json.dumps(result, indent=2) + "\n")
        print(f"Linux runtime {result['status']}: {directory}")
    return 0 if result["status"] == "passed" else 1


if __name__ == "__main__":
    raise SystemExit(main())
