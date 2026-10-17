// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Agent } from "@paperclipai/shared";
import { TeamCanvas } from "./TeamCanvas";
import type { AgentLink } from "./agent-links";
import { teamStorageKey } from "./team-layout";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const agent = (id: string, name: string, reportsTo: string | null = null, role = "engineer") =>
  ({ id, name, role, reportsTo, status: "idle", companyId: "co" }) as unknown as Agent;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  localStorage.clear();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  document.body.innerHTML = "";
  localStorage.clear();
  vi.restoreAllMocks();
});

async function render(agents: Agent[], links: AgentLink[] = [], companyId = "fixture") {
  await act(async () => root.render(
    <TeamCanvas
      companyId={companyId}
      agents={agents}
      links={links}
      renderCard={(member, presentation) => (
        <div data-color={presentation.groupColor} data-level={presentation.level}>
          {presentation.header(<span>{member.name}</span>)}
          {presentation.reportsToggle}
        </div>
      )}
    />,
  ));
}
async function remount(agents: Agent[], links: AgentLink[] = []) {
  await act(async () => root.unmount());
  root = createRoot(container);
  await render(agents, links);
}

const buttonByText = (text: string) => [...document.querySelectorAll("button")].find((button) => button.textContent?.trim() === text);
const card = (id: string) => container.querySelector<HTMLElement>(`[data-team-card="${id}"]`)!;
const left = (id: string) => parseFloat(card(id).style.left);
const top = (id: string) => parseFloat(card(id).style.top);
const handle = (name: string) => container.querySelector<HTMLElement>(`[aria-label="Move ${name}"]`);
const scaleOf = () => container.querySelector<HTMLElement>("[data-testid=team-canvas-layer]")!.style.transform.match(/scale\(([^)]+)\)/)![1];
const press = (element: Element, key: string, init: KeyboardEventInit = {}) =>
  act(async () => { element.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, ...init })); });
const pointer = (element: Element, type: string, init: MouseEventInit = {}) =>
  act(async () => { element.dispatchEvent(new MouseEvent(type, { bubbles: true, button: 0, ...init })); });

describe("Edit mode", () => {
  it("is off by default, turns card headers into move-only handles, and saves moves across remounts", async () => {
    const team = [agent("a", "Ada")];
    await render(team);
    const original = left("a");
    expect(handle("Ada")).toBeNull();
    expect(buttonByText("Magic sort")).toBeUndefined();
    expect(buttonByText("Edit mode")!.getAttribute("aria-pressed")).toBe("false");

    await act(async () => buttonByText("Edit mode")!.click());
    const grip = handle("Ada")!;
    expect(grip.getAttribute("role")).toBe("button");
    expect(grip.querySelector("[inert]")).not.toBeNull();

    // Drag right, then cancel: the card returns to where it was.
    await pointer(grip.querySelector("span")!, "pointerdown", { clientX: 64, clientY: 64 });
    await pointer(grip, "pointermove", { clientX: 200, clientY: 64 });
    expect(left("a")).toBeGreaterThan(original);
    await pointer(grip, "pointercancel");
    expect(left("a")).toBe(original);

    // Escape during a drag also restores.
    const originalTop = top("a");
    await pointer(grip, "pointerdown", { clientX: 64, clientY: 64 });
    await pointer(grip, "pointermove", { clientX: 64, clientY: 300 });
    expect(top("a")).toBeGreaterThan(originalTop);
    await press(grip, "Escape");
    expect([left("a"), top("a")]).toEqual([original, originalTop]);

    await press(handle("Ada")!, "ArrowRight");
    expect(left("a")).toBe(original + 32);
    const before = top("a");
    await press(handle("Ada")!, "ArrowDown", { shiftKey: true });
    expect(top("a")).toBe(before + 48);

    await act(async () => buttonByText("Edit mode")!.click());
    expect(handle("Ada")).toBeNull();

    await remount(team);
    expect(left("a")).toBe(original + 32);
    expect(top("a")).toBe(before + 48);
    expect(buttonByText("Edit mode")!.getAttribute("aria-pressed")).toBe("false");
    const saved = JSON.parse(localStorage.getItem(teamStorageKey("fixture"))!);
    expect(saved.version).toBe(1);
    expect(saved.positions.a).toEqual({ x: original + 32, y: before + 48 });
  });

  it("keeps a working view when saved data is corrupt or storage is blocked", async () => {
    localStorage.setItem(teamStorageKey("fixture"), "{not json");
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("blocked"); });
    await render([agent("a", "Ada"), agent("b", "Bea")]);
    expect(card("a")).not.toBeNull();
    expect(card("b")).not.toBeNull();
    expect(container.querySelector("[role=alert]")?.textContent).toMatch(/Browser storage is unavailable/);
  });
});

