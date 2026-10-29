#!/usr/bin/env python3
"""Read Console proof counts through the owned Google runtime's native D1 CLI."""

import json
from pathlib import Path
import shlex
import subprocess
import sys

arguments = sys.argv[1:]
if (
    len(arguments) != 9
    or arguments[:3] != ["d1", "execute", "console-celld-acceptance"]
    or arguments[4:7] != ["--bucket", "fleet-test", "--command"]
    or arguments[8] != "--json"
):
    raise SystemExit("The Google Console proof reader accepts only count queries")
sql = arguments[7]
if not sql.startswith("SELECT COUNT(*) AS count FROM "):
    raise SystemExit("The Google Console proof reader requires a count query")
configuration = json.loads(Path(__file__).with_name("google-count.json").read_text())
remote = shlex.join(
    [
        "python3",
        configuration["remoteDirectory"] + "/remote.py",
        configuration["remoteDirectory"],
        "console-count",
        sql,
    ]
)
output = subprocess.check_output(
    [
        "gcloud",
        "compute",
        "ssh",
        configuration["instance"],
        "--project=" + configuration["project"],
        "--zone=" + configuration["zone"],
        "--ssh-key-file=" + configuration["sshKey"],
        "--quiet",
        "--command=" + remote,
    ],
    text=True,
    timeout=90,
)
rows = [json.loads(line) for line in output.splitlines() if line.startswith("{")]
if (
    len(rows) != 1
    or set(rows[0]) != {"count"}
    or type(rows[0]["count"]) is not int
    or rows[0]["count"] < 0
):
    raise RuntimeError("The Google runtime returned an invalid proof count")
print(json.dumps(rows[0]))
