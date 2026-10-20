"""Offline helper regressions. Run with Python 3; no desktop/model/provider calls."""
import importlib.util
import io
import json
from pathlib import Path
import tarfile
import tempfile
import unittest
from unittest.mock import patch

IMAGE = Path(__file__).resolve().parents[2] / "modules/computer-use/scripts/ppclip/computer-image"


def load(name):
    spec = importlib.util.spec_from_file_location(name, IMAGE / (name + ".py"))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


profiles = load("profile_archive")
desktop = load("desktop_tools")
network = load("network_policy")
browser = load("browser_runtime")


def archive_with(name, kind=tarfile.REGTYPE):
    output = io.BytesIO()
    with tarfile.open(fileobj=output, mode="w:gz") as archive:
        manifest = json.dumps({"format": "ppclip-profile", "version": 1}).encode()
        info = tarfile.TarInfo(profiles.MANIFEST)
        info.size = len(manifest)
        archive.addfile(info, io.BytesIO(manifest))
        info = tarfile.TarInfo(name)
        info.type = kind
        info.linkname = "/outside"
        archive.addfile(info)
    output.seek(0)
    return output


class Profiles(unittest.TestCase):
    def test_round_trip_and_refuse_overwrite(self):
        with tempfile.TemporaryDirectory() as source, tempfile.TemporaryDirectory() as destination:
            Path(source, "chromium-profile").mkdir()
            Path(source, "chromium-profile/Cookies").write_bytes(b"test-private-profile")
            output = io.BytesIO()
            profiles.backup(Path(source), output)
            output.seek(0)
            with patch.object(profiles.os, "chown"):
                profiles.restore(Path(destination), output)
            self.assertEqual(Path(destination, "chromium-profile/Cookies").read_bytes(), b"test-private-profile")
            with self.assertRaisesRegex(ValueError, "empty"):
                profiles.restore(Path(destination), io.BytesIO())

    def test_malicious_archives_leave_the_destination_empty(self):
        for name, kind in [("profile/../../escape", tarfile.REGTYPE), ("/absolute", tarfile.REGTYPE),
                           ("profile/link", tarfile.SYMTYPE), ("profile/hardlink", tarfile.LNKTYPE),
                           ("profile/device", tarfile.CHRTYPE)]:
            with self.subTest(name=name), tempfile.TemporaryDirectory() as destination:
                with patch.object(profiles.os, "chown"), self.assertRaises(ValueError):
                    profiles.restore(Path(destination), archive_with(name, kind))
                self.assertEqual(list(Path(destination).iterdir()), [])

    def test_corrupt_gzip_is_rejected_before_commit(self):
        data = bytearray(archive_with("profile/file").getvalue())
        data[-8] ^= 255
        with tempfile.TemporaryDirectory() as destination, patch.object(profiles.os, "chown"):
            with self.assertRaises(OSError):
                profiles.restore(Path(destination), io.BytesIO(data))
            self.assertEqual(list(Path(destination).iterdir()), [])


class NativeControls(unittest.TestCase):
    def setUp(self):
        class Refusal(Exception):
            def __init__(self, code, message):
                self.code = code
                super().__init__(message)
        self.refusal = Refusal
        self.actions = []
        self.tools = desktop.DesktopTools({}, lambda events, *_: self.actions.extend(events), Refusal)
        self.nodes = [{"role": "entry", "name": "Search", "x": 1, "y": 2, "w": 20, "h": 10, "enabled": True, "sensitive": False}]
        self.tools.read = lambda: self.nodes.copy()

    def test_consumes_references_and_rejects_layout_changes(self):
        self.tools.page("delete")
        self.tools.action({"type": "click", "ref": 1}, False, "delete")
        self.assertEqual(len(self.actions), 1)
        with self.assertRaises(self.refusal):
            self.tools.action({"type": "click", "ref": 1}, False, "delete")
        self.tools.page("delete")
        self.nodes = [{**self.nodes[0], "x": 100}]
        with self.assertRaises(self.refusal):
            self.tools.action({"type": "click", "ref": 1}, False, "delete")

    def test_refuses_secrets_and_unconfirmed_destructive_controls(self):
        for change in [{"sensitive": True}, {"name": "Delete account"}]:
            self.nodes = [{**self.nodes[0], **change}]
            self.tools.page("delete")
            with self.assertRaises(self.refusal):
                self.tools.action({"type": "type", "ref": 1, "text": "secret"}, False, "delete")
        self.assertEqual(self.actions, [])

    def test_unrelated_changes_do_not_expire_an_unchanged_target(self):
        self.tools.page("delete")
        self.nodes.append({**self.nodes[0], "name": "Other control", "x": 300})
        self.tools.action({"type": "click", "ref": 1}, False, "delete")
        self.assertEqual(len(self.actions), 1)


class RuntimePolicy(unittest.TestCase):
    def test_firewall_fails_startup_when_rules_cannot_be_installed(self):
        import subprocess
        with patch.object(network.subprocess, "run", side_effect=subprocess.CalledProcessError(1, "iptables")):
            with self.assertRaises(subprocess.CalledProcessError):
                network.install()

    def test_disabled_sandbox_mode_is_explicit_and_invalid_modes_fail(self):
        self.assertFalse(browser.sandbox_status("missing", {}, "disabled")["enabled"])
        with self.assertRaises(ValueError):
            browser.sandbox_status("missing", {}, "unknown")
        with self.assertRaises(RuntimeError):
            browser.sandbox_status("missing-binary", {}, "required")


if __name__ == "__main__":
    unittest.main()
