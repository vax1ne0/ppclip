#!/usr/bin/env python3
"""Restore the managed browser from the dock, including during human control.

Never execute Chromium independently: control.py owns its profile and CDP pipe.
Only map normal windows belonging to its recorded PID; ignore helper windows.
"""
import os
from pathlib import Path
import subprocess
import time


def restore():
    env = {**os.environ, "DISPLAY": ":1", "XAUTHORITY": "/tmp/ppclip/Xauthority"}
    for _ in range(6):
        try:
            pid = int(Path("/tmp/ppclip/browser.pid").read_text())
            windows = subprocess.check_output(
                ["xdotool", "search", "--all", "--pid", str(pid), "--class", "chromium"],
                env=env, timeout=2, stderr=subprocess.DEVNULL).decode().split()
            for window in windows:
                state = subprocess.check_output(["xprop", "-id", window, "WM_STATE"], env=env, timeout=2)
                if b"Normal" not in state and b"Iconic" not in state:
                    continue
                subprocess.run(["xdotool", "windowmap", window, "windowactivate", "--sync", window],
                               env=env, timeout=2, check=True)
                return
        except (OSError, ValueError, subprocess.SubprocessError):
            pass  # Chromium's existing keepalive may be relaunching it.
        time.sleep(0.25)
    raise SystemExit("The browser is still starting. Try the Chromium icon again.")


if __name__ == "__main__":
    restore()
