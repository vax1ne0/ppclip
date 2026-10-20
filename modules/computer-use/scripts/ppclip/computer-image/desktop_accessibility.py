#!/usr/bin/env python3
"""Bounded AT-SPI observations. Invoked in a disposable child, never in the HTTP thread.

Inspired by OpenAgentFleet's isolated-query design. No editable-field text is read.
"""
import json
import os
from collections import deque


def snapshot():
    import pyatspi
    desktop = pyatspi.Registry.getDesktop(0)
    queue = deque([(desktop, 0)])
    result = []
    visited = 0
    roles = {"push button", "toggle button", "check box", "radio button", "combo box",
             "menu item", "check menu item", "radio menu item", "entry", "text",
             "password text", "page tab", "tab", "slider", "spin button", "list item", "link"}
    while queue and visited < 3000 and len(result) < 250:
        node, depth = queue.popleft()
        visited += 1
        try:
            role = node.getRoleName()
            state = node.getState()
            if role in roles and state.contains(pyatspi.STATE_SHOWING):
                rect = node.queryComponent().getExtents(pyatspi.DESKTOP_COORDS)
                if rect.width > 0 and rect.height > 0:
                    result.append({"role": role, "name": str(node.name or "")[:200],
                                   "x": rect.x, "y": rect.y, "w": rect.width, "h": rect.height,
                                   "enabled": state.contains(pyatspi.STATE_ENABLED),
                                   "sensitive": "password" in role, "application": str(node.getApplication().name or "")[:200]})
            if depth < 12:
                for i in range(min(node.childCount, 250)):
                    queue.append((node.getChildAtIndex(i), depth + 1))
        except Exception:
            continue
    return result


if __name__ == "__main__":
    try:
        if os.environ.get("PPCLIP_DESKTOP_DRIVER") == "cua":
            from cua_observation import snapshot as read_cua
            nodes = read_cua()
        else:
            nodes = snapshot()
        print(json.dumps({"elements": nodes}))
    except Exception:
        print(json.dumps({"elements": [], "unavailable": True}))
