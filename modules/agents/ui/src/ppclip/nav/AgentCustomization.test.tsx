// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { appearanceForPalette, type Agent } from "@paperclipai/shared";
import { AgentCustomization } from "./AgentCustomization";
const mocks = vi.hoisted(() => ({ update: vi.fn() }));
vi.mock("@/api/agents", () => ({ agentsApi: mocks }));
vi.mock("@/components/AgentCharacter", () => ({ AgentCharacter: ({ appearance, state }: { appearance: { paletteId: string }; state: string }) => <div data-testid="preview" data-palette={appearance.paletteId} data-state={state} /> }));
let host: HTMLDivElement, root: Root, client: QueryClient;
const identity = { id: "agent-one", companyId: "company-one", name: "Robin", appearance: appearanceForPalette("bubblegum-sky") } as Agent;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  mocks.update.mockReset();
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
});
afterEach(async () => { await act(async () => root.unmount()); client.clear(); host.remove(); vi.unstubAllGlobals(); });
async function render(agent = identity) { await act(async () => { root.render(<QueryClientProvider client={client}><AgentCustomization agent={agent} /></QueryClientProvider>); }); }
async function click(label: string) {
  const button = [...host.querySelectorAll("button")].find(node => node.getAttribute("aria-label") === label || node.textContent === label);
  expect(button).toBeTruthy(); await act(async () => { button!.click(); });
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
}
const preview = () => host.querySelector('[data-testid="preview"]')!;

it("previews and discards palette changes without writing", async () => {
  await render(); await click("Arctic Blue");
  expect(preview().getAttribute("data-palette")).toBe("arctic-blue");
  expect(mocks.update).not.toHaveBeenCalled();
  await click("Discard");
  expect(preview().getAttribute("data-palette")).toBe("bubblegum-sky");
  expect(host.querySelector<HTMLButtonElement>('button[aria-label="Bubblegum Sky"]')?.getAttribute("aria-pressed")).toBe("true");
});
it("saves only appearance through the company-scoped agent endpoint and refreshes shared identities", async () => {
  const invalidate = vi.spyOn(client, "invalidateQueries");
  mocks.update.mockResolvedValue({ ...identity, appearance: appearanceForPalette("arctic-blue") });
  await render(); await click("Arctic Blue"); await click("Save appearance");
  expect(mocks.update).toHaveBeenCalledWith("agent-one", { appearance: appearanceForPalette("arctic-blue") }, "company-one");
  expect(invalidate).toHaveBeenCalledWith({ queryKey: ["agents"] });
  expect(host.textContent).toContain("Appearance saved.");
});
it("keeps the selected draft and offers a retry after a refused save", async () => {
  mocks.update.mockRejectedValueOnce(new Error("You do not have permission to edit this agent"));
  await render(); await click("Arctic Blue"); await click("Save appearance");
  expect(host.querySelector('[role="alert"]')?.textContent).toContain("permission");
  expect(preview().getAttribute("data-palette")).toBe("arctic-blue");
  mocks.update.mockResolvedValue({ ...identity, appearance: appearanceForPalette("arctic-blue") });
  await click("Save appearance"); expect(mocks.update).toHaveBeenCalledTimes(2);
});
it("keeps expression previews local and only switches an uploaded avatar on an explicit palette save", async () => {
  await render({ ...identity, appearance: { ...identity.appearance!, customAvatarAssetId: "00000000-0000-4000-8000-000000000001" } });
  const select = host.querySelector("select")!;
  await act(async () => { select.value = "working"; select.dispatchEvent(new Event("change", { bubbles: true })); });
  expect(preview().getAttribute("data-state")).toBe("working");
  expect(mocks.update).not.toHaveBeenCalled();
  expect(host.textContent).toContain("uploaded image");
  mocks.update.mockResolvedValue({ ...identity, appearance: appearanceForPalette("arctic-blue") });
  await click("Arctic Blue"); await click("Save appearance");
  expect(mocks.update.mock.calls[0][1].appearance).not.toHaveProperty("customAvatarAssetId");
});
