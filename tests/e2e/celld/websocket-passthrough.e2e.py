"""Verify WebSocket passthrough, relay, rejection, and shutdown on two nodes.

Usage: python3 websocket-passthrough.e2e.py CELLD MOTO_PYTHON
The fixture uses isolated loopback services and a synthetic S3 fleet.
"""

import importlib.util
import json
import os
from pathlib import Path
import shutil
import sys
import tempfile
import urllib.request

spec = importlib.util.spec_from_file_location(
    "harness", Path(__file__).with_name("packaged-wallet.e2e.py")
)
harness = importlib.util.module_from_spec(spec)
spec.loader.exec_module(harness)

OWNER = """export class Echo {
  fetch(request) {
    if (new URL(request.url).pathname === '/touch') return new Response('ready');
    const pair = new WebSocketPair();
    pair[1].accept();
    pair[1].addEventListener('message', echo.bind(null, pair[1]));
    return new Response(null, { status: 101, webSocket: pair[0] });
  }
}
function echo(socket, event) { socket.send('echo:' + event.data); }
export default { fetch(request, env) {
  const url = new URL(request.url);
  const id = env.ECHO.idFromName(url.searchParams.get('name'));
  if (url.pathname === '/id') return Response.json({ id: id.toString() });
  return env.ECHO.get(id).fetch(request);
} };
"""

RELAY = """export class Relay {
  constructor(_state, env) { this.env = env; }
  fetch(request) {
    if (new URL(request.url).pathname === '/touch-relay') return new Response('ready');
    const forwarded = new Request(request);
    forwarded.headers.set('Upgrade', 'websocket');
    return this.env.OWNER.fetch(forwarded);
  }
}
export default { fetch(request, env) {
  const url = new URL(request.url);
  const id = env.RELAY.idFromName(url.searchParams.get('name'));
  if (url.pathname === '/relay-id') return Response.json({ id: id.toString() });
  return env.RELAY.get(id).fetch(request);
} };
"""

CLIENT = """class Probe {
  constructor(socket) { this.socket = socket; this.answer = Promise.withResolvers(); }
  message(event) {
    this.answer.resolve({ kind: 'message', data: event.data });
    this.socket.close(1000, 'complete');
  }
  close(event) { this.answer.resolve({ kind: 'closed', code: event.code }); }
  timeout() { this.answer.reject(new Error('Echo timed out')); this.socket.close(1000); }
}
function refusal(message) {
  if (!message.includes('Upgrade: websocket')) throw new Error(message);
  return Response.json({ kind: 'upgrade-refused' });
}
export default { async fetch(request, env) {
  const url = new URL(request.url);
  if (url.pathname === '/health') return new Response('ready');
  if (url.pathname === '/touch' || url.pathname === '/id') return env.OWNER.fetch(request);
  if (url.pathname === '/touch-relay' || url.pathname === '/relay-id') return env.RELAY.fetch(request);
  const reject = url.pathname === '/reject';
  const headers = reject ? {} : { Upgrade: 'websocket' };
  let response;
  try { response = await env.RELAY.fetch(new Request(request, { headers })); }
  catch (error) { return refusal(String(error)); }
  const socket = response.webSocket;
  if (!socket) return refusal(await response.text());
  if (reject) { socket.accept(); socket.close(1000); throw new Error('Invalid upgrade accepted'); }
  const probe = new Probe(socket);
  socket.addEventListener('message', probe.message.bind(probe));
  socket.addEventListener('close', probe.close.bind(probe));
  socket.accept();
  socket.send('ping');
  const timer = setTimeout(probe.timeout.bind(probe), 5000);
  try { return Response.json(await probe.answer.promise); }
  finally { clearTimeout(timer); }
} };
"""


def read(address, route):
    with urllib.request.urlopen(address + route, timeout=15) as response:
        return json.loads(response.read())


def ownership(root, environment, class_name, identifier, peer, label):
    owner = root / (label + "-owner.json")
    harness.run(
        [
            "aws",
            "s3api",
            "get-object",
            "--bucket",
            "websocket-test",
            "--key",
            "cells/" + class_name + ":" + identifier + "/own.json",
            owner,
        ],
        root,
        environment,
        label + "-owner.log",
    )
    record = json.loads(owner.read_text())
    lease = root / (label + "-lease.json")
    harness.run(
        [
            "aws",
            "s3api",
            "get-object",
            "--bucket",
            "websocket-test",
            "--key",
            "nodes/" + record["node"] + ".json",
            lease,
        ],
        root,
        environment,
        label + "-lease.log",
    )
    node = json.loads(lease.read_text())
    assert node["addr"] == peer
    return {"owner": record, "peer": node["addr"]}


