import { describe, expect, it, vi } from "vitest";
import { DockerComputerProvider } from "../ppclip/computer-use/supervisor/docker-provider.ts";
import { DockerApi } from "../ppclip/computer-use/supervisor/docker-api.ts";

const spec = { agentId: "policy-test", companyId: "company", shell: false, allowedHosts: [] };
function fixture(labels: Record<string, string>, imageLabels = { "ppclip.sandbox-policy": "2" }, locked = false) {
  const docker = new DockerApi();
  const request = vi.spyOn(docker, "request").mockImplementation(async (method, route) => {
    if (route.includes("ppclip-profile-lock-")) return locked ? {} : null;
    if (route.startsWith("/images/")) return { Config: { Labels: imageLabels } };
    if (route.startsWith("/volumes/")) return { Name: "saved-profile" };
    if (route.endsWith("/json") && route.startsWith("/containers/")) return { State: { Running: true, Paused: false }, Config: { Labels: labels } };
    if (route.startsWith("/containers/json?")) return [];
    if (route === "/info") return {};
    return {};
  });
  const provider = new DockerComputerProvider({ docker });
  vi.spyOn(provider as unknown as { waitHealthy(id: string): Promise<void> }, "waitHealthy").mockResolvedValue();
  return { provider, request };
}
const current = { "ppclip.networkPolicy": "2", "ppclip.desktopDriver": "atspi", "ppclip.shell": "false", "ppclip.allowedHosts": "" };

describe("Docker policy upgrades and profile ownership", () => {
  it("refuses a profile lock before changing a container", async () => {
    const { provider, request } = fixture(current, undefined, true);
    await expect(provider.ensure(spec)).rejects.toThrow(/backed up or restored/);
    expect(request.mock.calls.every(([method]) => method === "GET")).toBe(true);
  });
  it("keeps the existing computer untouched when the image needs rebuilding", async () => {
    const { provider, request } = fixture(current, { "ppclip.sandbox-policy": "1" });
    await expect(provider.ensure(spec)).rejects.toThrow(/Rebuild/);
    expect(request.mock.calls.every(([method]) => method === "GET")).toBe(true);
  });
  it("reconnects a current container without replacement", async () => {
    const { provider, request } = fixture(current);
    expect(await provider.ensure(spec)).toMatchObject({ profileKept: true, recovery: "reconnected" });
    expect(request.mock.calls.every(([method]) => method === "GET")).toBe(true);
  });
  it("replaces an old policy container while preserving its home volume", async () => {
    const { provider, request } = fixture({ ...current, "ppclip.networkPolicy": "1" });
    expect(await provider.ensure(spec)).toMatchObject({ profileKept: true, recovery: "recreated" });
    const deletes = request.mock.calls.filter(([method]) => method === "DELETE");
    expect(deletes.map(([, route]) => route)).toEqual(["/containers/ppclip-computer-policy-test?force=true"]);
    const create = request.mock.calls.find(([, route]) => route.startsWith("/containers/create?"))?.[2] as { HostConfig: { Mounts: unknown[]; CapAdd: string[] } };
    expect(create.HostConfig.Mounts).toEqual([{ Type: "volume", Source: "ppclip-computer-home-policy-test", Target: "/home/agent" }]);
    expect(create.HostConfig.CapAdd).toContain("NET_ADMIN");
  });
});
