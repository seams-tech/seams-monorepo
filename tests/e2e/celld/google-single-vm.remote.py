"""Check the committed single-node service and HTTPS boundary on a task-owned VM."""

import hashlib
from datetime import datetime, timezone
import http.client
import json
from pathlib import Path
import socket
import ssl
import subprocess
import sys
import tarfile
import time
import traceback
import urllib.request

root = Path(sys.argv[1]).resolve()
inputs = json.loads((root / "inputs.json").read_text())
unit = "r190-celld-provider.service"
proxy_unit = "r190-nginx-provider.service"
state = "celld-provider-" + inputs["id"]
proxy_state = "nginx-provider-" + inputs["id"]
record = {"startedAtUtc": datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S UTC"), "status": "running", "scope": "single-node process supervision, HTTPS forwarding and body limits; synthetic object restart continuity"}


def run(command, label):
    with (root / (label + ".log")).open("w") as output:
        subprocess.run(command, cwd=root, stdout=output, stderr=subprocess.STDOUT, check=True, timeout=180)


def sha256(file):
    return hashlib.sha256(file.read_bytes()).hexdigest()


def service_state(name):
    output = subprocess.check_output([
        "systemctl", "show", name,
        "--property=MainPID,ActiveState,SubState,Result,NRestarts,ExecMainStatus",
    ], text=True)
    return dict(line.split("=", 1) for line in output.splitlines() if "=" in line)


def wait_service(name):
    deadline = time.monotonic() + 60
    while time.monotonic() < deadline:
        value = service_state(name)
        if value["ActiveState"] == "active" and value["MainPID"] != "0":
            return value
        time.sleep(1)
    raise RuntimeError("Service did not become active: " + name)


def https_request(method, path, body=None, headers=None):
    certificate = subprocess.check_output([
        "cat", str(root / "certificate.crt"),
    ], text=True)
    context = ssl.create_default_context(cadata=certificate)
    connection = http.client.HTTPSConnection("r190.test", 8443, context=context, timeout=30)
    connection.sock = context.wrap_socket(socket.create_connection(("127.0.0.1", 8443), timeout=10), server_hostname="r190.test")
    try:
        tls = connection.sock.version()
        fingerprint = hashlib.sha256(connection.sock.getpeercert(binary_form=True)).hexdigest()
        connection.request(method, path, body=body, headers=headers or {})
        response = connection.getresponse()
        data = response.read()
        return {"status": response.status, "body": data.decode(), "tls": tls, "certificateSha256": fingerprint}
    finally:
        connection.close()


def wait_counter(expected):
    deadline = time.monotonic() + 90
    observations = []
    while time.monotonic() < deadline:
        try:
            value = https_request("GET", "/counter")
            observations.append({"status": value["status"], "at": time.time()})
            if value["status"] == 200:
                assert json.loads(value["body"])["count"] == expected, value
                return {"response": value, "observations": observations}
        except (OSError, http.client.HTTPException):
            observations.append({"status": 0, "at": time.time()})
        time.sleep(1)
    raise RuntimeError("Counter did not recover")


try:
    record["stage"] = "restore-verified-runtime"
    (root / "runtime").mkdir(exist_ok=True)
    with tarfile.open(root / "native-release.tar.gz") as archive:
        archive.extractall(root / "runtime", filter="data")
    runtime = root / "runtime/celld"
    assert sha256(runtime) == inputs["runtimeSha256"]
    record["runtimeSha256"] = sha256(runtime)
    record["stage"] = "nginx-package"
    run(["sudo", "apt-get", "update", "-qq"], "apt-update")
    run(["sudo", "systemctl", "mask", "nginx.service"], "mask-default-nginx")
    run(["sudo", "apt-get", "install", "-y", "nginx"], "install-nginx")
    record["nginxPackageVersion"] = subprocess.check_output(["dpkg-query", "-W", "-f=${Version}", "nginx"], text=True).strip()
    record["nginxSha256"] = sha256(Path("/usr/sbin/nginx"))
    if subprocess.run(["id", "-u", "celld"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL).returncode:
        run(["sudo", "useradd", "--system", "--home-dir", "/var/lib/celld", "--shell", "/usr/sbin/nologin", "celld"], "create-user")
    run(["sudo", "mkdir", "-p", "/opt/seams", "/etc/seams"], "directories")
    run(["sudo", "install", "-m", "755", str(runtime), "/opt/seams/celld"], "install-runtime")
    record["stage"] = "install-service-configuration"
    effective = (root / "celld.service").read_text()
    effective = effective.replace("/etc/seams/celld.env", "/etc/seams/r190-celld-provider.env")
    effective = effective.replace("/var/lib/celld", "/var/lib/" + state).replace("StateDirectory=celld", "StateDirectory=" + state)
    (root / "effective.service").write_text(effective)
    (root / "runtime.env").write_text("CELLD_BUCKET=" + inputs["bucket"] + "\n")
    run(["sudo", "install", "-m", "600", str(root / "runtime.env"), "/etc/seams/r190-celld-provider.env"], "install-environment")
    run(["sudo", "install", "-m", "644", str(root / "effective.service"), "/etc/systemd/system/" + unit], "install-unit")
    record["effectiveUnitSha256"] = sha256(root / "effective.service")
    run(["openssl", "req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "1",
         "-subj", "/CN=r190.test", "-addext", "subjectAltName=DNS:r190.test",
         "-keyout", str(root / "certificate.key"), "-out", str(root / "certificate.crt")], "synthetic-certificate")
    run(["sudo", "install", "-m", "640", "-o", "root", "-g", "celld", str(root / "certificate.key"), "/etc/seams/r190-provider.key"], "install-certificate-key")
    run(["sudo", "install", "-m", "644", str(root / "certificate.crt"), "/etc/seams/r190-provider.crt"], "install-certificate")
    proxy = (root / "nginx.conf.example").read_text()
    proxy = proxy.replace("listen 443 ssl;", "listen 127.0.0.1:8443 ssl;")
    proxy = proxy.replace("gateway.example.com", "r190.test")
    proxy = proxy.replace("/etc/seams/tls/gateway.crt", "/etc/seams/r190-provider.crt")
    proxy = proxy.replace("/etc/seams/tls/gateway.key", "/etc/seams/r190-provider.key")
    proxy_directory = "/var/lib/" + proxy_state
    proxy = (
        "worker_processes 1;\n"
        f"pid {proxy_directory}/nginx.pid;\n"
        "error_log stderr;\n"
        "events { worker_connections 128; }\n"
        "http {\n"
        "    access_log off;\n"
        f"    client_body_temp_path {proxy_directory}/body;\n"
        f"    proxy_temp_path {proxy_directory}/proxy;\n"
        f"    fastcgi_temp_path {proxy_directory}/fastcgi;\n"
        f"    uwsgi_temp_path {proxy_directory}/uwsgi;\n"
        f"    scgi_temp_path {proxy_directory}/scgi;\n"
        + proxy
        + "\n}\n"
    )
    (root / "nginx.conf").write_text(proxy)
    run(["sudo", "install", "-m", "644", str(root / "nginx.conf"), "/etc/seams/r190-nginx.conf"], "install-proxy-config")
    run(["sudo", "systemd-analyze", "verify", "/etc/systemd/system/" + unit], "verify-unit")
    run(["/opt/seams/celld", "deploy", "wrangler.json", "--bucket", inputs["bucket"]], "deploy-probe")
    run(["sudo", "systemctl", "daemon-reload"], "reload-systemd")
    run(["sudo", "systemctl", "start", unit], "start-runtime")
    record["initialService"] = wait_service(unit)
    run([
        "sudo", "systemd-run", "--collect", "--unit=" + proxy_unit,
        "--property=User=celld", "--property=StateDirectory=" + proxy_state,
        "/usr/sbin/nginx", "-c", "/etc/seams/r190-nginx.conf", "-g", "daemon off;",
    ], "start-proxy")
    wait_service(proxy_unit)
    time.sleep(2)
    record["stage"] = "https-boundary"
    forwarded = https_request("POST", "/inspect", b"small", {"X-Forwarded-Host": "spoof.invalid", "X-Forwarded-Proto": "http"})
    assert forwarded["status"] == 200, forwarded
    assert json.loads(forwarded["body"]) == {"url": "https://r190.test:8443/inspect", "bytes": 5}, forwarded
    record["trustedForwarding"] = forwarded
    exact = https_request("POST", "/inspect", b"a" * 1048576)
    assert exact["status"] == 200 and json.loads(exact["body"])["bytes"] == 1048576, exact
    record["exactBodyLimit"] = {"status": exact["status"], "bytes": 1048576}
    over = https_request("POST", "/inspect", b"a" * 1048577)
    assert over["status"] == 413, over
    record["oversizedBody"] = {"status": over["status"], "bytes": 1048577}
    health_observations = []
    deadline = time.monotonic() + 90
    while time.monotonic() < deadline:
        health = https_request("GET", "/.well-known/celld/health")
        health_observations.append({"status": health["status"], "at": time.time()})
        if health["status"] == 200:
            break
        time.sleep(1)
    record["healthReadiness"] = health_observations
    assert health["status"] == 200, health
    with urllib.request.urlopen("http://127.0.0.1:8081/state", timeout=10) as response:
        private_status = response.status
    assert private_status == 200
    public_state = https_request("GET", "/state")
    assert public_state["status"] == 404, public_state
    record["operatorBoundary"] = {"privateStatus": private_status, "publicStatus": public_state["status"]}
    made = https_request("POST", "/counter")
    assert made["status"] == 200 and json.loads(made["body"])["count"] == 1, made
    record["acknowledgedCounter"] = made
    record["stage"] = "supervised-restarts"
    run(["sudo", "systemctl", "restart", unit], "graceful-restart")
    record["afterGracefulRestart"] = wait_service(unit)
    record["gracefulCounter"] = wait_counter(1)
    fresh = https_request("POST", "/counter")
    assert fresh["status"] == 200 and json.loads(fresh["body"])["count"] == 2, fresh
    record["freshAcknowledgedCounterBeforeCrash"] = fresh
    run(["sudo", "systemctl", "kill", "--signal=SIGKILL", unit], "kill-runtime")
    time.sleep(3)
    record["afterForcedRestart"] = wait_service(unit)
    assert int(record["afterForcedRestart"]["NRestarts"]) >= 1
    record["forcedCounter"] = wait_counter(2)
    run(["sudo", "ss", "-ltnp"], "listeners")
    record["status"] = "passed"
except Exception as error:
    record["status"] = "failed"
    record["error"] = str(error)
    record["errorType"] = type(error).__name__
    (root / "failure.txt").write_text(traceback.format_exc())
finally:
    for name in (proxy_unit, unit):
        stopped = subprocess.run(["sudo", "systemctl", "stop", name], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        record.setdefault("cleanup", {})[name] = {"stopExitCode": stopped.returncode}
        with (root / (name + ".journal.log")).open("w") as output:
            subprocess.run(["sudo", "journalctl", "--no-pager", "--since", record["startedAtUtc"], "-u", name], stdout=output, stderr=subprocess.STDOUT)
    (root / "certificate.key").unlink(missing_ok=True)
    subprocess.run([
        "sudo", "rm", "-f", "/etc/seams/r190-provider.key",
    ], check=True)
    record["cleanup"]["syntheticPrivateKey"] = "removed from input directory and VM configuration"
    (root / "result.json").write_text(json.dumps(record, indent=2) + "\n")
    print(json.dumps({"status": record["status"], "error": record.get("error")}))

raise SystemExit(0 if record["status"] == "passed" else 1)