def main():
    if len(sys.argv) != 3:
        raise SystemExit(__doc__)
    binary, python = [Path(value).absolute() for value in sys.argv[1:]]
    repo = Path(__file__).resolve().parents[3]
    root = Path(
        tempfile.mkdtemp(prefix="celld-websocket-passthrough-", dir=repo / ".artifacts")
    )
    root.chmod(0o700)
    shutil.copyfile(__file__, root / "driver.py")
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
        "RUST_LOG": "warn",
        "CELLD_DEPLOY_POLL_S": "1",
    }
    configs = {
        "owner": {
            "name": "echo-owner",
            "durable_objects": {"bindings": [{"name": "ECHO", "class_name": "Echo"}]},
            "migrations": [{"tag": "initial", "new_sqlite_classes": ["Echo"]}],
        },
        "relay": {
            "name": "echo-relay",
            "durable_objects": {"bindings": [{"name": "RELAY", "class_name": "Relay"}]},
            "migrations": [{"tag": "initial", "new_sqlite_classes": ["Relay"]}],
            "services": [{"binding": "OWNER", "service": "echo-owner"}],
        },
        "client": {
            "name": "echo-client",
            "services": [
                {"binding": "OWNER", "service": "echo-owner"},
                {"binding": "RELAY", "service": "echo-relay"},
            ],
        },
    }
    for role, code in (("owner", OWNER), ("relay", RELAY), ("client", CLIENT)):
        (root / (role + ".mjs")).write_text(code)
        config = dict(
            configs[role],
            main=role + ".mjs",
            no_bundle=True,
            compatibility_date="2026-06-12",
        )
        harness.write_json(root / (role + ".json"), config)
    result = {
        "status": "running",
        "runtimeSha256": harness.sha256(binary),
        "driverSha256": harness.sha256(Path(__file__)),
        "harnessSha256": harness.sha256(Path(harness.__file__)),
        "fixtureHashes": {p.name: harness.sha256(p) for p in root.glob("*.mjs")},
        "cases": [],
    }
    processes = []
    runtimes = []
    print(root, flush=True)
    try:
        emulator = harness.start(
            [
                python,
                "-m",
                "moto.server",
                "-H",
                "127.0.0.1",
                "-p",
                endpoint.rsplit(":", 1)[1],
            ],
            root,
            environment,
            "moto.log",
            processes,
        )
        harness.wait_for_http(endpoint, emulator)
        harness.run(
            ["aws", "s3api", "create-bucket", "--bucket", "websocket-test"],
            root,
            environment,
            "bucket.log",
        )
        for role in configs:
            harness.run(
                [binary, "deploy", role + ".json", "--bucket", "websocket-test"],
                root,
                environment,
                "deploy-" + role + ".log",
            )
        nodes = []
        for number in range(2):
            directory = root / ("node-" + str(number))
            directory.mkdir()
            address = "http://127.0.0.1:" + str(harness.free_port())
            peer = "127.0.0.1:" + str(harness.free_port())
            runtime = harness.start(
                [
                    binary,
                    "--no-control-plane",
                    "--bucket",
                    "websocket-test",
                    "--listen",
                    address.removeprefix("http://"),
                    "--internal-listen",
                    peer,
                    "--advertise",
                    peer,
                ],
                directory,
                environment,
                "runtime.log",
                processes,
            )
            runtimes.append(runtime)
            harness.wait_for_http(address + "/health", runtime)
            nodes.append({"address": address, "peer": peer, "pid": runtime.pid})
        result["nodes"] = nodes
        for name, owner_node, relay_node, route in (
            ("local", 0, 0, "/echo"),
            ("remote-owner", 1, 0, "/echo"),
            ("remote-relay", 0, 1, "/echo"),
            ("rejected-upgrade", 1, 0, "/reject"),
        ):
            owner = nodes[owner_node]
            relay = nodes[relay_node]
            assert (
                harness.response(owner["address"] + "/touch?name=" + name)["status"]
                == 200
            )
            assert (
                harness.response(relay["address"] + "/touch-relay?name=" + name)[
                    "status"
                ]
                == 200
            )
            owner_id = read(owner["address"], "/id?name=" + name)["id"]
            relay_id = read(relay["address"], "/relay-id?name=" + name)["id"]
            case = {
                "name": name,
                "owner": ownership(
                    root, environment, "Echo", owner_id, owner["peer"], name + "-echo"
                ),
                "relay": ownership(
                    root, environment, "Relay", relay_id, relay["peer"], name + "-relay"
                ),
            }
            case["answer"] = read(nodes[0]["address"], route + "?name=" + name)
            expected = (
                {"kind": "upgrade-refused"}
                if route == "/reject"
                else {
                    "kind": "message",
                    "data": "echo:ping",
                }
            )
            assert case["answer"] == expected, case
            result["cases"].append(case)
        assert result["driverSha256"] == harness.sha256(Path(__file__))
        result["status"] = "passed"
    except (Exception, KeyboardInterrupt) as error:
        result["status"] = "failed"
        result["error"] = repr(error)
        raise
    finally:
        errors = []
        for process in reversed(processes):
            try:
                if process.poll() is None:
                    process.terminate()
                    process.wait(timeout=50)
                if process in runtimes:
                    assert process.returncode == 0, (process.pid, process.returncode)
            except Exception as error:
                errors.append(repr(error))
                harness.stop(process)
        for log in root.glob("node-*/runtime.log"):
            if "shutdown_handoff_stalled" in log.read_text():
                errors.append(str(log.relative_to(root)) + ": shutdown handoff stalled")
        result["cleanupErrors"] = errors
        if errors:
            result["status"] = "failed"
        harness.write_json(root / "result.json", result)
    assert result["status"] == "passed", errors


if __name__ == "__main__":
    main()
