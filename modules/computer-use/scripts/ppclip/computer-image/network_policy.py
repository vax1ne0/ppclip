#!/usr/bin/env python3
"""Install fail-closed egress rules before starting any unprivileged service.

Only the dedicated proxy uid can open external connections or resolve DNS.
Desktop/shell users can reach the local proxy, but cannot bypass its site/IP checks.
The entrypoint drops NET_ADMIN and SETPCAP before starting the desktop.
"""
import subprocess

PROXY_UID = 1002


def rules(binary):
    # Refuse new outbound traffic first; there are no desktop processes yet.
    return [
        [binary, "-w", "-P", "OUTPUT", "DROP"],
        [binary, "-w", "-F", "OUTPUT"],
        [binary, "-w", "-A", "OUTPUT", "-m", "owner", "--uid-owner", str(PROXY_UID), "-j", "ACCEPT"],
        # Docker DNATs resolver port 53 before the filter table sees the packet.
        *([[binary, "-w", "-A", "OUTPUT", "-d", "127.0.0.11", "-j", "REJECT"]] if binary == "iptables" else []),
        # Block DNS even to Docker's loopback resolver for all other users.
        *[[binary, "-w", "-A", "OUTPUT", "-p", protocol, "--dport", "53", "-j", "REJECT"] for protocol in ("udp", "tcp")],
        [binary, "-w", "-A", "OUTPUT", "-m", "conntrack", "--ctstate", "ESTABLISHED,RELATED", "-j", "ACCEPT"],
        [binary, "-w", "-A", "OUTPUT", "-o", "lo", "-j", "ACCEPT"],
    ]


def install():
    for binary in ("iptables", "ip6tables"):
        for command in rules(binary):
            subprocess.run(command, check=True, timeout=10)


if __name__ == "__main__":
    install()
