from __future__ import annotations

import hashlib
import io
import json
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from idelite import updater


class UpdaterTests(unittest.TestCase):
    def test_version_tuple_accepts_release_tags(self) -> None:
        self.assertEqual(updater._version_tuple("v1.4.2"), (1, 4, 2, 0))
        self.assertEqual(updater._version_tuple("1.4"), updater._version_tuple("1.4.0"))
        self.assertGreater(updater._version_tuple("1.10.0"), updater._version_tuple("1.9.0"))

    def test_version_tuple_rejects_invalid_values(self) -> None:
        for version in ("latest", "v1.0/../../x", "1.0-rc1", "vv1.0", "1.0; echo bad"):
            with self.subTest(version=version), self.assertRaises(updater.UpdateError):
                updater._version_tuple(version)

    def test_check_update_is_hidden_for_source_runs(self) -> None:
        with (
            mock.patch.object(updater, "_installed_version", return_value=(None, None)),
            mock.patch.object(updater, "_release") as release,
        ):
            self.assertEqual(updater.check_update(), {"supported": False})
            release.assert_not_called()

    def test_check_update_finds_debian_asset(self) -> None:
        release = {
            "tag_name": "v0.3.0",
            "assets": [
                {"name": "idelite_0.3.0_all.deb"},
                {"name": "SHA256SUMS.txt"},
            ],
        }
        with (
            mock.patch.object(updater, "_installed_version", return_value=("linux-deb", "0.2.0")),
            mock.patch.object(updater, "_release", return_value=release),
        ):
            status = updater.check_update()
        self.assertTrue(status["available"])
        self.assertTrue(status["asset_available"])
        self.assertEqual(status["current_version"], "0.2.0")
        self.assertEqual(status["latest_version"], "0.3.0")

    def test_installer_runner_waits_for_current_process(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            directory = Path(temporary)
            with mock.patch.object(updater.subprocess, "Popen") as popen:
                updater._install_after_exit(
                    directory / "update.deb",
                    directory,
                    123,
                    ["idelite", "/tmp/project"],
                )
        args = popen.call_args.args[0]
        self.assertEqual(args[:2], [updater.sys.executable, "-c"])
        self.assertIn("pkexec", args[4])
        self.assertIn("/tmp/project", args[5])
        self.assertTrue(popen.call_args.kwargs["start_new_session"])

    def test_sha256_streams_file(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary) / "installer"
            path.write_bytes(b"IDELite")
            self.assertEqual(updater._sha256(path), hashlib.sha256(b"IDELite").hexdigest())

    def test_release_rejects_invalid_responses(self) -> None:
        for payload in ([], {"assets": {}}, {"assets": [], "tag_name": "v1.0", "prerelease": True}):
            with self.subTest(payload=payload), mock.patch.object(
                updater.urllib.request, "urlopen", return_value=io.BytesIO(json.dumps(payload).encode())
            ), self.assertRaises(updater.UpdateError):
                updater._release()

    def test_download_is_bounded(self) -> None:
        with tempfile.TemporaryDirectory() as temporary, mock.patch.object(
            updater.urllib.request, "urlopen", return_value=io.BytesIO(b"too large")
        ), self.assertRaises(updater.UpdateError):
            updater._download("https://github.com/example", Path(temporary) / "file", 4)

    def test_installed_version_requires_installed_location(self) -> None:
        with mock.patch.object(updater.sys, "argv", ["run.py"]), mock.patch.object(
            updater.subprocess, "run"
        ) as run:
            self.assertEqual(updater._installed_version(), (None, None))
            run.assert_not_called()

    def test_check_update_finds_windows_installer(self) -> None:
        release = {
            "tag_name": "v0.3.0",
            "assets": [
                {"name": "IDELite-Setup-0.3.0.exe"},
                {"name": "SHA256SUMS.txt"},
            ],
        }
        with (
            mock.patch.object(updater, "_installed_version", return_value=("windows-exe", "0.2.0")),
            mock.patch.object(updater, "_release", return_value=release),
        ):
            status = updater.check_update()
        self.assertTrue(status["available"])
        self.assertTrue(status["asset_available"])
        self.assertEqual(status["platform"], "windows-exe")


class InstallTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.stage = Path(self.temporary.name) / "stage"
        self.stage.mkdir()
        self.name = "idelite_0.2.0_all.deb"
        self.content = b"fake Debian package"
        self.release = {
            "tag_name": "v0.2.0",
            "assets": [
                {"name": name, "browser_download_url":
                 f"https://github.com/pythonIsFast/IDELite/releases/download/v0.2.0/{name}"}
                for name in (self.name, "SHA256SUMS.txt")
            ],
        }
        for target, options in (
            ("_installed_version", {"return_value": ("linux-deb", "0.1.0")}),
            ("_release", {"return_value": self.release}),
            ("_download", {"side_effect": self.download}),
            ("_install_after_exit", {}),
        ):
            patcher = mock.patch.object(updater, target, **options)
            setattr(self, target, patcher.start())
            self.addCleanup(patcher.stop)
        patcher = mock.patch.object(updater.tempfile, "mkdtemp", return_value=str(self.stage))
        patcher.start()
        self.addCleanup(patcher.stop)
        patcher = mock.patch.object(updater.os, "access", return_value=True)
        patcher.start()
        self.addCleanup(patcher.stop)

    def download(self, url: str, target: Path, limit: int) -> None:
        if target.name == "SHA256SUMS.txt":
            target.write_text(f"{hashlib.sha256(self.content).hexdigest()}  {self.name}\n")
        else:
            target.write_bytes(self.content)

    def test_install_verifies_and_stages_package(self) -> None:
        restart = ["/usr/bin/idelite", "/project with spaces"]
        self.assertEqual(updater.install_update(restart), {"status": "started", "version": "0.2.0"})
        args = self._install_after_exit.call_args.args
        self.assertEqual(args[0].read_bytes(), self.content)
        self.assertEqual(args[3], restart)

    def test_corrupt_package_is_not_installed_and_is_cleaned(self) -> None:
        def corrupted(url: str, target: Path, limit: int) -> None:
            self.download(url, target, limit)
            if target.name == self.name:
                target.write_bytes(b"corrupted")
        self._download.side_effect = corrupted
        with self.assertRaisesRegex(updater.UpdateError, "checksum"):
            updater.install_update(["idelite"])
        self._install_after_exit.assert_not_called()
        self.assertFalse(self.stage.exists())

    def test_untrusted_asset_url_is_rejected(self) -> None:
        self.release["assets"][0]["browser_download_url"] = "http://localhost/update.deb"
        with self.assertRaisesRegex(updater.UpdateError, "URL"):
            updater.install_update(["idelite"])
        self._download.assert_not_called()
        self._install_after_exit.assert_not_called()

    def test_missing_checksum_prevents_download(self) -> None:
        self.release["assets"].pop()
        with self.assertRaisesRegex(updater.UpdateError, "checksums"):
            updater.install_update(["idelite"])
        self._download.assert_not_called()

    def test_download_failure_is_cleaned(self) -> None:
        self._download.side_effect = updater.UpdateError("offline")
        with self.assertRaisesRegex(updater.UpdateError, "offline"):
            updater.install_update(["idelite"])
        self.assertFalse(self.stage.exists())
        self._install_after_exit.assert_not_called()

    def test_runner_failure_is_cleaned(self) -> None:
        self._install_after_exit.side_effect = updater.UpdateError("runner failed")
        with self.assertRaisesRegex(updater.UpdateError, "runner failed"):
            updater.install_update(["idelite"])
        self.assertFalse(self.stage.exists())

    def test_equal_version_is_not_installed(self) -> None:
        self._installed_version.return_value = ("linux-deb", "0.2.0")
        with self.assertRaisesRegex(updater.UpdateError, "up to date"):
            updater.install_update(["idelite"])
        self._download.assert_not_called()


class RunnerTests(unittest.TestCase):
    def test_runner_restarts_on_success_and_cancel_without_killing_parent(self) -> None:
        for exit_code in (0, 126):
            with self.subTest(exit_code=exit_code), tempfile.TemporaryDirectory() as temporary:
                root = Path(temporary)
                stage = root / "stage"
                stage.mkdir()
                with mock.patch.object(updater.subprocess, "Popen") as popen:
                    updater._install_after_exit(stage / "test.deb", stage, 123, ["idelite", "/project"])
                args = popen.call_args.args[0]
                with (
                    mock.patch.object(updater.sys, "argv", ["-c", *args[3:]]),
                    mock.patch.dict(updater.os.environ, {"XDG_DATA_HOME": str(root)}),
                    mock.patch.object(updater.os, "kill", side_effect=ProcessLookupError) as kill,
                    mock.patch.object(updater.subprocess, "run", return_value=mock.Mock(returncode=exit_code)) as run,
                    mock.patch.object(updater.subprocess, "Popen") as restart,
                ):
                    exec(compile(args[2], "update-runner", "exec"), {})
                kill.assert_called_once_with(123, 0)
                self.assertEqual(run.call_args.args[0][0], "/usr/bin/pkexec")
                self.assertEqual(restart.call_args.args[0], ["idelite", "/project"])
                self.assertIn(str(exit_code), (root / "idelite/update.log").read_text())
                self.assertFalse(stage.exists())

    def test_runner_aborts_if_parent_stays_alive(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            stage = root / "stage"
            stage.mkdir()
            with mock.patch.object(updater.subprocess, "Popen") as popen:
                updater._install_after_exit(stage / "test.deb", stage, 123, ["idelite"])
            args = popen.call_args.args[0]
            with (
                mock.patch.object(updater.sys, "argv", ["-c", *args[3:]]),
                mock.patch.dict(updater.os.environ, {"XDG_DATA_HOME": str(root)}),
                mock.patch("time.monotonic", side_effect=[0, 121]),
                mock.patch.object(updater.subprocess, "run") as run,
                mock.patch.object(updater.os, "kill") as kill,
                self.assertRaises(SystemExit),
            ):
                exec(compile(args[2], "update-runner", "exec"), {})
            run.assert_not_called()
            kill.assert_not_called()
            self.assertFalse(stage.exists())


if __name__ == "__main__":
    unittest.main()
