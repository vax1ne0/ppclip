import http, { type IncomingMessage, type ServerResponse } from "node:http";
import net from "node:net";
import { timingSafeEqual } from "node:crypto";
import { WebSocket, WebSocketServer } from "ws";
import { ProviderError, parseActions, type ComputerProvider, type PageAction } from "./provider.js";
import { DEFAULT_SUPERVISOR_PORT } from "./config.js";

/**
 * ppclip computer supervisor: the only process that talks to Docker (or the
 * remote provider). Paperclip calls it over HTTP with a bearer token. It
 * listens on loopback only unless explicitly told otherwise.
 *
 * Routes (all need `Authorization: Bearer <token>`):
 *   GET  /health
 *   POST /computers/:agentId/ensure       {companyId, shell, allowedHosts}
 *   GET  /computers/:agentId
 *   POST /computers/:agentId/stop | /freeze | /thaw
 *   DELETE /computers/:agentId?purgeProfile=1
 *   POST /computers/:agentId/observe | /act | /page | /page/act | /control | /shell
 *   GET  /computers/:agentId/stream/:mode/*   noVNC files and the websockify WebSocket (view | control)
 */

type SupervisorOptions = { provider: ComputerProvider; token: string; host?: string; port?: number; allowRemote?: boolean };

const LOOPBACK = new Set(["127.0.0.1", "::1", "localhost"]);

function tokenMatches(header: string | undefined, token: string) {
  const presented = header?.replace(/^Bearer\s+/i, "") ?? "";
  const a = Buffer.from(presented);
  const b = Buffer.from(token);
  return a.length === b.length && timingSafeEqual(a, b);
}

function send(res: ServerResponse, status: number, body: unknown) {
  const payload = JSON.stringify(body);
  res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" });
  res.end(payload);
}

async function readJson(req: IncomingMessage, limit = 256 * 1024): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > limit) throw new ProviderError("invalid", "request body too large", 400);
    chunks.push(chunk as Buffer);
  }
  if (!size) return {};
  try {
    const parsed = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    throw new ProviderError("invalid", "invalid JSON", 400);
  }
}

const ROUTE = /^\/computers\/([A-Za-z0-9-]{1,64})(?:\/(.*))?$/;
const STREAM = /^stream\/(view|control)\/(.*)$/;
const STATIC_FILE = /^[A-Za-z0-9_./-]{0,200}$/;

