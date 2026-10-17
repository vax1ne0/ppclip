#!/usr/bin/env python3
"""ppclip computer: the in-sandbox control daemon (runs as "agent", uid 1000).

HTTP on :7070 (published to the host's 127.0.0.1 only), bearer token required
except for GET /ping. It also launches Chromium and talks to it over
--remote-debugging-pipe, so no debugging port exists for page code or the
sandbox shell user to reach.

Input uses xdotool with argv built here from validated values, never a shell.
While a person holds control the daemon is locked: /act, /page/act and /shell
are refused and every sandbox-user process is killed.
"""
import base64, fcntl, hashlib, json, os, re, socket, subprocess, threading, time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

TOKEN = os.environ.get("PPCLIP_CONTROL_TOKEN", "")
SHELL_ENABLED = os.environ.get("PPCLIP_SHELL") == "1"
RUN = "/tmp/ppclip"
W = int(os.environ.get("SCREEN_WIDTH", "1280"))
H = int(os.environ.get("SCREEN_HEIGHT", "800"))
ENV = {**os.environ, "DISPLAY": ":1", "XAUTHORITY": f"{RUN}/Xauthority", "HOME": "/home/agent"}
PROFILE = os.environ.get("PPCLIP_PROFILE_DIR", "/home/agent/chromium-profile")
CHROMIUM = os.environ.get("PPCLIP_CHROMIUM", "chromium")
# Extra flags, used only by the offline self-test (e.g. --headless=new outside the image).
CHROMIUM_EXTRA = [f for f in os.environ.get("PPCLIP_CHROMIUM_EXTRA", "").split() if f]
ENV.pop("PPCLIP_CONTROL_TOKEN", None)
KEY_RE = re.compile(r"^[A-Za-z0-9_]+(\+[A-Za-z0-9_]+)*$")
STATE = {"locked": False, "control_proc": None}
LOCK = threading.Lock()


class Refused(Exception):
    def __init__(self, code, message, status=409):
        super().__init__(message)
        self.code, self.message, self.status = code, message, status


