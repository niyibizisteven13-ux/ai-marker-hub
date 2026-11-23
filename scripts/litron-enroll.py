#!/usr/bin/python3 -I
"""Register a single public key on the managed IPv4 gateway."""
import base64
import fcntl
import ipaddress
import json
from pathlib import Path
import re
import subprocess
import sys

INTERFACE = "litron-wg"


def wg(*args):
    return subprocess.check_output(["/usr/bin/wg", *args], text=True).strip()


def assign(key, peers):
    occupied = []
    pool = ipaddress.ip_network("10.77.77.0/24")
    for line in peers.splitlines():
        peer, routes = line.split(maxsplit=1)
        networks = [ipaddress.ip_network(route) for route in re.split(r"[,\s]+", routes) if route != "(none)"]
        if peer == key:
            if len(networks) == 1 and networks[0].prefixlen == 32 and networks[0].subnet_of(pool):
                return str(networks[0]), False
            raise ValueError("Existing peer has incompatible routes")
        occupied.extend(networks)
    for addr in list(pool.hosts())[1:]:
        if all(addr not in network for network in occupied):
            return f"{addr}/32", True
    raise ValueError("Gateway is full")


def main():
    if len(sys.argv) != 2:
        raise ValueError("Expected one public key")
    key = sys.argv[1]
    raw = base64.b64decode(key, validate=True)
    if len(raw) != 32 or not any(raw) or base64.b64encode(raw).decode() != key:
        raise ValueError("Invalid public key")

    with open("/run/lock/litron-wireguard.lock", "a") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        host = Path("/etc/wireguard/litron-endpoint").read_text().strip()
        public = wg("show", INTERFACE, "public-key")
        port = wg("show", INTERFACE, "listen-port")
        if key == public or not re.fullmatch(r"[a-zA-Z0-9.-]+", host):
            raise ValueError("Invalid gateway or device")
        address, new = assign(key, wg("show", INTERFACE, "allowed-ips"))
        if new:
            wg("set", INTERFACE, "peer", key, "allowed-ips", address)
            try:
                subprocess.run(["/usr/bin/wg-quick", "save", INTERFACE], check=True, stdout=sys.stderr)
            except subprocess.CalledProcessError:
                wg("set", INTERFACE, "peer", key, "remove")
                raise
        print(json.dumps(dict(publicKey=public, endpoint=f"{host}:{port}", address=address)))


if __name__ == "__main__":
    main()
