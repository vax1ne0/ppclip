"""Read-only CUA adapter. Input is still performed by ppclip's guarded action path.

Pinned Driver 0.35.4 returns AT-SPI element frames in desktop coordinates on X11.
Only labels, roles and geometry are retained; editable values are discarded.
"""
import json
import subprocess

DRIVER = "/opt/cua/cua-driver"
SOCKET = "/tmp/ppclip/cua.sock"


def call(tool, arguments):
    result = subprocess.run([DRIVER, "call", tool, json.dumps({"session": "ppclip-observer", **arguments}), "--socket", SOCKET],
                            capture_output=True, timeout=3, check=True)
    return json.loads(result.stdout)


def snapshot():
    windows = call("list_windows", {"on_screen_only": True}).get("windows", [])
    result = []
    for window in sorted(windows, key=lambda value: value["window_id"])[:4]:
        try:
            state = call("get_window_state", {"pid": window["pid"], "window_id": window["window_id"],
                         "tree_format": "elements", "include_screenshot": False, "max_elements": 125, "timeout_ms": 500})
        except (subprocess.SubprocessError, OSError, ValueError):
            continue  # Apps outside the immutable observation manifest stay inaccessible.
        for element in state.get("elements", []):
            frame = element.get("frame") or {}
            role = str(element.get("role", "")).lower()
            if not all(isinstance(frame.get(key), (int, float)) for key in ("x", "y", "w", "h")):
                continue
            if frame["w"] <= 0 or frame["h"] <= 0:
                continue
            result.append({"role": role, "name": str(element.get("label") or "")[:200],
                           **{key: int(frame[key]) for key in ("x", "y", "w", "h")},
                           "enabled": element.get("enabled") is not False, "sensitive": "password" in role,
                           "appPid": window["pid"], "windowId": window["window_id"]})
            if len(result) >= 250:
                return result
    return result
