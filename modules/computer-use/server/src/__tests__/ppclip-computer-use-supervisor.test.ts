import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { WebSocket } from "ws";
import { createSupervisorServer } from "../ppclip/computer-use/supervisor/server.ts";
import { FakeComputerProvider } from "../ppclip/computer-use/supervisor/fake-provider.ts";
import { httpSupervisorClient, SupervisorError } from "../ppclip/computer-use/supervisor-client.ts";

const TOKEN = "t".repeat(48);

describe("ppclip computer supervisor", () => {
  const provider = new FakeComputerProvider();
  const supervisor = createSupervisorServer({ provider, token: TOKEN, port: 0 });
  let base = "";

  beforeAll(async () => {
    base = `http://127.0.0.1:${await supervisor.listen()}`;
  });
  afterAll(() => supervisor.close());

  it("refuses to listen beyond loopback and rejects short tokens", () => {
    expect(() => createSupervisorServer({ provider, token: TOKEN, host: "0.0.0.0" }).listen()).toThrow(/loopback/);
    expect(() => createSupervisorServer({ provider, token: "short" })).toThrow(/32/);
  });

  it("requires the bearer token on every route, including the stream socket", async () => {
    expect((await fetch(`${base}/health`)).status).toBe(401);
    expect((await fetch(`${base}/health`, { headers: { authorization: "Bearer wrong" } })).status).toBe(401);
    expect((await fetch(`${base}/computers/a1/stream/view/vnc_lite.html`)).status).toBe(401);
    const closed = await new Promise<number>((resolve) => {
      const ws = new WebSocket(`${base.replace("http", "ws")}/computers/a1/stream/view/websockify`);
      ws.on("unexpected-response", (_req, res) => resolve(res.statusCode ?? 0));
      ws.on("error", () => resolve(-1));
    });
    expect(closed).toBe(401);
  });

  it("runs the computer lifecycle through the HTTP client", async () => {
    const client = httpSupervisorClient({ url: base, token: () => TOKEN });
    expect(await client.health()).toMatchObject({ ok: true, provider: { kind: "fake" } });
    expect(await client.ensure("agent-1", { companyId: "c1", shell: false, allowedHosts: [] })).toMatchObject({ running: true, profileKept: false });
    expect((await client.observe("agent-1")).frameId).toMatch(/^[0-9a-f]{16}$/);
    const opts = { confirm: false, irreversiblePattern: "\\bdelete\\b", allowedHosts: [] };
    expect(await client.pageAct("agent-1", { type: "navigate", url: "https://example.com/" }, opts)).toMatchObject({ ok: true });
    expect(await client.pageAct("agent-1", { type: "type", ref: 2, text: "hunter2" }, opts)).toMatchObject({ ok: false, code: "sensitive_field" });
    expect(await client.pageAct("agent-1", { type: "click", ref: 3 }, opts)).toMatchObject({ ok: false, code: "needs_confirm" });
    expect(await client.pageAct("agent-1", { type: "click", ref: 3 }, { ...opts, confirm: true })).toMatchObject({ ok: true });
    await expect(client.act("agent-1", [{ type: "key", key: "bad key!" } as never], opts)).rejects.toBeInstanceOf(SupervisorError);
    await client.stop("agent-1");
    await expect(client.observe("agent-1")).rejects.toMatchObject({ code: "not_running" });
    // The profile survives a stop; a purge removes it.
    expect(await client.ensure("agent-1", { companyId: "c1", shell: false, allowedHosts: [] })).toMatchObject({ profileKept: true });
    await client.stop("agent-1");
    await client.destroy("agent-1", true);
    expect(await client.inspect("agent-1")).toBeNull();
  });

  it("reports a missing supervisor clearly", async () => {
    const offline = httpSupervisorClient({ url: "http://127.0.0.1:1", token: () => TOKEN });
    expect(await offline.health()).toMatchObject({ ok: false });
    const untokened = httpSupervisorClient({ url: base, token: () => null });
    await expect(untokened.inspect("a")).rejects.toThrow(/isn.t running/);
  });
  it("does not report a healthy supervisor when its provider is unavailable", async () => {
    const offlineProvider = new FakeComputerProvider() as FakeComputerProvider & { health: () => Promise<void> };
    offlineProvider.health = async () => { throw new Error("Docker is unavailable"); };
    const offline = createSupervisorServer({ provider: offlineProvider, token: TOKEN, port: 0 });
    const port = await offline.listen();
    try {
      const client = httpSupervisorClient({ url: `http://127.0.0.1:${port}`, token: () => TOKEN });
      expect(await client.health()).toMatchObject({ ok: false });
    } finally { await offline.close(); }
  });
});
