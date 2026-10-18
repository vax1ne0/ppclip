// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { UpdateStatus } from "./api";

const mockApi = vi.hoisted(() => ({ status: vi.fn(), check: vi.fn(), start: vi.fn() }));
vi.mock("./api", () => ({ ppclipUpdateApi: mockApi }));

import { UpdateSection } from "./UpdateSection";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const status = (overrides: Partial<UpdateStatus> = {}): UpdateStatus => ({
  packageDir: "/x/ppclip-package",
  current: { commit: "73cf0bd", subject: "Computer use: agent card", date: "2026-10-17T19:00:00Z" },
  available: [],
  checkedAt: null,
  checkError: null,
  blocked: null,
  runningRuns: 0,
  job: null,
  logTail: [],
  ...overrides,
});

let container: HTMLDivElement;
let root: Root;
const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });
async function render() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await act(async () => { root.render(<QueryClientProvider client={client}><UpdateSection /></QueryClientProvider>); });
  await flush();
}
const q = (id: string) => container.querySelector<HTMLElement>(`[data-testid=${id}]`);
const reload = vi.fn();

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  for (const fn of Object.values(mockApi)) fn.mockReset();
  reload.mockReset();
  Object.defineProperty(window, "location", { configurable: true, value: { ...window.location, reload } });
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("UpdateSection", () => {
  it("shows a friendly failed-check message without exposing the raw error", async () => {
    mockApi.status.mockResolvedValue(status({ checkedAt: "2026-10-18T10:00:00Z", checkError: "git fetch failed: C:/private/repo" }));
    await render();
    expect(q("ppclip-update-status")?.textContent).toBe("Couldn’t check for updates");
    expect(container.textContent).not.toContain("C:/private/repo");
    expect(q("ppclip-update-start")).toBeNull();
  });
  it("shows a clear status without internal revision details", async () => {
    mockApi.status.mockResolvedValue(status());
    mockApi.check.mockResolvedValue(status({ checkedAt: "2026-10-17T20:00:00Z" }));
    await render();
    expect(container.textContent).not.toContain("73cf0bd");
    await act(async () => { q("ppclip-update-check")!.click(); });
    await flush();
    expect(q("ppclip-update-status")?.textContent).toBe("Up to date");
    expect(q("ppclip-update-start")).toBeNull();
  });

  it("keeps local files and diagnostics out of the user interface", async () => {
    mockApi.status.mockResolvedValue(status({ checkedAt: "2026-10-18T10:00:00Z", localChanges: [" M modules.json", "?? notes.txt"], logTail: ["dependency install failed"] }));
    await render();
    expect(q("ppclip-update-status")?.textContent).toBe("Up to date");
    expect(container.textContent).not.toContain("Local changes");
    expect(container.textContent).not.toContain("notes.txt");
    expect(container.textContent).not.toContain("dependency install failed");
    expect(container.textContent).not.toContain("/x/ppclip-package");
  });

  it("resumes progress when opened during an update", async () => {
    mockApi.status.mockResolvedValue(status({ job: { state: "running", step: "Installing dependencies", startedAt: new Date().toISOString() } }));
    await render();
    await flush();
    expect(q("ppclip-update-progress")?.textContent).toContain("Installing update");
    expect(q("ppclip-update-check")).toBeNull();
  });

  it("shows up-to-date status independently of local changes", async () => {
    mockApi.status.mockResolvedValue(status({ checkedAt: "2026-10-18T10:00:00Z", blocked: "Local edits", localChanges: [" M modules.json"] }));
    await render();
    expect(q("ppclip-update-status")?.textContent).toBe("Up to date");
    expect(container.querySelector("details")).toBeNull();
    expect(q("ppclip-update-blocked")).toBeNull();
    expect(container.querySelector("progress")).toBeNull();
  });

  it("shows an indeterminate bar during checks and an out-of-date result", async () => {
    mockApi.status.mockResolvedValue(status());
    let finish!: (value: UpdateStatus) => void;
    mockApi.check.mockImplementation(() => new Promise<UpdateStatus>(resolve => { finish = resolve; }));
    await render();
    await act(async () => { q("ppclip-update-check")!.click(); });
    await flush();
    expect(container.querySelector("progress")?.hasAttribute("value")).toBe(false);
    expect(q("ppclip-update-status")?.textContent).toBe("Checking…");
    await act(async () => { finish(status({ checkedAt: "2026-10-18T10:00:00Z", available: ["abc Fix"] })); });
    await flush();
    expect(q("ppclip-update-status")?.textContent).toBe("Update available");
    expect(container.querySelector("progress")).toBeNull();
  });

  it("offers Update and restart without exposing commit titles", async () => {
    mockApi.status.mockResolvedValue(status());
    mockApi.check.mockResolvedValue(status({ checkedAt: "x", available: ["abc1234 Update button", "def5678 Fix"] }));
    await render();
    await act(async () => { q("ppclip-update-check")!.click(); });
    await flush();
    expect(q("ppclip-update-status")?.textContent).toBe("Update available");
    expect(container.textContent).not.toContain("abc1234");
    expect(q("ppclip-update-start")).not.toBeNull();
  });

  it("explains why it can't update and hides the button", async () => {
    mockApi.status.mockResolvedValue(status());
    mockApi.check.mockResolvedValue(status({ checkedAt: "x", available: ["abc Update"], blocked: "Paperclip wasn't started with scripts/ppclip/start-local.mjs, so it can't restart itself." }));
    await render();
    await act(async () => { q("ppclip-update-check")!.click(); });
    await flush();
    expect(q("ppclip-update-blocked")?.textContent).toContain("Contact the person who set up");
    expect(container.textContent).not.toContain("start-local.mjs");
    expect(q("ppclip-update-start")).toBeNull();
  });

  it("warns about running agents, shows progress while Paperclip restarts, then reloads", async () => {
    mockApi.status.mockResolvedValue(status({ runningRuns: 2 }));
    mockApi.check.mockResolvedValue(status({ checkedAt: "x", available: ["abc Update"], runningRuns: 2 }));
    mockApi.start.mockResolvedValue({ started: true });
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    await render();
    await act(async () => { q("ppclip-update-check")!.click(); });
    await flush();
    await act(async () => { q("ppclip-update-start")!.click(); });
    await flush();
    expect(confirm.mock.calls[0]![0]).toMatch(/2 agent runs are running now and will be interrupted/);
    expect(mockApi.start).toHaveBeenCalled();
    expect(q("ppclip-update-progress")).not.toBeNull();

    // The server is down for a moment, then answers with a finished job.
    mockApi.status.mockRejectedValueOnce(new Error("Failed to fetch"));
    await act(async () => { await new Promise((r) => setTimeout(r, 2100)); });
    expect(q("ppclip-update-progress")?.textContent).toMatch(/Restarting Paperclip/);
    mockApi.status.mockResolvedValue(status({ job: { state: "done", step: "Done", finishedAt: new Date(Date.now() + 1000).toISOString(), commits: ["abc Update"] } }));
    await act(async () => { await new Promise((r) => setTimeout(r, 2100)); });
    expect(q("ppclip-update-progress")?.textContent).toMatch(/Updated\. Reloading/);
    await act(async () => { await new Promise((r) => setTimeout(r, 1600)); });
    expect(reload).toHaveBeenCalled();
  }, 15_000);

  it("does nothing when the confirmation is cancelled, and shows a failed update", async () => {
    mockApi.status.mockResolvedValue(status({ job: { state: "failed", error: "pnpm install failed (see the update log)." } }));
    mockApi.check.mockResolvedValue(status({ checkedAt: "x", available: ["abc Update"] }));
    vi.spyOn(window, "confirm").mockReturnValue(false);
    await render();
    expect(q("ppclip-update-failed")?.textContent).toContain("couldn’t finish");
    expect(container.textContent).not.toContain("pnpm install failed");
    await act(async () => { q("ppclip-update-check")!.click(); });
    await flush();
    await act(async () => { q("ppclip-update-start")!.click(); });
    expect(mockApi.start).not.toHaveBeenCalled();
  });
});
