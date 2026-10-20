#!/usr/bin/env python3
"""ppclip computer: runs shell commands as the unprivileged "sandbox" user (1001).

Listens on a Unix socket and only accepts the control daemon's user (1000),
checked with SO_PEERCRED. The sandbox user cannot read the agent user's
processes, X cookie, stream sockets or the control token. "killall" ends every
sandbox-user process (used when a person takes control).
"""
import json, os, signal, socket, struct, subprocess, threading

SOCK = "/tmp/ppclip-shell/shell.sock"
SANDBOX_UID = 1001
AGENT_UID = 1000
MAX_OUTPUT = 100_000
CLEAN_ENV = {"PATH": "/usr/local/bin:/usr/bin:/bin", "HOME": "/home/sandbox", "LANG": "C.UTF-8", "TERM": "dumb"}
for key in ("http_proxy", "https_proxy", "HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY"):
    CLEAN_ENV[key] = "http://127.0.0.1:3128"


def peer_uid(conn):
    data = conn.getsockopt(socket.SOL_SOCKET, socket.SO_PEERCRED, struct.calcsize("3i"))
    return struct.unpack("3i", data)[1]


def run(command, timeout):
    argv = ["setpriv", f"--reuid={SANDBOX_UID}", f"--regid={SANDBOX_UID}", "--clear-groups", "bash", "-lc", command]
    try:
        proc = subprocess.run(argv, cwd="/home/sandbox", env=CLEAN_ENV, stdin=subprocess.DEVNULL,
                              stdout=subprocess.PIPE, stderr=subprocess.STDOUT, timeout=timeout)
        return {"exitCode": proc.returncode, "output": proc.stdout[:MAX_OUTPUT].decode("utf-8", "replace")}
    except subprocess.TimeoutExpired as exc:
        out = (exc.stdout or b"")[:MAX_OUTPUT].decode("utf-8", "replace")
        return {"exitCode": 124, "output": out + "\n[timed out]"}


def killall():
    subprocess.run(["pkill", "-KILL", "-u", str(SANDBOX_UID)], check=False)
    return {"ok": True}


def handle(conn):
    with conn:
        if peer_uid(conn) != AGENT_UID:
            return
        raw = b""
        while not raw.endswith(b"\n") and len(raw) < 65536:
            chunk = conn.recv(4096)
            if not chunk:
                break
            raw += chunk
        try:
            req = json.loads(raw.decode("utf-8"))
        except ValueError:
            return
        if req.get("op") == "killall":
            res = killall()
        else:
            timeout = max(1, min(120, int(req.get("timeoutMs", 30000)) // 1000))
            res = run(str(req.get("command", ""))[:4000], timeout)
        conn.sendall((json.dumps(res) + "\n").encode("utf-8"))


def main():
    try:
        os.unlink(SOCK)
    except FileNotFoundError:
        pass
    srv = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
    srv.bind(SOCK)
    os.chmod(SOCK, 0o666)  # access is decided by SO_PEERCRED, not file mode
    srv.listen(8)
    signal.signal(signal.SIGTERM, lambda *_: os._exit(0))
    while True:
        conn, _ = srv.accept()
        threading.Thread(target=handle, args=(conn,), daemon=True).start()


if __name__ == "__main__":
    main()
