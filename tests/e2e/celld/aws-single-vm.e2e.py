"""Verify the single-VM service and HTTPS boundary on a running EC2 qualification instance.

Usage: python3 aws-single-vm.e2e.py RESOURCE_DIRECTORY NODE_KIND
RESOURCE_DIRECTORY contains resources.json, runtime-build.json, native-release.tar.gz,
and the restricted SSH key from the task-owned AWS qualification setup.
Mirrors google-single-vm.e2e.py; only the provider operations differ.
"""

import hashlib
import json
import os
from pathlib import Path
import shlex
import shutil
import subprocess
import sys
import tarfile
import tempfile


source = Path(__file__).resolve()
repository = source.parents[3]
ledger_directory = Path(sys.argv[1]).resolve()
target = sys.argv[2]
ledger = json.loads((ledger_directory / "resources.json").read_text())
assert ledger["provider"] == "aws"
nodes = {node["kind"]: node for node in ledger["nodes"]}
if target not in nodes:
    raise SystemExit(__doc__)
runtime = json.loads((ledger_directory / "runtime-build.json").read_text())
instance = nodes[target]["instance"]
provider_environment = dict(os.environ, AWS_PROFILE=os.environ.get("AWS_PROFILE", "seams-celld"),
                            AWS_REGION=ledger["region"])
public_ip = subprocess.check_output([
    "aws", "ec2", "describe-instances", "--instance-ids", instance, "--output", "text",
    "--query", "Reservations[0].Instances[0].PublicIpAddress",
], env=provider_environment, text=True).strip()
root = Path(tempfile.mkdtemp(prefix="single-vm-service-", dir=ledger_directory))
root.chmod(0o700)
identifier = root.name.removeprefix("single-vm-service-")
remote_directory = "/tmp/r190-provider-service-" + identifier
inputs = {
    "id": identifier,
    "account": ledger["account"],
    "region": ledger["region"],
    "instance": instance,
    "bucket": "s3://" + ledger["buckets"]["fleet"] + "/service-" + identifier,
    "runtimeSha256": runtime["executableSha256"],
}
files = {
    "celld.service": repository / "deployment/celld/celld.service",
    "nginx.conf.example": repository / "deployment/celld/nginx.conf.example",
    "remote.py": source.with_name("single-vm.remote.py"),
    "worker.mjs": source.with_name("single-vm.worker.mjs"),
    "native-release.tar.gz": ledger_directory / "native-release.tar.gz",
}
for name, file in files.items():
    shutil.copyfile(file, root / name)
(root / "inputs.json").write_text(json.dumps(inputs, indent=2) + "\n")
(root / "wrangler.json").write_text(json.dumps({
    "name": "provider-check",
    "main": "worker.mjs",
    "no_bundle": True,
    "compatibility_date": "2026-04-17",
    "durable_objects": {"bindings": [{"name": "COUNTER", "class_name": "Counter"}]},
    "migrations": [{"tag": "v1", "new_sqlite_classes": ["Counter"]}],
}, indent=2) + "\n")
hashes = {file.name: hashlib.sha256(file.read_bytes()).hexdigest()
          for file in root.iterdir() if file.is_file()}
hashes["controller"] = hashlib.sha256(source.read_bytes()).hexdigest()
(root / "source-hashes.json").write_text(json.dumps(hashes, indent=2) + "\n")
archive = root / "inputs.tar.gz"
with tarfile.open(archive, "w:gz") as output:
    for file in sorted(root.iterdir()):
        if file.is_file() and file != archive:
            output.add(file, arcname=Path(remote_directory).name + "/" + file.name)
common = [
    "-i", str(ledger_directory / "ssh-key"), "-o", "IdentitiesOnly=yes", "-o", "BatchMode=yes",
    "-o", "StrictHostKeyChecking=accept-new", "-o", "UserKnownHostsFile=" + str(ledger_directory / "known_hosts"),
]
login = "ubuntu@" + public_ip
print(root, flush=True)
commands = [
    ["scp", *common, str(archive), login + ":" + remote_directory + ".tar.gz"],
    ["ssh", *common, login, (
        "tar -xzf " + shlex.quote(remote_directory + ".tar.gz") + " -C /tmp && "
        "python3 " + shlex.quote(remote_directory + "/remote.py") + " " + shlex.quote(remote_directory)
    )],
    ["scp", *common, "-r", login + ":" + remote_directory, str(root / "remote-results")],
]
failed = False
for index, command in enumerate(commands):
    with (root / (str(index) + ".log")).open("w") as log:
        result = subprocess.run(command, stdout=log, stderr=subprocess.STDOUT, timeout=900)
    if result.returncode:
        failed = True
        print("Operation failed:", index, flush=True)
        if index == 0:
            break
result_file = root / "remote-results/result.json"
if not result_file.exists():
    failed = True
else:
    failed = failed or json.loads(result_file.read_text())["status"] != "passed"
raise SystemExit(1 if failed else 0)
