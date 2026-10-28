"""Offline Nitro adapter E2E with real celld, Moto S3, and Unix sockets replacing VSOCK.

Usage: python3 tests/e2e/celld/nitro.e2e.py ADAPTER_IMAGE
Build the adapter image first. Docker builds require package downloads; execution
uses two --network none containers. No Nitro, AWS, or attestation claim is made.
"""

import base64
import hashlib
import http.client
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import os
from pathlib import Path
import shutil
import socket
import subprocess
import sys
import tempfile
import time
import uuid


def run(arguments, **options):
    try:
        return subprocess.check_output(arguments, text=True, stderr=subprocess.STDOUT, **options).strip()
    except subprocess.CalledProcessError as error:
        print(error.output, file=sys.stderr)
        raise


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


class MetadataHandler(BaseHTTPRequestHandler):
    def do_PUT(self):
        assert self.path == "/latest/api/token"
        self.send_value("test-imds-token")

    def do_GET(self):
        assert self.headers.get("X-aws-ec2-metadata-token") == "test-imds-token"
        if self.path == "/latest/meta-data/iam/security-credentials/":
            self.send_value("nitro-test-role")
        elif self.path == "/latest/meta-data/iam/security-credentials/nitro-test-role":
            self.send_value(json.dumps({
                "Code": "Success", "Type": "AWS-HMAC", "AccessKeyId": "test",
                "SecretAccessKey": "test", "Token": "test",
                "Expiration": "2099-01-01T00:00:00Z",
            }))
        else:
            self.send_error(404)

    def send_value(self, value):
        with open("/results/metadata-requests.txt", "a") as output:
            output.write(f"{self.command} {self.path}\n")
        data = value.encode()
        self.send_response(200)
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def log_message(self, *_arguments):
        pass


def parent():
    import boto3

    run(["ip", "address", "add", "169.254.169.254/32", "dev", "lo"])
    subprocess.Popen([sys.executable, __file__, "metadata"])
    subprocess.Popen([
        "/opt/test/bin/moto_server", "-H", "127.0.0.1", "-p", "443",
        "--ssl-cert", "/test/certificate.crt", "--ssl-key", "/test/certificate.key",
    ])
    client = boto3.client(
        "s3", region_name="us-east-1", endpoint_url="https://s3.us-east-1.amazonaws.com",
        aws_access_key_id="test", aws_secret_access_key="test",
        verify="/etc/ssl/certs/ca-certificates.crt",
    )
    deadline = time.monotonic() + 30
    while True:
        try:
            client.create_bucket(Bucket="nitro-fleet")
            break
        except Exception:
            if time.monotonic() > deadline:
                raise
            time.sleep(0.2)
    environment = dict(os.environ)
    environment.update({
        "AWS_REGION": "us-east-1", "AWS_ACCESS_KEY_ID": "test", "AWS_SECRET_ACCESS_KEY": "test",
        "S3_ENDPOINT": "https://s3.us-east-1.amazonaws.com",
        "AWS_ENDPOINT_URL": "https://s3.us-east-1.amazonaws.com", "CELLD_R2_BUCKETS": "{}",
    })
    run(["/opt/seams/celld", "deploy", "/test/wrangler.json", "--bucket", "s3://nitro-fleet"], env=environment)
    os.execv("/opt/seams/nitro.sh", ["nitro.sh", "parent", "/test/runtime.env", "16"])


def request(method, path, body=None):
    connection = http.client.HTTPConnection("127.0.0.1", 8080, timeout=20)
    try:
        connection.request(method, path, body)
        response = connection.getresponse()
        data = response.read()
        assert response.status == 200, (response.status, data[:300])
        return data
    finally:
        connection.close()


def receive_exact(connection, length):
    result = b""
    while len(result) < length:
        part = connection.recv(length - len(result))
        if not part:
            raise RuntimeError("Unexpected socket EOF")
        result += part
    return result


