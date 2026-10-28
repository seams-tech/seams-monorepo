#!/usr/bin/python3
"""Replace only VSOCK addresses with shared Unix sockets for the offline E2E."""

import os
import sys


def translate(address):
    fields = address.split(",")
    endpoint = fields[0].split(":")
    options = [field for field in fields[1:] if field != "reuseaddr"]
    if endpoint[0] == "VSOCK-LISTEN":
        role = os.environ["NITRO_TEST_ROLE"]
        return ",".join([
            f"UNIX-LISTEN:/transport/{role}-{endpoint[1]}",
            "unlink-early",
            *options,
        ])
    if endpoint[0] == "VSOCK-CONNECT":
        role = {"3": "parent", "16": "enclave"}[endpoint[1]]
        return f"UNIX-CONNECT:/transport/{role}-{endpoint[2]}"
    return address


os.execv("/usr/bin/socat", ["socat", *map(translate, sys.argv[1:])])
