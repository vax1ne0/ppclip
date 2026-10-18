import { describe, expect, it, vi } from "vitest";
import { DockerComputerProvider } from "../ppclip/computer-use/supervisor/docker-provider.ts";
import { DockerApi } from "../ppclip/computer-use/supervisor/docker-api.ts";
import { ProviderError } from "../ppclip/computer-use/supervisor/provider.ts";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}

describe("computer stream token concurrency", () => {
  it("reissues a control token when the container has restarted", async () => {
    const provider = new DockerComputerProvider();
    let generation = "first-start";
    const internals = provider as unknown as { inspectContainer(id: string): Promise<unknown>; daemon(id: string, path: string, body: unknown): Promise<unknown> };
    vi.spyOn(internals, "inspectContainer").mockImplementation(async () => ({ State: { Running: true, Paused: false, StartedAt: generation }, Config: { Labels: { "ppclip.controlToken": "test-daemon-token" } }, NetworkSettings: { Ports: { "7070/tcp": [{ HostIp: "127.0.0.1", HostPort: "7000" }], "6080/tcp": [{ HostIp: "127.0.0.1", HostPort: "6000" }] } } }));
    const daemon = vi.spyOn(internals, "daemon").mockResolvedValue({ ok: true });
    await provider.setControl("agent-1", true);
    const first = await provider.streamUpstream("agent-1", "control");
    await provider.setControl("agent-1", true);
    expect(daemon).toHaveBeenCalledTimes(1);
    generation = "second-start";
    await provider.setControl("agent-1", true);
    expect(daemon).toHaveBeenCalledTimes(2);
    expect((await provider.streamUpstream("agent-1", "control"))?.token).not.toBe(first?.token);
  });
  it("recognizes paused Docker containers before reporting missing runtime ports", async () => {
    const provider = new DockerComputerProvider();
    vi.spyOn(provider as unknown as { inspectContainer(id: string): Promise<unknown> }, "inspectContainer").mockResolvedValue({
      State: { Running: true, Paused: true }, NetworkSettings: { Ports: {} }, Config: { Labels: {} },
    });
    await expect(provider.streamUpstream("agent-1", "view")).rejects.toThrow(/paused.*Resume/);
  });

  it("waits for republished ports and daemon health after unpausing", async () => {
    vi.useFakeTimers();
    try {
      const docker = new DockerApi();
      vi.spyOn(docker, "request").mockResolvedValue(undefined);
      const provider = new DockerComputerProvider({ docker });
      vi.spyOn(provider as unknown as { endpoint(id: string): Promise<unknown> }, "endpoint").mockResolvedValue({ host: "127.0.0.1", streamPort: 6080 });
      const screen = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("ready"));
      const health = vi.spyOn(provider as unknown as { daemon(id: string, path: string, body?: unknown, timeout?: number): Promise<unknown> }, "daemon")
        .mockRejectedValueOnce(new ProviderError("unavailable", "Ports not ready yet"))
        .mockResolvedValue({ ok: true });
      let ready = false;
      const thaw = provider.thaw("agent-1").then(() => { ready = true; });
      await vi.advanceTimersByTimeAsync(749);
      expect(ready).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      await thaw;
      expect(ready).toBe(true);
      expect(health).toHaveBeenCalledTimes(2);
      expect(screen).toHaveBeenCalledTimes(1);
    } finally { vi.restoreAllMocks(); vi.useRealTimers(); }
  });
  it("does not finish startup while only the control daemon is ready", async () => {
    vi.useFakeTimers();
    try {
      const docker = new DockerApi();
      vi.spyOn(docker, "request").mockResolvedValue(undefined);
      const provider = new DockerComputerProvider({ docker });
      const internals = provider as unknown as { endpoint(id: string): Promise<unknown>; daemon(id: string, path: string): Promise<unknown> };
      vi.spyOn(internals, "endpoint").mockResolvedValue({ host: "127.0.0.1", streamPort: 6080 });
      vi.spyOn(internals, "daemon").mockResolvedValue({ ok: true });
      vi.spyOn(globalThis, "fetch").mockRejectedValueOnce(new TypeError("fetch failed")).mockResolvedValue(new Response("screen ready"));
      let ready = false;
      const thaw = provider.thaw("agent-1").then(() => { ready = true; });
      await vi.advanceTimersByTimeAsync(749);
      expect(ready).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      await thaw;
      expect(ready).toBe(true);
    } finally { vi.restoreAllMocks(); vi.useRealTimers(); }
  });
  it.each(["view", "control"] as const)("keeps both tokens when %s registration finishes last", async (last) => {
    const provider = new DockerComputerProvider();
    const internals = provider as unknown as {
      endpoint(id: string): Promise<{ host: string; streamPort: number }>;
      daemon(id: string, path: string, body: unknown): Promise<unknown>;
    };
    vi.spyOn(internals, "endpoint").mockResolvedValue({ host: "127.0.0.1", streamPort: 6080 });
    const entered = deferred();
    const finish = deferred();
    const issued: Record<string, string> = {};
    vi.spyOn(internals, "daemon").mockImplementation(async (_id, path, body) => {
      issued[path] = (body as { token: string }).token;
      if (path === `/stream/${last}`) {
        entered.resolve();
        await finish.promise;
      }
      return { ok: true };
    });
    const slow = last === "view" ? provider.streamUpstream("agent-1", "view") : provider.setControl("agent-1", true);
    await entered.promise;
    if (last === "view") await provider.setControl("agent-1", true);
    else await provider.streamUpstream("agent-1", "view");
    finish.resolve();
    await slow;
    expect(await provider.streamUpstream("agent-1", "control")).toMatchObject({ token: issued["/stream/control"] });
    expect(await provider.streamUpstream("agent-1", "view")).toMatchObject({ token: issued["/stream/view"] });
    expect(internals.daemon).toHaveBeenCalledTimes(2);
    await provider.setControl("agent-1", true);
    expect(internals.daemon).toHaveBeenCalledTimes(2);
    await provider.setControl("agent-1", false);
    expect(await provider.streamUpstream("agent-1", "control")).toBeNull();
    expect(await provider.streamUpstream("agent-1", "view")).toMatchObject({ token: issued["/stream/view"] });
  });
});