describe("Magic sort", () => {
  it("tidies a stray card back into its reporting level and can be undone", async () => {
    const team = [agent("boss", "Boss"), agent("x", "Xavi", "boss"), agent("y", "Yara", "boss")];
    await render(team);
    await act(async () => buttonByText("Edit mode")!.click());
    const home = { boss: [left("boss"), top("boss")], x: [left("x"), top("x")], y: [left("y"), top("y")] };
    for (let i = 0; i < 10; i++) await press(handle("Yara")!, "ArrowDown", { shiftKey: true });
    const strayTop = top("y");
    expect(strayTop).toBeGreaterThan(home.y[1]! + 400);

    const fitScale = scaleOf();
    await act(async () => (container.querySelector("[aria-label='Zoom in']") as HTMLButtonElement).click());
    expect(scaleOf()).not.toBe(fitScale);

    await act(async () => buttonByText("Magic sort")!.click());
    expect(scaleOf()).toBe(fitScale);
    // Yara rejoins Xavi's row (same reporting level); the boss stays above them.
    expect(top("y")).toBe(top("x"));
    expect(top("boss")).toBeLessThan(top("x"));
    const sorted = { boss: [left("boss"), top("boss")], x: [left("x"), top("x")], y: [left("y"), top("y")] };

    await act(async () => buttonByText("Undo sort")!.click());
    expect(top("y")).toBe(strayTop);
    expect(buttonByText("Undo sort")!.disabled).toBe(true);

    // Sorting again lands in the same place, and repeating it changes nothing.
    await act(async () => buttonByText("Magic sort")!.click());
    expect({ boss: [left("boss"), top("boss")], x: [left("x"), top("x")], y: [left("y"), top("y")] }).toEqual(sorted);
    await act(async () => buttonByText("Magic sort")!.click());
    expect({ boss: [left("boss"), top("boss")], x: [left("x"), top("x")], y: [left("y"), top("y")] }).toEqual(sorted);
  });

  it("places a newcomer in a free slot without moving anyone", async () => {
    const team = [agent("a", "Ada"), agent("b", "Bea")];
    await render(team);
    await act(async () => buttonByText("Edit mode")!.click());
    await press(handle("Ada")!, "ArrowRight"); // saves every current position
    const saved = { a: [left("a"), top("a")], b: [left("b"), top("b")] };
    await render([...team, agent("c", "Cy")]);
    expect({ a: [left("a"), top("a")], b: [left("b"), top("b")] }).toEqual(saved);
    const c = { x: left("c"), y: top("c") };
    for (const id of ["a", "b"]) {
      const overlaps = Math.abs(c.x - left(id)) < 320 && Math.abs(c.y - top(id)) < 280;
      expect(overlaps).toBe(false);
    }
  });
});

describe("lines, relationships and settings", () => {
  const team = [agent("lead", "Head Engineer"), agent("report", "Hanafy", "lead", "designer")];
  const links: AgentLink[] = [{ from: "lead", to: "report", kind: "waiting", tasks: ["PAP-1 · Spec"] }];

  it("draws a solid reporting line and a dashed work arrow", async () => {
    await render(team, links);
    const report = container.querySelector("path[data-kind=report]")!;
    const waiting = container.querySelector("path[data-kind=waiting]")!;
    expect(report.getAttribute("d")).toMatch(/^M /);
    expect(report.getAttribute("stroke-dasharray")).toBeNull();
    expect(waiting.getAttribute("stroke-dasharray")).not.toBeNull();
    expect(report.getAttribute("marker-end")).toMatch(/^url\(#/);
  });

  it("lists relationships in plain language and closes on an outside click", async () => {
    await render(team, links);
    const trigger = buttonByText("Relationships (2)")!;
    await act(async () => trigger.click());
    const panel = document.querySelector("[aria-label='Team relationships']")!;
    expect(panel.textContent).toContain("Hanafy reports to Head Engineer");
    expect(panel.textContent).toContain("Head Engineer is waiting on Hanafy");
    expect(panel.textContent).toContain("PAP-1 · Spec");
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
    await act(async () => {
      document.body.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, button: 0 }));
      document.body.click();
    });
    expect(document.querySelector("[aria-label='Team relationships']")).toBeNull();
  });

  it("hides reporting lines, arrowheads and colours from the settings popover", async () => {
    await render(team, links);
    const coloured = card("lead").querySelector<HTMLElement>("[data-color]")!.dataset.color;
    await act(async () => (container.querySelector("[aria-label='View settings']") as HTMLButtonElement).click());
    const toggle = (label: string) => {
      const id = [...document.querySelectorAll("label")].find((element) => element.textContent === label)!.htmlFor;
      return document.getElementById(id) as HTMLButtonElement;
    };
    await act(async () => toggle("Reporting lines").click());
    expect(container.querySelector("path[data-kind=report]")).toBeNull();
    expect(container.querySelector("path[data-kind=waiting]")).not.toBeNull();
    await act(async () => toggle("Arrowheads").click());
    expect(container.querySelector("path[data-kind=waiting]")!.getAttribute("marker-end")).toBeNull();
    await act(async () => toggle("Role colours").click());
    expect(card("lead").querySelector<HTMLElement>("[data-color]")!.dataset.color).not.toBe(coloured);
    expect(JSON.parse(localStorage.getItem(teamStorageKey("fixture"))!).reporting).toBe(false);
  });

  it("collapses direct reports and brings them back with Show all agents", async () => {
    await render(team, links);
    await act(async () => buttonByText("Hide 1 direct report")!.click());
    expect(container.querySelector("[data-team-card=report]")).toBeNull();
    await act(async () => (container.querySelector("[aria-label='View settings']") as HTMLButtonElement).click());
    await act(async () => buttonByText("Show all agents")!.click());
    expect(container.querySelector("[data-team-card=report]")).not.toBeNull();
  });
});
