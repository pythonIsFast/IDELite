from __future__ import annotations

import threading
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest import mock

from run import WindowApi, webview_assets


def bridge_window():
    return SimpleNamespace(
        uid="test", js_api_endpoint="test", text_select=True, zoomable=False,
        draggable=False, easy_drag=False, frameless=False, state={},
    )


class WindowTests(unittest.TestCase):
    def test_quit_requires_staged_update(self) -> None:
        self.assertFalse(WindowApi(threading.Event()).quit_for_update())

    def test_staged_update_closes_window_via_timer(self) -> None:
        import webview

        started = threading.Event()
        started.set()
        window = mock.Mock()
        with mock.patch.object(webview, "windows", [window]), mock.patch("run.threading.Timer") as timer:
            self.assertTrue(WindowApi(started).quit_for_update())
            timer.assert_called_once_with(0.5, window.destroy)
            timer.return_value.start.assert_called_once()

    def test_missing_bridge_directory_is_extracted_and_cleaned(self) -> None:
        from webview import util

        with mock.patch.object(util, "get_js_dir", side_effect=FileNotFoundError) as original:
            with webview_assets():
                path = Path(util.get_js_dir())
                self.assertTrue((path / "api.js").exists())
                code, finish = util.load_js_files(bridge_window(), "gtk")
                self.assertIn("pywebview", code)
                self.assertTrue(finish)
            self.assertFalse(path.exists())
            self.assertIs(util.get_js_dir, original)


if __name__ == "__main__":
    unittest.main()
