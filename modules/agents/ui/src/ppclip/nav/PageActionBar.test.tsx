// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { PageActionBar, PageActionBarHost, PageActionBarProvider } from "./PageActionBar";

it("docks actions outside scrolling content and removes them when a form leaves", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const host = document.createElement("div"), root = createRoot(host), save = vi.fn();
  const page = (show: boolean) => <PageActionBarProvider><main>{show && <PageActionBar><button onClick={save}>Save</button></PageActionBar>}</main><PageActionBarHost bottom="var(--tc-composer-visible-nav-offset)" /></PageActionBarProvider>;
  try {
    await act(async () => root.render(page(true)));
    expect(host.querySelector("main footer")).toBeNull();
    expect(host.querySelector('[data-slot="page-action-dock"] footer')).not.toBeNull();
    expect(host.querySelector<HTMLElement>('[data-slot="page-action-dock"]')?.style.bottom).toBe("var(--tc-composer-visible-nav-offset)");
    await act(async () => host.querySelector("button")!.click()); expect(save).toHaveBeenCalledOnce();
    await act(async () => root.render(page(false)));
    expect(host.querySelector('[data-slot="page-action-dock"]')?.childElementCount).toBe(0);
  } finally { await act(async () => root.unmount()); vi.unstubAllGlobals(); }
});
