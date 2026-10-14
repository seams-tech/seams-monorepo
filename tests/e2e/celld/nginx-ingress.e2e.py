"""Verify the real TLS proxy replaces spoofed client identity and limits bodies.

Usage: python3 nginx-ingress.e2e.py NGINX NGINX_TEMPLATE
Only loopback listeners and a one-day synthetic certificate are used.
"""

import hashlib
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import http.client
import json
from pathlib import Path
import shutil
import signal
import socket
import ssl
import subprocess
import sys
import tempfile
import threading
import time


class Backend(BaseHTTPRequestHandler):
    def do_POST(self):
        body = self.rfile.read(int(self.headers["content-length"]))
        observed = {
            "headers": dict(self.headers.items()),
            "bytes": len(body),
            "bodySha256": hashlib.sha256(body).hexdigest(),
        }
        self.server.requests.append(observed)
        encoded = json.dumps(observed).encode()
        self.send_response(200)
        self.send_header("Content-Length", str(len(encoded)))
        self.end_headers()
        self.wfile.write(encoded)

    def log_message(self, format, *args):
        pass


def request(port, context, body, headers):
    connection = http.client.HTTPSConnection(
        "gateway.example.com", port, context=context, timeout=10
    )
    connection.sock = context.wrap_socket(
        socket.create_connection(("127.0.0.1", port), timeout=10),
        server_hostname="gateway.example.com",
    )
    try:
        connection.request("POST", "/inspect", body=body, headers=headers)
        response = connection.getresponse()
        return response.status, response.read()
    finally:
        connection.close()


def main():
    if len(sys.argv) != 3:
        raise SystemExit(__doc__)
    binary, template = [Path(value).resolve() for value in sys.argv[1:]]
    repository = Path(__file__).resolve().parents[3]
    root = Path(
        tempfile.mkdtemp(prefix="nginx-ingress-", dir=repository / ".artifacts")
    )
    root.chmod(0o700)
    shutil.copyfile(__file__, root / "effective-driver.py")
    shutil.copyfile(template, root / "nginx-template.conf")
    result = {
        "status": "running",
        "nginxSha256": hashlib.sha256(binary.read_bytes()).hexdigest(),
        "templateSha256": hashlib.sha256(template.read_bytes()).hexdigest(),
    }
    process = None
    print(root, flush=True)
    with ThreadingHTTPServer(("127.0.0.1", 0), Backend) as backend:
        backend.requests = []
        thread = threading.Thread(target=backend.serve_forever)
        thread.start()
        try:
            with socket.socket() as listener:
                listener.bind(("127.0.0.1", 0))
                port = listener.getsockname()[1]
            with (root / "certificate.log").open("w") as log:
                subprocess.run(
                    [
                        "openssl",
                        "req",
                        "-x509",
                        "-newkey",
                        "rsa:2048",
                        "-nodes",
                        "-days",
                        "1",
                        "-subj",
                        "/CN=gateway.example.com",
                        "-addext",
                        "subjectAltName=DNS:gateway.example.com",
                        "-keyout",
                        str(root / "key.pem"),
                        "-out",
                        str(root / "certificate.pem"),
                    ],
                    check=True,
                    stdout=log,
                    stderr=log,
                )
            config = template.read_text().replace(
                "listen 443 ssl;", f"listen 127.0.0.1:{port} ssl;"
            )
            config = config.replace(
                "http://127.0.0.1:8080", f"http://127.0.0.1:{backend.server_port}"
            )
            config = config.replace(
                "/etc/seams/tls/gateway.crt", str(root / "certificate.pem")
            )
            config = config.replace("/etc/seams/tls/gateway.key", str(root / "key.pem"))
            config = (
                f"pid {root}/nginx.pid;\nerror_log stderr;\nevents {{ worker_connections 32; }}\n"
                f"http {{ access_log off; client_body_temp_path {root}/body; proxy_temp_path {root}/proxy;\n"
                + config
                + "\n}\n"
            )
            (root / "nginx.conf").write_text(config)
            with (root / "nginx.log").open("w") as log:
                subprocess.run(
                    [
                        str(binary),
                        "-p",
                        str(root),
                        "-t",
                        "-c",
                        str(root / "nginx.conf"),
                    ],
                    check=True,
                    stdout=log,
                    stderr=log,
                )
                process = subprocess.Popen(
                    [
                        str(binary),
                        "-p",
                        str(root),
                        "-c",
                        str(root / "nginx.conf"),
                        "-g",
                        "daemon off; master_process off;",
                    ],
                    stdout=log,
                    stderr=log,
                )
            for _ in range(100):
                assert process.poll() is None, "Nginx stopped before readiness"
                try:
                    with socket.create_connection(("127.0.0.1", port), timeout=0.1):
                        break
                except OSError:
                    time.sleep(0.05)
            else:
                raise AssertionError("Nginx did not listen")
            context = ssl.create_default_context(cafile=str(root / "certificate.pem"))
            body = b"wallet-ingress" * 4096
            headers = {
                "Host": "gateway.example.com",
                "CF-Connecting-IP": "203.0.113.7",
                "X-Forwarded-For": "198.51.100.4, 10.0.0.1",
                "X-Real-IP": "192.0.2.9",
                "Forwarded": "for=192.0.2.9;proto=http",
                "X-Forwarded-Host": "attacker.invalid",
                "X-Forwarded-Proto": "http",
            }
            status, response = request(port, context, body, headers)
            assert status == 200, status
            observed = json.loads(response)
            result["forwarded"] = observed
            normalized = {
                name.lower(): value for name, value in observed["headers"].items()
            }
            for name in ("cf-connecting-ip", "x-forwarded-for", "x-real-ip"):
                assert normalized[name] == "127.0.0.1", (name, normalized[name])
            assert "forwarded" not in normalized
            assert normalized["x-forwarded-host"] == "gateway.example.com"
            assert normalized["x-forwarded-proto"] == "https"
            assert observed["bytes"] == len(body)
            assert observed["bodySha256"] == hashlib.sha256(body).hexdigest()
            status, _ = request(
                port, context, b"x" * (1048576 + 1), {"Host": "gateway.example.com"}
            )
            assert status == 413, status
            assert len(backend.requests) == 1, "Oversized body reached the backend"
            result["oversizedBody"] = {
                "status": status,
                "backendRequests": len(backend.requests),
            }
            result["status"] = "passed"
        except Exception as error:
            result["status"] = "failed"
            result["error"] = repr(error)
            raise
        finally:
            if process is not None and process.poll() is None:
                process.send_signal(signal.SIGQUIT)
                try:
                    process.wait(timeout=10)
                except subprocess.TimeoutExpired:
                    process.kill()
                    process.wait()
            result["nginxExitCode"] = (
                process.returncode if process is not None else None
            )
            if process is not None and process.returncode != 0:
                result["status"] = "failed"
            backend.shutdown()
            thread.join()
            (root / "result.json").write_text(json.dumps(result, indent=2) + "\n")
    assert result["status"] == "passed"


if __name__ == "__main__":
    main()
