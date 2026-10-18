// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ModelApprovals } from "./ModelApprovals";
const mocks = vi.hoisted(() => ({ get: vi.fn(), put: vi.fn() }));
vi.mock("@/api/client", () => ({ api: mocks }));
let root: Root, container: HTMLDivElement, client: QueryClient;
const policy = { revision: 3, allowedModels: [{ adapterType: "codex_local", model: "gpt-5.4-mini" }], updatedAt: "2026-10-18T00:00:00Z", updatedBy: "user" };
async function render() {
  await act(async () => { root.render(<QueryClientProvider client={client}><ModelApprovals companyId="company-1" /></QueryClientProvider>); });
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
}
async function click(label: string) { await act(async () => { [...container.querySelectorAll("button")].find(button => button.textContent === label)!.click(); }); }
async function input(value: string) { await act(async () => { const element = container.querySelector("input")!; Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(element, value); element.dispatchEvent(new Event("input", { bubbles: true })); }); }
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  mocks.get.mockReset().mockResolvedValue(policy); mocks.put.mockReset();
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); client.clear(); container.remove(); vi.unstubAllGlobals(); });
describe("model approvals", () => {
  it("shows existing authority and saves revocation with the current revision", async () => {
    mocks.put.mockResolvedValue({ ...policy, revision: 4, allowedModels: [] });
    await render();
    expect(container.textContent).toContain("gpt-5.4-mini");
    await click("Remove");
    expect(container.textContent).toContain("No models approved");
    await click("Save model approvals");
    expect(mocks.put).toHaveBeenCalledWith("/companies/company-1/ppclip/model-policy", { expectedRevision: 3, policy: { allowedModels: [] } });
  });
  it("requires an explicit model and does not save additions without a deliberate save", async () => {
    await render(); await input("default"); await click("Add model");
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("explicit model");
    await input("gpt-6-astra"); await click("Add model");
    expect(container.textContent).toContain("gpt-6-astra");
    expect(mocks.put).not.toHaveBeenCalled();
    await click("Discard");
    expect(container.textContent).not.toContain("gpt-6-astra");
  });
  it("keeps a rejected draft visible and offers reload on revision conflicts", async () => {
    mocks.put.mockRejectedValue(new Error("Approvals changed in another window"));
    await render(); await input("gpt-6-sol"); await click("Add model"); await click("Save model approvals");
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
    expect(container.textContent).toContain("changed in another window");
    expect(container.textContent).toContain("gpt-6-sol");
    expect(container.textContent).toContain("Reload approvals");
  });
});
