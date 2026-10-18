/** noVNC lite passes query values straight to RFB's boolean properties. */
export function viewerSrc(ticket: string, mode: "view" | "control") {
  const base = `/api/ppclip/computer-use/view/${ticket}`;
  const params = new URLSearchParams({ scale: "true", path: `${base.slice(1)}/websockify` });
  // Even the string "false" is truthy in noVNC lite. Omit the parameter
  // for control so its default is the boolean false and input is enabled.
  if (mode === "view") params.set("view_only", "true");
  return `${base}/vnc_lite.html?${params.toString()}`;
}

/** The sandboxed frame reports stream failures; the parent validates its source. */
export const viewerReconnectScript = `<script>
(() => {
  let sent = false;
  const notify = () => {
    if (sent) return;
    sent = true;
    parent.postMessage({ type: "ppclip:computer-view-disconnected", src: location.pathname + location.search }, "*");
  };
  window.ppclipNotifyViewerDisconnected = notify;
  if (document.documentElement.dataset.expired === "true") notify();
})();
</script>`;

/** The iframe cannot inherit the app's CSS, so its parent supplies theme tokens. */
export const viewerToolbarScript = `<script>
(() => {
  const tokens = ["background", "foreground", "border", "accent", "ring", "status-task-done", "status-task-todo", "destructive"];
  window.addEventListener("message", event => {
    if (event.source !== parent || event.data?.type !== "ppclip:computer-view-theme") return;
    for (const token of tokens) {
      const value = event.data.tokens?.[token];
      if (typeof value === "string" && value.length < 256) document.documentElement.style.setProperty("--" + token, value);
    }
  });
  window.ppclipSetViewerStatus = (text, viewOnly) => {
    const state = text.startsWith("Connected") ? "connected" : text === "Connecting" ? "connecting" : "disconnected";
    document.documentElement.dataset.connection = state;
    const status = document.getElementById("status");
    status.textContent = state === "connected" ? "Connected" : state === "connecting" ? "Connecting…" : "Disconnected";
    status.title = text;
    const button = document.getElementById("sendCtrlAltDelButton");
    button.disabled = state !== "connected" || viewOnly;
    button.title = viewOnly ? "Take control to send Ctrl+Alt+Delete" : "Send Ctrl+Alt+Delete to the computer";
  };
})();
</script>`;

export const viewerToolbarStyle = `<style id="ppclip-viewer-toolbar">
:root { color-scheme: light; --background: oklch(1 0 0); --foreground: oklch(.145 0 0); --border: oklch(.922 0 0); --accent: oklch(.97 0 0); --ring: oklch(.708 0 0); --status-task-done: #22c55e; --status-task-todo: #eab308; --destructive: #ef4444; }
@media (prefers-color-scheme: dark) { :root { color-scheme: dark; --background: oklch(.205 0 0); --foreground: oklch(.985 0 0); --border: oklch(1 0 0 / 10%); --accent: oklch(.269 0 0); } }
body { background: var(--background); color: var(--foreground); font-family: Inter, ui-sans-serif, system-ui, sans-serif; }
#top_bar { box-sizing: border-box; display: flex; align-items: center; justify-content: space-between; gap: 12px; min-height: 32px; padding: 3px 10px; background: var(--background); color: var(--foreground); border-bottom: 1px solid var(--border); font: 500 12px/1.4 Inter, ui-sans-serif, system-ui, sans-serif; }
#status { display: flex; align-items: center; gap: 7px; min-width: 0; text-align: left; }
#status::before { content: ""; flex: 0 0 7px; height: 7px; border-radius: 50%; background: var(--status-task-todo); }
:root[data-connection="connected"] #status::before { background: var(--status-task-done); }
:root[data-connection="disconnected"] #status::before { background: var(--destructive); }
#sendCtrlAltDelButton { position: static; flex-shrink: 0; min-height: 24px; padding: 2px 8px; border: 1px solid var(--border); border-radius: 6px; background: transparent; color: var(--foreground); font: inherit; font-size: 11px; cursor: pointer; }
#sendCtrlAltDelButton:hover:not(:disabled) { background: var(--accent); }
#sendCtrlAltDelButton:focus-visible { outline: 2px solid var(--ring); outline-offset: 2px; }
#sendCtrlAltDelButton:disabled { cursor: default; opacity: .5; }
#screen { min-height: 0; }
</style>`;

export function viewerDocument(html: string) {
  return html.replace(/<head(?:\s[^>]*)?>/i, head => head + viewerReconnectScript + viewerToolbarScript)
    .replace(/<\/head>/i, viewerToolbarStyle + "</head>")
    .replace('<div id="status">Loading</div>', '<div id="status" role="status" aria-live="polite">Connecting…</div>')
    .replace('<div id="sendCtrlAltDelButton">Send CtrlAltDel</div>', '<button type="button" id="sendCtrlAltDelButton" aria-label="Send Ctrl+Alt+Delete" disabled>Ctrl+Alt+Del</button>')
    .replace("document.getElementById('status').textContent = text;", "window.ppclipSetViewerStatus(text, rfb?.viewOnly ?? true);")
    .replace('rfb.addEventListener("disconnect", disconnectedFromServer);',
      'rfb.addEventListener("disconnect", disconnectedFromServer); rfb.addEventListener("disconnect", () => window.ppclipNotifyViewerDisconnected());');
}

export function expiredViewerDocument() {
  return `<!doctype html><html data-expired="true"><head><meta charset="utf-8">${viewerToolbarStyle}</head><body><p role="status">Reconnecting to the live view…</p>${viewerReconnectScript}</body></html>`;
}
