// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { AgentComputerBadge, ComputerBadgesProvider } from "./AgentComputerBadge";
const state = vi.hoisted(() => ({ on: true, enabled: true, rows: [{ agentId: "enabled", enabled: true, state: "stopped" }, { agentId: "disabled", enabled: false, state: "agent" }], overview: vi.fn() }));
vi.mock("@/context/CompanyContext", () => ({ useCompany: () => ({ selectedCompanyId: "company" }) }));
vi.mock("@/ppclip/features/store", () => ({ usePpclipFeature: () => state.on }));
vi.mock("./useComputerUse", () => ({ useComputerUse: (id: string | null) => { state.overview(id); return { data: { enabled: state.enabled, agents: state.rows } }; } }));
it("shows enabled computers even when stopped, hides disabled or unknown ones, and shares one subscription", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const host = document.createElement("div"), root = createRoot(host);
  const page = () => <ComputerBadgesProvider><AgentComputerBadge agentId="enabled" /><AgentComputerBadge agentId="disabled" /><AgentComputerBadge agentId="missing" /></ComputerBadgesProvider>;
  try {
    await act(async () => root.render(page()));
    expect(host.querySelectorAll('[aria-label="Computer use enabled"]')).toHaveLength(1);
    expect(state.overview).toHaveBeenCalledOnce();
    state.enabled = false; await act(async () => root.render(page()));
    expect(host.querySelector("svg")).toBeNull();
    state.enabled = true; state.on = false; await act(async () => root.render(page()));
    expect(host.querySelector("svg")).toBeNull(); expect(state.overview).toHaveBeenLastCalledWith(null);
  } finally { await act(async () => root.unmount()); vi.unstubAllGlobals(); }
});
