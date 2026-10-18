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
async function color(key: string, value: string) {
  const input = host.querySelector<HTMLInputElement>(`#mascot-color-${key}`)!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

it("edits arbitrary colors, swaps them and saves the custom gradient", async () => {
  await render(); await color("a", "#ab12cd"); await color("b", "#123456");
  expect(mocks.update).not.toHaveBeenCalled();
  await click("Swap colors");
  const appearance = { ...identity.appearance!, customColors: { a: "#123456", b: "#ab12cd" } };
  mocks.update.mockResolvedValue({ ...identity, appearance });
  await click("Save appearance");
  expect(mocks.update).toHaveBeenCalledWith(identity.id, { appearance }, identity.companyId);
  expect(host.textContent).toContain("Appearance saved.");
});
it("opens the same saturation and hue picker used by team role groups", async () => {
  await render(); await click("Top color picker");
  expect(document.querySelector('.react-colorful')).not.toBeNull();
  expect(document.querySelectorAll('[role="slider"]').length).toBeGreaterThanOrEqual(2);
  expect(mocks.update).not.toHaveBeenCalled();
});
it("blocks incomplete hex colors and restores saved colors on discard", async () => {
  await render(); await color("a", "#12");
  expect(host.querySelector('#mascot-color-a')?.getAttribute("aria-invalid")).toBe("true");
  expect([...host.querySelectorAll("button")].find(node => node.textContent === "Save appearance")?.disabled).toBe(true);
  expect(mocks.update).not.toHaveBeenCalled();
  await click("Discard");
  expect(host.querySelector<HTMLInputElement>('#mascot-color-a')!.value).toMatch(/^#[a-f0-9]{6}$/);
  expect(host.querySelector('#mascot-color-a')?.getAttribute("aria-invalid")).toBe("false");
});
it("previews gradient position and rotation locally, saves them, and discards later changes", async () => {
  await render();
  async function range(name: string, value: string) {
    const input = host.querySelector<HTMLInputElement>(`input[aria-label="${name}"]`)!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
  }
  await range("Horizontal center", "30"); await range("Vertical center", "70"); await range("Gradient angle", "90");
  expect(mocks.update).not.toHaveBeenCalled();
  const appearance = { ...identity.appearance!, gradient: { x: 30, y: 70, angle: 90 } };
  mocks.update.mockResolvedValue({ ...identity, appearance }); await click("Save appearance");
  expect(mocks.update).toHaveBeenCalledWith(identity.id, { appearance }, identity.companyId);
  await range("Gradient angle", "-30"); await click("Discard");
  expect(host.querySelector<HTMLInputElement>('input[aria-label="Gradient angle"]')?.value).toBe("90");
});

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
