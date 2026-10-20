"""Reference lifecycle and safe native-element actions; input remains in control.py."""
import json
import subprocess
import sys
import time


class DesktopTools:
    def __init__(self, env, act, refusal):
        self.env, self.act, self.refusal = env, act, refusal
        self.previous, self.observed = None, 0

    def read(self):
        try:
            budget = 6 if self.env.get("PPCLIP_DESKTOP_DRIVER") == "cua" else 3
            process = subprocess.run([sys.executable, "/opt/ppclip/desktop_accessibility.py"], env=self.env,
                                     capture_output=True, timeout=budget, check=True)
            value = json.loads(process.stdout)
            return value.get("elements", [])[:250]
        except (OSError, subprocess.SubprocessError, ValueError):
            return []

    def page(self, pattern):
        import re
        nodes = self.read()
        self.previous, self.observed = nodes, time.monotonic()
        return {"url": None, "title": "Desktop accessibility", "text": "" if nodes else "Accessibility unavailable or no controls exposed. Use a screenshot instead.",
                "elements": [{"ref": i + 1, "tag": "desktop", "role": node["role"], "name": node["name"],
                              "inputType": "password" if node["sensitive"] else None,
                              "sensitive": node["sensitive"], "irreversible": bool(re.search(pattern, node["name"], re.I))}
                             for i, node in enumerate(nodes)]}

    def action(self, action, confirm, pattern):
        import re
        previous = self.previous
        if previous is None or time.monotonic() - self.observed > 30:
            raise self.refusal("stale_ref", "Desktop changed. Call desktop_page again.")
        ref = action.get("ref")
        if not isinstance(ref, int) or isinstance(ref, bool) or ref < 1 or ref > len(previous):
            raise self.refusal("stale_ref", "Invalid desktop element. Call desktop_page again.")
        node = previous[ref - 1]
        # Unrelated controls may animate or disappear. Revalidate this exact
        # target (identity, label, role and geometry), and refuse ambiguity.
        if self.read().count(node) != 1:
            raise self.refusal("stale_ref", "The target changed. Call desktop_page again.")
        if not node["enabled"]:
            raise self.refusal("invalid", "This control is disabled.")
        if node["sensitive"]:
            raise self.refusal("sensitive_field", "Ask for a person to use a password field.")
        if re.search(pattern, node["name"], re.I) and not confirm:
            raise self.refusal("needs_confirm", "This control requires explicit confirmation.")
        events = [{"type": "click", "x": node["x"] + node["w"] // 2, "y": node["y"] + node["h"] // 2}]
        if action.get("type") == "type":
            if node["role"] not in ("entry", "text", "spin button"):
                raise self.refusal("invalid", "Typing requires a text-entry control.")
            value = action.get("text")
            if not isinstance(value, str) or not 1 <= len(value) <= 2000:
                raise self.refusal("invalid", "Text must contain 1–2000 characters.")
            events.append({"type": "type", "text": value})
        elif action.get("type") != "click":
            raise self.refusal("invalid", "Unsupported desktop action")
        self.previous = None  # One action consumes the observation, including partial failures.
        return self.act(events, confirm, pattern)
