"""Verify the single-VM service and HTTPS boundary on an existing qualification VM.

Usage: python3 google-single-vm.e2e.py RESOURCE_DIRECTORY ordinary|confidential
RESOURCE_DIRECTORY contains resources.json, runtime-build.json, native-release.tar.gz,
and the restricted SSH key from the task-owned Google qualification setup.
"""

import hashlib
import json
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
if target not in ("ordinary", "confidential"):
    raise SystemExit(__doc__)
ledger = json.loads((ledger_directory / "resources.json").read_text())
runtime = json.loads((ledger_directory / "runtime-build.json").read_text())
instance = ledger["ordinaryVm"] if target == "ordinary" else ledger["confidentialVm"]
zone = ledger["zone"] if target == "ordinary" else ledger["confidentialZone"]
root = Path(tempfile.mkdtemp(prefix="single-vm-service-", dir=ledger_directory))
root.chmod(0o700)
identifier = root.name.removeprefix("single-vm-service-")
remote_directory = "/tmp/r190-provider-service-" + identifier
inputs = {
    "id": identifier,
    "project": ledger["project"],
    "instance": instance,
    "zone": zone,
    "bucket": "gs://" + ledger["buckets"]["fleet"] + "/service-" + identifier,
    "runtimeSha256": runtime["executableSha256"],
}
files = {
    "celld.service": repository / "deployment/celld/celld.service",
    "nginx.conf.example": repository / "deployment/celld/nginx.conf.example",
    "remote.py": source.with_name("google-single-vm.remote.py"),
    "worker.mjs": source.with_name("google-single-vm.worker.mjs"),
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
    "--project=" + ledger["project"],
    "--zone=" + zone,
    "--ssh-key-file=" + str(ledger_directory / "ssh-key"),
    "--quiet",
]
print(root, flush=True)
commands = [
    ["gcloud", "compute", "scp", str(archive), instance + ":" + remote_directory + ".tar.gz", *common],
    ["gcloud", "compute", "ssh", instance, *common, "--command=" + (
        "tar -xzf " + shlex.quote(remote_directory + ".tar.gz") + " -C /tmp && "
        "python3 " + shlex.quote(remote_directory + "/remote.py") + " " + shlex.quote(remote_directory)
    )],
    ["gcloud", "compute", "scp", "--recurse", instance + ":" + remote_directory,
     str(root / "remote-results"), *common],
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
