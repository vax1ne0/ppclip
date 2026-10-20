"""Detect Chromium sandbox support once, with an isolated disposable profile."""
import os
import subprocess
import signal
import tempfile


def sandbox_status(binary, env, mode="auto"):
    if mode not in ("auto", "required", "disabled"):
        raise ValueError("PPCLIP_CHROMIUM_SANDBOX must be auto, required or disabled")
    if mode == "disabled":
        return {"enabled": False, "reason": "disabled_by_operator"}
    with tempfile.TemporaryDirectory(prefix="ppclip-chromium-probe-") as profile:
        try:
            process = subprocess.Popen([
                binary, "--headless=new", "--disable-gpu", "--no-first-run",
                "--disable-background-networking", f"--user-data-dir={profile}",
                "--dump-dom", "about:blank",
            ], env=env, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, start_new_session=True)
            try:
                output, _ = process.communicate(timeout=8)
                enabled = process.returncode == 0 and b"<html" in output.lower()
            finally:
                try:
                    os.killpg(process.pid, signal.SIGKILL)
                except ProcessLookupError:
                    pass
                process.communicate()
        except (OSError, subprocess.TimeoutExpired):
            enabled = False
    if mode == "required" and not enabled:
        raise RuntimeError("Chromium's sandbox is required but unavailable in this runtime")
    return {"enabled": enabled, "reason": "probe_passed" if enabled else "runtime_unavailable"}
