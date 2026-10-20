import { describe, expect, it } from "vitest";
import vm from "node:vm";
import { expiredViewerDocument, viewerDocument, viewerReconnectScript, viewerSrc, viewerToolbarScript } from "../ppclip/computer-use/viewer.js";

describe("noVNC lite viewer input", () => {
  for (const mode of ["view", "control"] as const) {
    it(`${mode} uses the correct input mode with noVNC's query semantics`, () => {
      const url = new URL(viewerSrc("test-ticket", mode), "http://localhost:3410");
      // noVNC lite returns strings for supplied query values and a boolean
      // default otherwise. RFB checks viewOnly by truthiness, not parsing.
      const viewOnly = Boolean(url.searchParams.get("view_only") ?? false);
      expect(viewOnly).toBe(mode === "view");
      expect(url.pathname).toBe("/api/ppclip/computer-use/view/test-ticket/vnc_lite.html");
      expect(url.searchParams.get("path")).toBe("api/ppclip/computer-use/view/test-ticket/websockify");
      expect(url.searchParams.get("scale")).toBe("true");
    });
  }
});

describe("viewer toolbar", () => {
  it("removes the keyboard shortcut control and binding while retaining accessible status", () => {
    const doc = viewerDocument(`<head><style>#top_bar { background: blue; }</style></head>
      <div id="status">Loading</div><div id="sendCtrlAltDelButton">Send CtrlAltDel</div>
      <script>document.getElementById('sendCtrlAltDelButton')
        .onclick = sendCtrlAltDel;
      document.getElementById('status').textContent = text;</script>`);
    expect(doc).toContain('role="status" aria-live="polite"');
    expect(doc).not.toContain('sendCtrlAltDelButton');
    expect(doc).not.toContain('.onclick = sendCtrlAltDel;');
    expect(doc).toContain("window.ppclipSetViewerStatus(text);");
    expect(doc.indexOf('id="ppclip-viewer-toolbar"')).toBeGreaterThan(doc.indexOf("background: blue"));
  });

  it("reflects connection state and accepts theme tokens only from the parent", () => {
    const root = { dataset: {} as Record<string, string>, style: { setProperty: (key: string, value: string) => { applied[key] = value; } } };
    const status = { textContent: "", title: "" };
    const applied: Record<string, string> = {};
    const parent = {};
    let receive!: (event: { source: unknown; data: unknown }) => void;
    const window = { addEventListener: (_name: string, handler: typeof receive) => { receive = handler; }, ppclipSetViewerStatus: (_text: string, _viewOnly: boolean) => {} };
    vm.runInNewContext(viewerToolbarScript.replace(/<\/?script>/g, ""), {
      window, parent, document: { documentElement: root, getElementById: (id: string) => id === "status" ? status : null },
    });
    window.ppclipSetViewerStatus("Connecting", true);
    expect(root.dataset.connection).toBe("connecting");
    window.ppclipSetViewerStatus("Connected to private desktop name", false);
    expect(status.textContent).toBe("Connected");
    expect(status.title).toContain("private desktop name");
    expect(root.dataset.connection).toBe("connected");
    window.ppclipSetViewerStatus("Connected to desktop", true);
    window.ppclipSetViewerStatus("Something went wrong, connection is closed", false);
    expect(status.textContent).toBe("Disconnected");
    expect(root.dataset.connection).toBe("disconnected");
    const data = { type: "ppclip:computer-view-theme", compact: true, tokens: { background: "#171717", arbitrary: "ignored" } };
    receive({ source: {}, data });
    expect(applied).toEqual({});
    expect(root.dataset.compact).toBeUndefined();
    receive({ source: parent, data });
    expect(applied).toEqual({ "--background": "#171717" });
    expect(root.dataset.compact).toBe("true");
    receive({ source: parent, data: { ...data, compact: false } });
    expect(root.dataset.compact).toBe("false");
  });
});

describe("viewer reconnect bridge", () => {
  it("reports an expired viewer once without replacing native browser APIs", () => {
    const messages: unknown[] = [];
    const window: { ppclipNotifyViewerDisconnected?: () => void } = {};
    vm.runInNewContext(viewerReconnectScript.replace(/<\/?script>/g, ""), {
      window, document: { documentElement: { dataset: { expired: "true" } } },
      parent: { postMessage: (...args: unknown[]) => messages.push(args) },
      location: { pathname: "/view/t/vnc_lite.html", search: "?view_only=true" },
    });
    window.ppclipNotifyViewerDisconnected!();
    expect(messages).toEqual([[{ type: "ppclip:computer-view-disconnected", src: "/view/t/vnc_lite.html?view_only=true" }, "*"]]);
  });

  it("injects the bridge before viewer scripts and replaces expired JSON with reconnect HTML", () => {
    expect(viewerDocument('<html><head><script type="module">viewer()</script></head></html>')).toContain('<head>' + viewerReconnectScript);
    const doc = viewerDocument('<head></head><script>rfb.addEventListener("disconnect", disconnectedFromServer);</script>');
    expect(doc).toContain('rfb.addEventListener("disconnect", () => window.ppclipNotifyViewerDisconnected());');
    expect(expiredViewerDocument()).toContain('data-expired="true"');
    expect(expiredViewerDocument()).toContain(viewerReconnectScript);
  });
});
