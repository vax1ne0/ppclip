import type { IncomingMessage, Server } from "node:http";
import type { Duplex } from "node:stream";
import { WebSocket, WebSocketServer } from "ws";
import type { Db } from "@paperclipai/db";
import { ppclipComputerUse } from "./index.js";
import type { ComputerUseService } from "./service.js";
import { pipeSockets } from "./supervisor/server.js";
import { ppclipFeature } from "../features.js";

const PATH = /^\/api\/ppclip\/computer-use\/view\/([A-Za-z0-9_-]{16,64})\/websockify$/;
const RECHECK_MS = 1000;

/**
 * WebSocket proxy for the live view: browser ⇄ Paperclip ⇄ supervisor ⇄ sandbox.
 * The ticket is checked on connect and again every second; the connection is
 * dropped as soon as control changes, access is revoked or the ticket expires.
 * Registered before official handlers, and marks requests it owns as handled.
 */
export function setupPpclipComputerStreamProxy(server: Server, db: Db, service: ComputerUseService = ppclipComputerUse(db)) {
  const wss = new WebSocketServer({ noServer: true, maxPayload: 8 * 1024 * 1024 });
  server.on("upgrade", (req: IncomingMessage & { paperclipWebSocketHandled?: boolean }, socket: Duplex, head: Buffer) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    const match = PATH.exec(url.pathname);
    if (!match) return;
    req.paperclipWebSocketHandled = true;
    const reject = (status: string) => socket.end(`HTTP/1.1 ${status}\r\nConnection: close\r\n\r\n`);
    if (!ppclipFeature("computerUse")) return reject("404 Not Found");
    const ticketId = match[1]!;
    void service.resolveTicket(ticketId).then((ticket) => {
      if (!ticket) return reject("403 Forbidden");
      const target = service.supervisor.streamSocket(ticket.agentId, ticket.mode);
      if (!target) return reject("503 Service Unavailable");
      const upstream = new WebSocket(target.url, ["binary"], { headers: target.headers });
      upstream.once("error", () => reject("502 Bad Gateway"));
      upstream.once("open", () => {
        wss.handleUpgrade(req, socket, head, (client) => {
          pipeSockets(client, upstream);
          const timer = setInterval(() => {
            void service.resolveTicket(ticketId).then((still) => {
              if (!still) {
                client.close(4001, "Control changed");
                upstream.terminate();
              }
            }).catch(() => client.terminate());
          }, RECHECK_MS);
          client.on("close", () => clearInterval(timer));
        });
      });
    }).catch(() => reject("500 Internal Server Error"));
  });
  return wss;
}
