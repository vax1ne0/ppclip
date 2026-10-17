#!/usr/bin/env python3
"""ppclip computer: the sandbox browser's egress filter (HTTP proxy on 127.0.0.1:3128).

Every browser request goes through here (Chromium runs with --proxy-server and
--proxy-bypass-list=<-loopback>, so even localhost is proxied). Destinations are
resolved here and refused when the address is private, loopback, link-local,
CGNAT, multicast or a cloud-metadata endpoint, or when an allowlist is set and
the host is not on it. Checking the resolved address defeats DNS rebinding.
"""
import ipaddress, os, select, socket, threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlsplit

ALLOWED = [h for h in os.environ.get("PPCLIP_ALLOWED_HOSTS", "").split(",") if h]
BLOCKED_NAMES = {"localhost", "host.docker.internal", "gateway.docker.internal", "metadata.google.internal", "metadata"}
NAT64 = ipaddress.ip_network("64:ff9b::/96")  # IPv4 reached through a NAT64 prefix


def host_allowed(host):
    if not ALLOWED:
        return True
    h = host.lower()
    return any(h == r[2:] or h.endswith(r[1:]) if r.startswith("*.") else h == r for r in ALLOWED)


def resolve_public(host, port):
    if host.lower() in BLOCKED_NAMES or host.lower().endswith((".localhost", ".local", ".internal")):
        raise PermissionError("blocked host")
    if not host_allowed(host):
        raise PermissionError("not on this agent's allowlist")
    infos = socket.getaddrinfo(host, port, type=socket.SOCK_STREAM)
    for family, _, _, _, addr in infos:
        ip = ipaddress.ip_address(addr[0].split("%", 1)[0])
        # is_global is False for every private, shared, reserved, documentation and
        # test range; IPv6 forms that carry an IPv4 address are refused outright.
        if not ip.is_global or ip.is_multicast \
                or (ip.version == 6 and (ip.ipv4_mapped is not None or ip.sixtofour is not None or ip in NAT64)):
            raise PermissionError("private or local address")
    family, _, _, _, addr = infos[0]
    return family, addr


class Proxy(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, *args):
        pass

    def deny(self, why):
        body = f"Blocked by the ppclip sandbox: {why}\n".encode()
        self.send_response(403)
        self.send_header("content-type", "text/plain")
        self.send_header("content-length", str(len(body)))
        self.send_header("connection", "close")
        self.end_headers()
        self.wfile.write(body)

    def forward_body(self, upstream):
        """Send the request body through the parser's own buffer (rfile), never the raw socket,
        so bytes it has already read are not lost. Chunked bodies are relayed chunk by chunk."""
        if "chunked" in (self.headers.get("transfer-encoding") or "").lower():
            while True:
                size_line = self.rfile.readline(65537)
                upstream.sendall(size_line)
                size = int(size_line.split(b";", 1)[0].strip(), 16)
                if size == 0:
                    while True:  # optional trailers, then the blank line
                        line = self.rfile.readline(65537)
                        upstream.sendall(line)
                        if line in (b"\r\n", b"\n", b""):
                            return
                upstream.sendall(self.rfile.read(size + 2))
        length = int(self.headers.get("content-length") or 0)
        if length:
            upstream.sendall(self.rfile.read(length))

    def tunnel(self, upstream):
        sockets = [self.connection, upstream]
        try:
            while True:
                ready, _, _ = select.select(sockets, [], [], 120)
                if not ready:
                    return
                for s in ready:
                    data = s.recv(65536)
                    if not data:
                        return
                    (upstream if s is self.connection else self.connection).sendall(data)
        finally:
            upstream.close()

    def do_CONNECT(self):
        host, _, port = self.path.rpartition(":")
        try:
            family, addr = resolve_public(host.strip("[]"), int(port or 443))
            upstream = socket.socket(family, socket.SOCK_STREAM)
            upstream.settimeout(15)
            upstream.connect(addr)
            upstream.settimeout(None)
        except PermissionError as exc:
            return self.deny(str(exc))
        except OSError:
            self.send_error(502)
            return
        self.send_response(200, "Connection established")
        self.end_headers()
        self.tunnel(upstream)
        self.close_connection = True

    def do_plain(self):
        parts = urlsplit(self.path)
        if parts.scheme != "http" or not parts.hostname:
            return self.deny("only http(s) is allowed")
        try:
            family, addr = resolve_public(parts.hostname, parts.port or 80)
            upstream = socket.create_connection(addr[:2], timeout=15)
        except PermissionError as exc:
            return self.deny(str(exc))
        except OSError:
            self.send_error(502)
            return
        path = parts.path or "/"
        if parts.query:
            path += "?" + parts.query
        headers = "".join(f"{k}: {v}\r\n" for k, v in self.headers.items() if k.lower() not in ("proxy-connection", "connection", "keep-alive"))
        upstream.sendall(f"{self.command} {path} HTTP/1.1\r\n{headers}Connection: close\r\n\r\n".encode("latin-1"))
        try:
            self.forward_body(upstream)
        except ValueError:
            upstream.close()
            return self.deny("malformed request body")
        self.tunnel(upstream)
        self.close_connection = True

    do_GET = do_POST = do_PUT = do_DELETE = do_HEAD = do_OPTIONS = do_PATCH = do_plain


if __name__ == "__main__":
    ThreadingHTTPServer(("127.0.0.1", 3128), Proxy).serve_forever()