def websocket():
    with socket.create_connection(("127.0.0.1", 8080), timeout=20) as connection:
        key = base64.b64encode(os.urandom(16)).decode()
        connection.sendall((
            "GET /websocket HTTP/1.1\r\nHost: localhost\r\nUpgrade: websocket\r\n"
            f"Connection: Upgrade\r\nSec-WebSocket-Key: {key}\r\nSec-WebSocket-Version: 13\r\n\r\n"
        ).encode())
        headers = b""
        while not headers.endswith(b"\r\n\r\n"):
            headers += receive_exact(connection, 1)
        assert b"101 Switching Protocols" in headers, headers
        payload = b"streaming-through-parent-and-enclave"
        mask = b"abcd"
        masked = bytes(value ^ mask[index % 4] for index, value in enumerate(payload))
        connection.sendall(bytes([0x81, 0x80 | len(payload)]) + mask + masked)
        assert receive_exact(connection, 2) == bytes([0x81, len(payload)])
        assert receive_exact(connection, len(payload)) == payload


def probe(expected):
    deadline = time.monotonic() + 150
    while True:
        try:
            counter = json.loads(request("GET", "/counter"))["count"]
            break
        except (OSError, AssertionError, http.client.HTTPException):
            if time.monotonic() > deadline:
                raise
            time.sleep(1)
    assert counter == expected, (counter, expected)
    for count in range(expected + 1, expected + 4):
        assert json.loads(request("POST", "/counter"))["count"] == count
    payload = bytes(range(256)) * 2048
    assert request("POST", "/echo", payload) == payload
    assert b"ListAllMyBucketsResult" in request("GET", "/outbound")
    websocket()
    print(json.dumps({"counter": expected + 3, "echoBytes": len(payload), "httpsEgress": True, "websocket": True}))