export function createSupervisorServer(opts: SupervisorOptions) {
  const { provider, token } = opts;
  if (!token || token.length < 32) throw new Error("The supervisor token must be at least 32 characters.");
  const wss = new WebSocketServer({ noServer: true, maxPayload: 8 * 1024 * 1024 });

  async function handle(req: IncomingMessage, res: ServerResponse) {
    if (!tokenMatches(req.headers.authorization, token)) return send(res, 401, { error: "unauthorized" });
    const url = new URL(req.url ?? "/", "http://supervisor");
    if (url.pathname === "/health" && req.method === "GET") return send(res, 200, { ok: true, provider: provider.describe() });
    const m = ROUTE.exec(url.pathname);
    if (!m) return send(res, 404, { error: "not found" });
    const agentId = m[1]!;
    const rest = m[2] ?? "";
    const stream = STREAM.exec(rest);
    if (stream && req.method === "GET") return proxyStatic(agentId, stream[1] as "view" | "control", stream[2]!, url.search, res);
    const body = req.method === "POST" ? await readJson(req) : {};
    const key = `${req.method} ${rest}`;
    switch (key) {
      case "POST ensure": {
        const companyId = typeof body.companyId === "string" ? body.companyId : "";
        const allowedHosts = Array.isArray(body.allowedHosts) ? body.allowedHosts.filter((h): h is string => typeof h === "string") : [];
        return send(res, 200, await provider.ensure({ agentId, companyId, shell: body.shell === true, allowedHosts }));
      }
      case "GET ":
        return send(res, 200, { computer: await provider.inspect(agentId) });
      case "POST stop":
        await provider.stop(agentId);
        return send(res, 200, { ok: true });
      case "POST freeze":
        await provider.freeze(agentId);
        return send(res, 200, { ok: true });
      case "POST thaw":
        await provider.thaw(agentId);
        return send(res, 200, { ok: true });
      case "DELETE ":
        await provider.destroy(agentId, { purgeProfile: url.searchParams.get("purgeProfile") === "1" });
        return send(res, 200, { ok: true });
      case "POST observe":
        return send(res, 200, await provider.observe(agentId));
      case "POST act":
        return send(res, 200, await provider.act(agentId, parseActions(body.actions), actOptions(body)));
      case "POST page":
        return send(res, 200, await provider.page(agentId, { marks: body.marks === true }));
      case "POST page/act":
        return send(res, 200, await provider.pageAct(agentId, parsePageAction(body.action), actOptions(body)));
      case "POST control":
        await provider.setControl(agentId, body.interactive === true);
        return send(res, 200, { ok: true });
      case "POST shell": {
        if (typeof body.command !== "string" || !body.command.trim() || body.command.length > 4000) throw new ProviderError("invalid", "command must be 1-4000 characters", 400);
        const timeoutMs = typeof body.timeoutMs === "number" ? Math.min(120_000, Math.max(1000, body.timeoutMs)) : 30_000;
        return send(res, 200, await provider.shell(agentId, body.command, timeoutMs));
      }
      default:
        return send(res, 404, { error: "not found" });
    }
  }

  async function proxyStatic(agentId: string, mode: "view" | "control", file: string, search: string, res: ServerResponse) {
    if (!STATIC_FILE.test(file) || file.includes("..")) return send(res, 400, { error: "bad path" });
    const upstream = await provider.streamUpstream(agentId, mode);
    if (!upstream) return send(res, 409, { error: mode === "control" ? "No one holds control." : "This provider has no live view." });
    const up = await fetch(`http://${upstream.host}:${upstream.port}/${file}${search}`, { signal: AbortSignal.timeout(15_000) });
    res.writeHead(up.status, {
      "content-type": up.headers.get("content-type") ?? "application/octet-stream",
      "cache-control": "no-store",
    });
    res.end(Buffer.from(await up.arrayBuffer()));
  }

  const server = http.createServer((req, res) => {
    handle(req, res).catch((err: unknown) => {
      if (err instanceof ProviderError) return send(res, err.status, { error: err.message, code: err.code });
      return send(res, 500, { error: err instanceof Error ? err.message : "supervisor error" });
    });
  });

  server.on("upgrade", (req, socket, head) => {
    const fail = (status: string) => { socket.end(`HTTP/1.1 ${status}\r\nConnection: close\r\n\r\n`); };
    if (!tokenMatches(req.headers.authorization, token)) return fail("401 Unauthorized");
    const url = new URL(req.url ?? "/", "http://supervisor");
    const m = ROUTE.exec(url.pathname);
    const stream = m ? STREAM.exec(m[2] ?? "") : null;
    if (!m || !stream || stream[2] !== "websockify") return fail("404 Not Found");
    const agentId = m[1]!;
    const mode = stream[1] as "view" | "control";
    provider.streamUpstream(agentId, mode).then((upstream) => {
      if (!upstream) return fail("409 Conflict");
      const target = new WebSocket(`ws://${upstream.host}:${upstream.port}/websockify?token=${encodeURIComponent(upstream.token)}`, ["binary"]);
      target.binaryType = "nodebuffer";
      target.once("open", () => {
        wss.handleUpgrade(req, socket, head, (client) => pipeSockets(client, target));
      });
      target.once("error", () => fail("502 Bad Gateway"));
    }).catch(() => fail("502 Bad Gateway"));
  });

  return {
    server,
    listen() {
      const host = opts.host ?? "127.0.0.1";
      if (!LOOPBACK.has(host) && !opts.allowRemote) {
        throw new Error(`Refusing to listen on ${host}: the supervisor must stay on loopback. Pass --allow-remote only for a private internal network.`);
      }
      return new Promise<number>((resolve, reject) => {
        server.once("error", reject);
        server.listen(opts.port ?? DEFAULT_SUPERVISOR_PORT, host, () => resolve((server.address() as net.AddressInfo).port));
      });
    },
    close() {
      for (const client of wss.clients) client.terminate();
      return new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

export function pipeSockets(a: WebSocket, b: WebSocket) {
  a.on("message", (data, isBinary) => { if (b.readyState === WebSocket.OPEN) b.send(data, { binary: isBinary }); });
  b.on("message", (data, isBinary) => { if (a.readyState === WebSocket.OPEN) a.send(data, { binary: isBinary }); });
  const closeBoth = () => { a.terminate(); b.terminate(); };
  a.on("close", closeBoth);
  b.on("close", closeBoth);
  a.on("error", closeBoth);
  b.on("error", closeBoth);
}

function actOptions(body: Record<string, unknown>) {
  return {
    confirm: body.confirm === true,
    irreversiblePattern: typeof body.irreversiblePattern === "string" ? body.irreversiblePattern.slice(0, 2000) : "(?!)",
    allowedHosts: Array.isArray(body.allowedHosts) ? body.allowedHosts.filter((h): h is string => typeof h === "string") : [],
  };
}

function parsePageAction(input: unknown): PageAction {
  const a = (input ?? {}) as Record<string, unknown>;
  const ref = typeof a.ref === "number" && Number.isInteger(a.ref) && a.ref > 0 && a.ref < 10_000 ? a.ref : 0;
  switch (a.type) {
    case "click":
      if (!ref) break;
      return { type: "click", ref };
    case "type":
      if (!ref || typeof a.text !== "string" || a.text.length > 2000) break;
      return { type: "type", ref, text: a.text, submit: a.submit === true };
    case "navigate":
      if (typeof a.url !== "string" || a.url.length > 2048) break;
      return { type: "navigate", url: a.url };
    case "back":
      return { type: "back" };
  }
  throw new ProviderError("invalid", "invalid page action", 400);
}