# ---------------------------------------------------------------- Chromium + CDP over a pipe
class Browser:
    """Launches Chromium with --remote-debugging-pipe and speaks CDP over fds 3/4."""

    def __init__(self):
        self.proc = None
        self.write_fd = None
        self.next_id = 0
        self.pending = {}
        self.session = None
        self.world = None  # (contextId, url) of the isolated world holding element refs
        self.mutex = threading.Lock()
        threading.Thread(target=self._keepalive, daemon=True).start()

    def _launch(self):
        cmd_r, cmd_w = os.pipe()   # we write commands, Chromium reads fd 3
        out_r, out_w = os.pipe()   # Chromium writes fd 4, we read
        def child():
            # Move both ends above 9 first so dup2 onto 3/4 can never clobber the other.
            a = fcntl.fcntl(cmd_r, fcntl.F_DUPFD, 10)
            b = fcntl.fcntl(out_w, fcntl.F_DUPFD, 10)
            os.dup2(a, 3)
            os.dup2(b, 4)
        for name in os.listdir(PROFILE) if os.path.isdir(PROFILE) else []:
            if name.startswith("Singleton"):
                try:
                    os.unlink(os.path.join(PROFILE, name))
                except OSError:
                    pass
        self.proc = subprocess.Popen([
            CHROMIUM, *CHROMIUM_EXTRA, "--no-sandbox", "--no-first-run", "--no-default-browser-check", "--password-store=basic",
            f"--user-data-dir={PROFILE}", "--remote-debugging-pipe",
            "--proxy-server=http://127.0.0.1:3128", "--proxy-bypass-list=<-loopback>",
            "--window-position=0,0", f"--window-size={W},{H}", "--start-maximized",
            "--disable-features=Translate,MediaRouter", "--disable-background-networking", "about:blank",
        ], env=ENV, preexec_fn=child, pass_fds=(3, 4), stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        os.close(cmd_r)
        os.close(out_w)
        self.write_fd = cmd_w
        self.session = None
        self.world = None
        threading.Thread(target=self._reader, args=(out_r,), daemon=True).start()

    def _keepalive(self):
        while True:
            if self.proc is None or self.proc.poll() is not None:
                try:
                    self._launch()
                except Exception:
                    pass
            time.sleep(1)

    def _reader(self, fd):
        buf = b""
        while True:
            try:
                chunk = os.read(fd, 65536)
            except OSError:
                break
            if not chunk:
                break
            buf += chunk
            while b"\0" in buf:
                raw, buf = buf.split(b"\0", 1)
                try:
                    msg = json.loads(raw)
                except ValueError:
                    continue
                if "id" in msg and msg["id"] in self.pending:
                    holder = self.pending[msg["id"]]
                    holder["msg"] = msg
                    holder["event"].set()
                elif msg.get("method") in ("Target.detachedFromTarget", "Target.targetDestroyed"):
                    self.session = None
                    self.world = None
        os.close(fd)

    def send(self, method, params=None, session=None, timeout=15):
        with self.mutex:
            self.next_id += 1
            mid = self.next_id
            holder = {"event": threading.Event(), "msg": None}
            self.pending[mid] = holder
            payload = {"id": mid, "method": method, "params": params or {}}
            if session:
                payload["sessionId"] = session
            if self.write_fd is None:
                raise Refused("unavailable", "The browser is starting.")
            os.write(self.write_fd, json.dumps(payload).encode("utf-8") + b"\0")
        try:
            if not holder["event"].wait(timeout):
                raise Refused("unavailable", f"The browser did not answer {method}.")
            msg = holder["msg"]
            if "error" in msg:
                raise Refused("unavailable", f"{method}: {msg['error'].get('message', 'failed')}")
            return msg.get("result", {})
        finally:
            self.pending.pop(mid, None)

    def page_target(self):
        targets = self.send("Target.getTargets").get("targetInfos", [])
        pages = [t for t in targets if t.get("type") == "page"]
        return pages[0] if pages else None

    def page_session(self):
        if self.session:
            return self.session
        target = self.page_target()
        if not target:
            target = {"targetId": self.send("Target.createTarget", {"url": "about:blank"})["targetId"]}
        self.session = self.send("Target.attachToTarget", {"targetId": target["targetId"], "flatten": True})["sessionId"]
        self.send("Page.enable", session=self.session)
        return self.session

    def new_world(self):
        """A fresh isolated world: page scripts cannot see or tamper with our element refs."""
        s = self.page_session()
        frame = self.send("Page.getFrameTree", session=s)["frameTree"]["frame"]
        ctx = self.send("Page.createIsolatedWorld", {"frameId": frame["id"], "worldName": "ppclip"}, session=s)["executionContextId"]
        self.world = (ctx, frame.get("url"))
        return ctx

    def evaluate(self, expression, ctx=None):
        s = self.page_session()
        params = {"expression": expression, "returnByValue": True, "awaitPromise": True}
        if ctx is not None:
            params["contextId"] = ctx
        res = self.send("Runtime.evaluate", params, session=s)
        if res.get("exceptionDetails"):
            raise Refused("stale_ref", "The page changed. Call browser_page again.")
        return res.get("result", {}).get("value")

    def info(self):
        try:
            t = self.page_target()
            return (t.get("url"), t.get("title")) if t else (None, None)
        except Exception:
            return (None, None)


BROWSER = Browser()

SNAPSHOT_JS = r"""
(() => {
  const sel = 'a[href],button,input:not([type=hidden]),select,textarea,summary,[role=button],[role=link],[role=textbox],[role=checkbox],[role=radio],[role=menuitem],[role=tab],[role=combobox],[role=switch],[contenteditable=""],[contenteditable=true],[tabindex]:not([tabindex="-1"])';
  const refs = [], out = [];
  for (const el of document.querySelectorAll(sel)) {
    const r = el.getBoundingClientRect();
    if (r.width < 4 || r.height < 4 || r.bottom < 0 || r.right < 0 || r.top > innerHeight || r.left > innerWidth) continue;
    const cs = getComputedStyle(el);
    if (cs.visibility === 'hidden' || cs.display === 'none' || Number(cs.opacity) === 0) continue;
    const type = el.tagName === 'INPUT' ? (el.getAttribute('type') || 'text').toLowerCase() : null;
    const ac = (el.getAttribute('autocomplete') || '').toLowerCase();
    const sensitive = type === 'password' || /current-password|new-password|one-time-code|cc-number|cc-csc/.test(ac);
    const label = el.getAttribute('aria-label') || (el.labels && el.labels[0] && el.labels[0].innerText) || el.getAttribute('placeholder') || el.getAttribute('title')
      || (el.tagName === 'INPUT' ? (sensitive ? '' : (type === 'submit' || type === 'button' ? el.value : '')) : el.innerText) || el.getAttribute('name') || '';
    refs.push(el);
    out.push({ tag: el.tagName.toLowerCase(), role: el.getAttribute('role'), name: String(label).trim().replace(/\s+/g, ' ').slice(0, 100), inputType: type, sensitive,
      box: [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)] });
    if (refs.length >= 150) break;
  }
  window.__ppclipRefs = refs;
  const text = (document.body ? document.body.innerText : '').replace(/\n{3,}/g, '\n\n').slice(0, 12000);
  return JSON.stringify({ url: location.href, title: document.title, text, elements: out });
})()
"""

MARKS_JS = r"""
(() => {
  const host = document.createElement('div');
  host.id = '__ppclip_marks';
  host.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:2147483647';
  (window.__ppclipRefs || []).forEach((el, i) => {
    const r = el.getBoundingClientRect();
    const box = document.createElement('div');
    box.style.cssText = `position:fixed;left:${r.left}px;top:${r.top}px;width:${r.width}px;height:${r.height}px;outline:2px solid #e11d48`;
    const tag = document.createElement('span');
    tag.textContent = String(i + 1);
    tag.style.cssText = 'position:absolute;left:-2px;top:-16px;background:#e11d48;color:#fff;font:bold 11px sans-serif;padding:1px 3px;border-radius:3px';
    box.appendChild(tag);
    host.appendChild(box);
  });
  document.documentElement.appendChild(host);
  return true;
})()
"""

UNMARK_JS = "(() => { const m = document.getElementById('__ppclip_marks'); if (m) m.remove(); return true; })()"

ELEMENT_JS = r"""
(() => {
  const el = (window.__ppclipRefs || [])[%d];
  if (!el || !el.isConnected) return null;
  el.scrollIntoView({ block: 'center', inline: 'center' });
  const r = el.getBoundingClientRect();
  const type = el.tagName === 'INPUT' ? (el.getAttribute('type') || 'text').toLowerCase() : null;
  const ac = (el.getAttribute('autocomplete') || '').toLowerCase();
  const label = el.getAttribute('aria-label') || el.getAttribute('title') || (type === 'submit' || type === 'button' ? el.value : '') || el.innerText || '';
  if (%s) el.focus();
  return JSON.stringify({ x: r.left + r.width / 2, y: r.top + r.height / 2, name: String(label).trim().slice(0, 200),
    sensitive: type === 'password' || /current-password|new-password|one-time-code|cc-number|cc-csc/.test(ac) });
})()
"""

POINT_JS = r"""
(() => {
  const vx = %d - window.screenX - (window.outerWidth - window.innerWidth);
  const vy = %d - window.screenY - (window.outerHeight - window.innerHeight);
  const el = document.elementFromPoint(vx, vy);
  if (!el) return null;
  const t = el.closest('button,a,[role=button],[role=link],input,label,summary') || el;
  const type = t.tagName === 'INPUT' ? (t.getAttribute('type') || 'text').toLowerCase() : null;
  const label = t.getAttribute('aria-label') || t.getAttribute('title') || (type === 'submit' || type === 'button' ? t.value : '') || t.innerText || '';
  return JSON.stringify({ name: String(label).trim().slice(0, 200), password: type === 'password' });
})()
"""

ACTIVE_JS = r"""
(() => {
  const el = document.activeElement;
  if (!el || el.tagName !== 'INPUT') return false;
  const type = (el.getAttribute('type') || 'text').toLowerCase();
  const ac = (el.getAttribute('autocomplete') || '').toLowerCase();
  return type === 'password' || /current-password|new-password|one-time-code|cc-number|cc-csc/.test(ac);
})()
"""


def browser_try(fn, default=None):
    try:
        return fn()
    except Exception:
        return default


# ---------------------------------------------------------------- desktop actions
def screenshot():
    png = subprocess.run(["import", "-display", ":1", "-window", "root", "png:-"], env=ENV, capture_output=True, timeout=15).stdout
    if not png:
        raise Refused("unavailable", "Could not capture the screen.")
    return png


def xdo(*args):
    subprocess.run(["xdotool", *[str(a) for a in args]], env=ENV, check=True, timeout=30, capture_output=True)


def clamp(v, hi):
    return max(0, min(hi - 1, int(round(float(v)))))


def act(actions, confirm, pattern):
    irreversible = re.compile(pattern, re.I)
    done = 0
    for a in actions[:16]:
        t = a.get("type")
        if t == "click":
            x, y = clamp(a["x"], W), clamp(a["y"], H)
            target = browser_try(lambda: json.loads(BROWSER.evaluate(POINT_JS % (x, y)) or "null"))
            if target and irreversible.search(target.get("name", "")) and not confirm:
                return {"ok": False, "code": "needs_confirm", "message": f"\"{target['name'][:80]}\" looks irreversible. Repeat with confirm: true only if your task requires it.", "done": done}
            button = {"left": 1, "middle": 2, "right": 3}.get(a.get("button"), 1)
            xdo("mousemove", "--sync", x, y, "click", *(["--repeat", "2"] if a.get("double") else []), button)
        elif t == "move":
            xdo("mousemove", "--sync", clamp(a["x"], W), clamp(a["y"], H))
        elif t == "drag":
            xdo("mousemove", "--sync", clamp(a["x"], W), clamp(a["y"], H), "mousedown", 1,
                "mousemove", "--sync", clamp(a["toX"], W), clamp(a["toY"], H), "mouseup", 1)
        elif t == "type":
            if browser_try(lambda: BROWSER.evaluate(ACTIVE_JS), False):
                return {"ok": False, "code": "sensitive_field", "message": "The focused field is a password or one-time-code field. Ask for a person with computer_request_takeover.", "done": done}
            text = str(a.get("text", ""))[:2000]
            xdo("type", "--delay", "12", "--", text)
        elif t == "key":
            key = str(a.get("key", ""))
            if not KEY_RE.match(key) or len(key) > 40:
                raise Refused("invalid", "invalid key", 400)
            xdo("key", "--", key)
        elif t == "scroll":
            button = {"up": 4, "down": 5, "left": 6, "right": 7}.get(a.get("direction"), 5)
            amount = max(1, min(20, int(a.get("amount", 3))))
            xdo("mousemove", "--sync", clamp(a["x"], W), clamp(a["y"], H), "click", "--repeat", amount, button)
        elif t == "wait":
            time.sleep(max(50, min(5000, int(a.get("ms", 500)))) / 1000)
        else:
            raise Refused("invalid", f"unknown action {t}", 400)
        done += 1
    return {"ok": True, "done": done}


def page(marks):
    ctx = BROWSER.new_world()
    snap = json.loads(BROWSER.evaluate(SNAPSHOT_JS, ctx))
    elements = []
    for i, e in enumerate(snap["elements"]):
        elements.append({"ref": i + 1, "tag": e["tag"], "role": e["role"], "name": e["name"], "inputType": e["inputType"],
                         "sensitive": e["sensitive"], "irreversible": False})
    result = {"url": snap["url"], "title": snap["title"], "text": snap["text"], "elements": elements}
    if marks:
        BROWSER.evaluate(MARKS_JS, ctx)
        time.sleep(0.15)
        try:
            result["marksPng"] = base64.b64encode(screenshot()).decode("ascii")
        finally:
            browser_try(lambda: BROWSER.evaluate(UNMARK_JS, ctx))
    return result


def mouse_click(x, y):
    s = BROWSER.page_session()
    for kind in ("mouseMoved", "mousePressed", "mouseReleased"):
        BROWSER.send("Input.dispatchMouseEvent", {"type": kind, "x": x, "y": y, "button": "left", "clickCount": 1}, session=s)


def page_act(action, confirm, pattern):
    t = action.get("type")
    if t == "navigate":
        url = str(action.get("url", ""))
        if not re.match(r"^https?://", url):
            raise Refused("blocked_url", "Only http(s) addresses can be opened.")
        BROWSER.send("Page.navigate", {"url": url}, session=BROWSER.page_session(), timeout=30)
        for _ in range(40):
            if browser_try(lambda: BROWSER.evaluate("document.readyState")) == "complete":
                break
            time.sleep(0.25)
        BROWSER.world = None
        return {"ok": True, "done": 1}
    if t == "back":
        BROWSER.evaluate("history.back()")
        BROWSER.world = None
        return {"ok": True, "done": 1}
    if not BROWSER.world:
        return {"ok": False, "code": "stale_ref", "message": "Call browser_page first.", "done": 0}
    ref = int(action.get("ref", 0))
    raw = BROWSER.evaluate(ELEMENT_JS % (ref - 1, "true" if t == "type" else "false"), BROWSER.world[0])
    if not raw:
        return {"ok": False, "code": "stale_ref", "message": f"Element {ref} is not on the current page. Call browser_page again.", "done": 0}
    el = json.loads(raw)
    if t == "click":
        if re.search(pattern, el["name"], re.I) and not confirm:
            return {"ok": False, "code": "needs_confirm", "message": f"\"{el['name'][:80]}\" looks irreversible. Repeat with confirm: true only if your task requires it.", "done": 0}
        mouse_click(el["x"], el["y"])
        return {"ok": True, "done": 1}
    if t == "type":
        if el["sensitive"]:
            return {"ok": False, "code": "sensitive_field", "message": "That is a password or one-time-code field. Ask for a person with computer_request_takeover.", "done": 0}
        s = BROWSER.page_session()
        BROWSER.send("Input.insertText", {"text": str(action.get("text", ""))[:2000]}, session=s)
        if action.get("submit"):
            for kind in ("keyDown", "keyUp"):
                BROWSER.send("Input.dispatchKeyEvent", {"type": kind, "key": "Enter", "code": "Enter", "windowsVirtualKeyCode": 13, **({"text": "\r"} if kind == "keyDown" else {})}, session=s)
        return {"ok": True, "done": 1}
    raise Refused("invalid", "invalid page action", 400)


# ---------------------------------------------------------------- streams and lock
def write_token(name, token, sock):
    path = f"{RUN}/tokens/{name}"
    if token:
        tmp = path + ".tmp"
        with open(tmp, "w") as f:
            f.write(f"{token}: unix_socket:{sock}\n")
        os.replace(tmp, path)
    else:
        try:
            os.unlink(path)
        except FileNotFoundError:
            pass


def shell_request(payload, timeout=130):
    s = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
    s.settimeout(timeout)
    try:
        s.connect("/tmp/ppclip-shell/shell.sock")
        s.sendall((json.dumps(payload) + "\n").encode("utf-8"))
        data = b""
        while not data.endswith(b"\n"):
            chunk = s.recv(65536)
            if not chunk:
                break
            data += chunk
        return json.loads(data.decode("utf-8"))
    finally:
        s.close()


def set_control(token):
    with LOCK:
        proc = STATE["control_proc"]
        if token:
            # A person takes over: lock the agent out and end anything the agent's shell started.
            STATE["locked"] = True
            if SHELL_ENABLED:
                browser_try(lambda: shell_request({"op": "killall"}, timeout=10))
            if proc is None or proc.poll() is not None:
                sock = f"{RUN}/control.sock"
                STATE["control_proc"] = subprocess.Popen(
                    ["x11vnc", "-display", ":1", "-rfbport", "0", "-unixsock", sock, "-forever", "-nopw", "-quiet", "-noxdamage"],
                    env=ENV, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
                for _ in range(50):
                    if os.path.exists(sock):
                        break
                    time.sleep(0.1)
            write_token("control", token, f"{RUN}/control.sock")
        else:
            write_token("control", None, "")
            if proc is not None and proc.poll() is None:
                proc.kill()
            STATE["control_proc"] = None
            STATE["locked"] = False


# ---------------------------------------------------------------- HTTP
class Handler(BaseHTTPRequestHandler):
    server_version = "ppclip-computer"

    def log_message(self, *args):  # no request logging: keep typed text and URLs out of logs
        pass

    def reply(self, status, body):
        data = json.dumps(body).encode("utf-8")
        self.send_response(status)
        self.send_header("content-type", "application/json")
        self.send_header("content-length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        if self.path == "/ping":
            return self.reply(200, {"ok": True})
        return self.reply(404, {"error": "not found"})

    def do_POST(self):
        presented = (self.headers.get("authorization") or "").replace("Bearer ", "", 1)
        if not TOKEN or not hashlib.sha256(presented.encode()).digest() == hashlib.sha256(TOKEN.encode()).digest():
            return self.reply(401, {"error": "unauthorized"})
        length = min(int(self.headers.get("content-length") or 0), 1_000_000)
        try:
            body = json.loads(self.rfile.read(length) or b"{}")
        except ValueError:
            return self.reply(400, {"error": "invalid JSON"})
        pattern = str(body.get("irreversiblePattern", "(?!)"))[:2000]
        try:
            if self.path == "/health":
                return self.reply(200, {"ok": True, "browser": BROWSER.proc is not None and BROWSER.proc.poll() is None})
            if self.path == "/observe":
                png = screenshot()
                url, title = BROWSER.info()
                return self.reply(200, {"frameId": hashlib.sha256(png).hexdigest()[:16], "width": W, "height": H,
                                        "png": base64.b64encode(png).decode("ascii"), "url": url, "title": title})
            if self.path == "/page":
                return self.reply(200, page(body.get("marks") is True))
            if self.path == "/stream/view":
                write_token("view", str(body.get("token") or ""), f"{RUN}/view.sock")
                return self.reply(200, {"ok": True})
            if self.path == "/stream/control":
                set_control(body.get("token") or None)
                return self.reply(200, {"ok": True})
            if STATE["locked"]:
                raise Refused("human_has_control", "A person has control of this computer.")
            if self.path == "/act":
                return self.reply(200, act(body.get("actions") or [], body.get("confirm") is True, pattern))
            if self.path == "/page/act":
                return self.reply(200, page_act(body.get("action") or {}, body.get("confirm") is True, pattern))
            if self.path == "/shell":
                if not SHELL_ENABLED:
                    raise Refused("not_allowed", "Shell is not enabled for this computer.", 403)
                timeout_ms = max(1000, min(120_000, int(body.get("timeoutMs", 30_000))))
                return self.reply(200, shell_request({"command": str(body.get("command", ""))[:4000], "timeoutMs": timeout_ms}, timeout_ms / 1000 + 10))
            return self.reply(404, {"error": "not found"})
        except Refused as exc:
            return self.reply(exc.status, {"error": exc.message, "code": exc.code})
        except subprocess.CalledProcessError:
            return self.reply(409, {"error": "The desktop refused the input.", "code": "unavailable"})
        except Exception as exc:  # noqa: BLE001
            return self.reply(500, {"error": str(exc)[:300], "code": "unavailable"})


if __name__ == "__main__":
    ThreadingHTTPServer(("0.0.0.0", 7070), Handler).serve_forever()