def orchestrate(image):
    repository = Path(__file__).resolve().parents[3]
    directory = Path(tempfile.mkdtemp(prefix="nitro-adapter-", dir=repository / ".artifacts"))
    test_image = "seams-nitro-test:" + uuid.uuid4().hex[:10]
    parent_name = "nitro-parent-" + uuid.uuid4().hex[:10]
    enclave_name = "nitro-enclave-" + uuid.uuid4().hex[:10]
    volume = "nitro-transport-" + uuid.uuid4().hex[:10]
    record = {"status": "running", "scope": "local celld adapter; Unix sockets substitute for VSOCK; no AWS execution"}
    try:
        for name in ("nitro.e2e.py", "nitro-socat.py", "nitro.worker.mjs", "single-vm.worker.mjs"):
            shutil.copyfile(Path(__file__).with_name(name), directory / name)
        (directory / "nitro-socat.py").chmod(0o755)
        (directory / "runtime.env").write_text("AWS_REGION=us-east-1\nCELLD_BUCKET=s3://nitro-fleet\nCELLD_R2_BUCKETS='{}'\n")
        # Bundle only the tiny test Worker; production runtime code stays unchanged.
        run(["pnpm", "exec", "esbuild", str(directory / "nitro.worker.mjs"), "--bundle", "--format=esm", f"--outfile={directory / 'worker.mjs'}"], cwd=repository)
        (directory / "wrangler.json").write_text(json.dumps({
            "name": "nitro-adapter-probe", "main": "./worker.mjs", "no_bundle": True,
            "durable_objects": {"bindings": [{"name": "COUNTER", "class_name": "Counter"}]},
            "migrations": [{"tag": "v1", "new_sqlite_classes": ["Counter"]}],
        }))
        run(["openssl", "req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "1",
             "-subj", "/CN=Nitro adapter test CA", "-addext", "basicConstraints=critical,CA:TRUE",
             "-keyout", str(directory / "ca.key"), "-out", str(directory / "ca.crt")])
        run(["openssl", "req", "-new", "-newkey", "rsa:2048", "-nodes",
             "-subj", "/CN=s3.us-east-1.amazonaws.com", "-keyout", str(directory / "certificate.key"),
             "-out", str(directory / "certificate.csr")])
        (directory / "certificate.ext").write_text(
            "basicConstraints=critical,CA:FALSE\nkeyUsage=critical,digitalSignature,keyEncipherment\n"
            "extendedKeyUsage=serverAuth\nsubjectAltName=DNS:s3.us-east-1.amazonaws.com\n"
        )
        run(["openssl", "x509", "-req", "-in", str(directory / "certificate.csr"), "-days", "1",
             "-CA", str(directory / "ca.crt"), "-CAkey", str(directory / "ca.key"), "-CAcreateserial",
             "-extfile", str(directory / "certificate.ext"), "-out", str(directory / "certificate.crt")])
        (directory / "Dockerfile").write_text(
            "ARG ADAPTER_IMAGE=seams-celld-nitro:local\nFROM ${ADAPTER_IMAGE}\n"
            "RUN apt-get update && apt-get install -y --no-install-recommends python3 python3-venv "
            "&& python3 -m venv /opt/test && /opt/test/bin/pip install 'moto[server]==5.1.14'\n"
            "COPY ca.crt /usr/local/share/ca-certificates/nitro-test.crt\n"
            "RUN update-ca-certificates\nCOPY nitro-socat.py /test-bin/socat\n"
            "ENV PATH=/test-bin:/opt/test/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin\n"
        )
        with (directory / "build.log").open("w") as output:
            subprocess.run(["docker", "build", "--platform", "linux/amd64", "--build-arg", f"ADAPTER_IMAGE={image}",
                            "-t", test_image, str(directory)], stdout=output, stderr=subprocess.STDOUT, check=True)
        record["imageId"] = run(["docker", "image", "inspect", image, "--format", "{{.Id}}"])
        record["launcherSha256"] = digest(repository / "deployment/celld/nitro/nitro.sh")
        run(["docker", "volume", "create", volume])
        shared = ["--platform", "linux/amd64", "--network", "none", "--cap-add", "NET_ADMIN",
                  "-v", f"{volume}:/transport", "-v", f"{directory}:/test:ro", "-v", f"{directory}:/results"]
        run(["docker", "run", "-d", "--name", parent_name, *shared, "--add-host", "s3.us-east-1.amazonaws.com:127.0.0.1",
             "-e", "NITRO_TEST_ROLE=parent", "--entrypoint", "/opt/test/bin/python", test_image, "/test/nitro.e2e.py", "parent"])
        for _attempt in range(120):
            running = run(["docker", "inspect", parent_name, "--format", "{{.State.Running}}"])
            if running != "true":
                raise RuntimeError(run(["docker", "logs", parent_name]))
            if subprocess.run(["docker", "exec", parent_name, "test", "-S", "/transport/parent-9000"], capture_output=True).returncode == 0:
                break
            time.sleep(1)
        else:
            raise RuntimeError("Parent did not start")
        observations = []
        for expected in (0, 3):
            run(["docker", "run", "-d", "--name", enclave_name, *shared, "-e", "NITRO_TEST_ROLE=enclave", test_image])
            observations.append(json.loads(run(["docker", "exec", parent_name, "/opt/test/bin/python", "/test/nitro.e2e.py", "probe", str(expected)])))
            # Kill the complete container, then create a replacement with no local state.
            run(["docker", "kill", enclave_name])
            (directory / f"enclave-{expected}.log").write_text(run(["docker", "logs", enclave_name]))
            run(["docker", "rm", enclave_name])
        requests = (directory / "metadata-requests.txt").read_text().splitlines()
        assert sum(line == "PUT /latest/api/token" for line in requests) >= 2
        record.update(status="passed", observations=observations, metadataRequests=len(requests))
    finally:
        for name in (enclave_name, parent_name):
            result = subprocess.run(["docker", "logs", name], capture_output=True, text=True)
            if result.returncode == 0:
                (directory / f"{name}.log").write_text(result.stdout + result.stderr)
            subprocess.run(["docker", "rm", "-f", name], capture_output=True)
        subprocess.run(["docker", "volume", "rm", volume], capture_output=True)
        if record["status"] == "running":
            record["status"] = "failed"
        (directory / "result.json").write_text(json.dumps(record, indent=2) + "\n")
        print(directory / "result.json")


if __name__ == "__main__":
    if len(sys.argv) == 2 and sys.argv[1] == "metadata":
        ThreadingHTTPServer(("169.254.169.254", 80), MetadataHandler).serve_forever()
    elif len(sys.argv) == 2 and sys.argv[1] == "parent":
        parent()
    elif len(sys.argv) == 3 and sys.argv[1] == "probe":
        probe(int(sys.argv[2]))
    elif len(sys.argv) == 2:
        orchestrate(sys.argv[1])
    else:
        raise SystemExit(__doc__)
