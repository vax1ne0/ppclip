import { describe, expect, it, vi } from "vitest";
import { computerTools } from "../ppclip/computer-use/mcp.js";
import { readComputerUse } from "../ppclip/computer-use/state.js";
import type { ComputerUseService } from "../ppclip/computer-use/service.js";

const ctx = { companyId: "company", agentId: "agent", runId: "run" };
function fixture(state = "agent") {
  const meta = { ...readComputerUse(null), enabled: true, state, epoch: 7 };
  const desktop = vi.fn(async () => ({ url: null, title: "Desktop", text: "untrusted window", elements: [{ ref: 1, role: "entry", tag: "desktop", name: "Search", sensitive: false, irreversible: false }] }));
  const desktopAct = vi.fn(async () => ({ ok: true, done: 1 }));
  const service = {
    withAgentLock: (_id: string, fn: () => unknown) => fn(), isEnabled: async () => true,
    readMeta: async () => meta, supervisor: { desktop, desktopAct },
    touch: vi.fn(), logTool: vi.fn(),
  } as unknown as ComputerUseService;
  return { meta, desktop, desktopAct, tools: computerTools(service) };
}

describe("native desktop tools preserve the computer boundary", () => {
  it("blocks observation in private mode and mutation during human takeover", async () => {
    const privateMode = fixture("human_private");
    expect(await privateMode.tools.run(ctx, "desktop_page", {})).toMatchObject({ isError: true });
    expect(privateMode.desktop).not.toHaveBeenCalled();
    const human = fixture("human");
    expect(await human.tools.run(ctx, "desktop_click_element", { ref: 1, epoch: 7 })).toMatchObject({ isError: true });
    expect(human.desktopAct).not.toHaveBeenCalled();
  });
  it("rejects stale epochs and routes allowed input through the supervisor", async () => {
    const f = fixture();
    expect(await f.tools.run(ctx, "desktop_click_element", { ref: 1, epoch: 6 })).toMatchObject({ isError: true });
    expect(f.desktopAct).not.toHaveBeenCalled();
    const result = await f.tools.run(ctx, "desktop_click_element", { ref: 1, epoch: 7 });
    expect(result.isError).not.toBe(true);
    expect(f.desktopAct).toHaveBeenCalledWith("agent", { type: "click", ref: 1 }, expect.objectContaining({ confirm: false }));
  });
  it("returns native content as untrusted data with the current epoch", async () => {
    const f = fixture();
    const result = await f.tools.run(ctx, "desktop_page", {});
    expect(JSON.stringify(result.content)).toContain('epoch');
    expect(JSON.stringify(result.content)).toContain('untrusted');
    expect(f.desktop).toHaveBeenCalledOnce();
  });
});
