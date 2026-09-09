from __future__ import annotations

import tempfile
import unittest
from pathlib import Path
from unittest import mock

from idelite.database import Database
from idelite.updater import UpdateError
from run import default_workspace

from idelite import create_app


class AppTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary.name)
        (self.root / "main.py").write_text("print('ready')\n", encoding="utf-8")
        self.token = "test-token"
        self.app = create_app(
            self.root,
            database_path=self.root / "state.db",
            api_token=self.token,
        )
        self.app.config["TESTING"] = True
        self.client = self.app.test_client()
        self.headers = {"X-IDELite-Token": self.token}

    def tearDown(self) -> None:
        self.temporary.cleanup()

    def test_index_contains_bootstrap_and_assets(self) -> None:
        response = self.client.get("/")
        self.assertEqual(response.status_code, 200)
        self.assertIn(b"window.IDELITE_BOOTSTRAP", response.data)
        self.assertIn(b"test-token", response.data)

    def test_editor_assets_are_served_from_source_and_zipapp(self) -> None:
        self.assertIn(b"IDELiteEditor", self.client.get("/static/editor.js").data)
        self.assertIn(b"IDELiteSourceControl", self.client.get("/static/source-control.js").data)
        self.assertEqual(self.client.get("/static/icon.svg").status_code, 404)

    def test_api_requires_local_token(self) -> None:
        self.assertEqual(self.client.get("/api/tree").status_code, 403)
        self.assertEqual(self.client.get("/api/tree", headers=self.headers).status_code, 200)

    def test_read_write_create_and_search(self) -> None:
        response = self.client.get("/api/file?path=main.py", headers=self.headers)
        self.assertEqual(response.get_json()["content"], "print('ready')\n")

        response = self.client.put(
            "/api/file",
            headers=self.headers,
            json={"path": "main.py", "content": "print('changed')\n"},
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual((self.root / "main.py").read_text(encoding="utf-8"), "print('changed')\n")

        response = self.client.post(
            "/api/file",
            headers=self.headers,
            json={"path": "notes.txt", "type": "file"},
        )
        self.assertEqual(response.status_code, 201)
        response = self.client.get("/api/search?q=changed", headers=self.headers)
        self.assertEqual(response.get_json()["results"][0]["path"], "main.py")

    def test_syntax_check_interval_is_persisted(self) -> None:
        response = self.client.put("/api/settings", headers=self.headers, json={"syntaxCheckInterval": 15})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.get_json()["settings"]["syntaxCheckInterval"], 15)
        response = self.client.put("/api/settings", headers=self.headers, json={"syntaxCheckInterval": 10})
        self.assertEqual(response.status_code, 400)

    def test_diagnostics_reports_python_syntax_errors(self) -> None:
        (self.root / "broken.py").write_text("def broken(\n", encoding="utf-8")
        response = self.client.post("/api/diagnostics", headers=self.headers, json={"path": "broken.py"})
        self.assertEqual(response.status_code, 200)
        diagnostic = response.get_json()["diagnostics"][0]
        self.assertGreaterEqual(diagnostic["line"], 1)
        self.assertIn("SyntaxError", diagnostic["message"])

    def test_source_run_does_not_offer_self_update(self) -> None:
        response = self.client.get("/api/update", headers=self.headers)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.get_json(), {"supported": False})

    def test_update_requires_token_and_only_starts_once(self) -> None:
        with mock.patch("idelite.app.install_update", return_value={"status": "started", "version": "0.2.0"}) as install:
            self.assertEqual(self.client.post("/api/update").status_code, 403)
            install.assert_not_called()
            self.assertEqual(self.client.post("/api/update", headers=self.headers).status_code, 202)
            install.assert_called_once_with(["/usr/bin/idelite", str(self.root)])
            self.assertEqual(self.client.post("/api/update", headers=self.headers).status_code, 409)
            self.assertEqual(install.call_count, 1)

    def test_failed_update_can_be_retried(self) -> None:
        with mock.patch("idelite.app.install_update", side_effect=UpdateError("offline")):
            response = self.client.post("/api/update", headers=self.headers)
            self.assertEqual(response.status_code, 409)
            self.assertFalse(self.app.extensions["update_started"].is_set())
        with mock.patch("idelite.app.install_update", return_value={"status": "started"}):
            self.assertEqual(self.client.post("/api/update", headers=self.headers).status_code, 202)

    def test_update_restart_uses_current_workspace_and_headless_flags(self) -> None:
        folder = self.root / "other"
        folder.mkdir()
        self.client.post("/api/workspace", headers=self.headers, json={"path": str(folder)})
        self.app.config["UPDATE_RESTART_FLAGS"] = ["--headless", "--port", "9000"]
        with mock.patch("idelite.app.install_update", return_value={"status": "started"}) as install:
            self.client.post("/api/update", headers=self.headers)
        install.assert_called_once_with(["/usr/bin/idelite", str(folder), "--headless", "--port", "9000"])

    def test_workspace_session_filters_missing_paths_and_is_returned_in_state(self) -> None:
        (self.root / "src").mkdir()
        (self.root / "src" / "other.py").write_text("pass\n", encoding="utf-8")
        response = self.client.put(
            "/api/session",
            headers=self.headers,
            json={
                "openFiles": ["main.py", "src/other.py", "missing.py", "main.py"],
                "activeFile": "missing.py",
                "expandedFolders": ["src", "missing", "src"],
            },
        )
        self.assertEqual(response.status_code, 200)
        session = response.get_json()["session"]
        self.assertEqual(session["openFiles"], ["main.py", "src/other.py"])
        self.assertEqual(session["activeFile"], "src/other.py")
        self.assertEqual(session["expandedFolders"], ["src"])
        state = self.client.get("/api/state", headers=self.headers).get_json()
        self.assertEqual(state["session"], session)

    def test_sessions_are_isolated_by_workspace(self) -> None:
        self.client.put("/api/session", headers=self.headers, json={"openFiles": ["main.py"], "activeFile": "main.py", "expandedFolders": []})
        other = self.root / "other"
        other.mkdir()
        (other / "second.py").write_text("pass\n", encoding="utf-8")
        response = self.client.post("/api/workspace", headers=self.headers, json={"path": str(other)})
        self.assertEqual(response.get_json()["session"]["openFiles"], [])
        self.client.put("/api/session", headers=self.headers, json={"openFiles": ["second.py"], "activeFile": "second.py", "expandedFolders": []})
        self.client.post("/api/workspace", headers=self.headers, json={"path": str(self.root)})
        state = self.client.get("/api/state", headers=self.headers).get_json()
        self.assertEqual(state["session"]["activeFile"], "main.py")

    def test_default_workspace_uses_latest_existing_workspace(self) -> None:
        data = self.root / "data"
        database = Database(data / "idelite.db")
        old = self.root / "old"
        latest = self.root / "latest"
        old.mkdir()
        latest.mkdir()
        database.touch_workspace(old)
        database.touch_workspace(latest)
        old.rmdir()
        with mock.patch("run.data_directory", return_value=data):
            self.assertEqual(default_workspace(), latest.resolve())

    def test_settings_are_persisted(self) -> None:
        self.client.put(
            "/api/settings",
            headers=self.headers,
            json={"fontSize": 16, "tabSize": 2, "unknown": True},
        )
        state = self.client.get("/api/state", headers=self.headers).get_json()
        self.assertEqual(state["settings"]["fontSize"], 16)
        self.assertNotIn("unknown", state["settings"])

    def test_terminal_cannot_leave_workspace(self) -> None:
        response = self.client.post(
            "/api/terminal",
            headers=self.headers,
            json={"command": "cd .."},
        )
        self.assertEqual(response.status_code, 400)
        self.assertIn("cannot leave", response.get_json()["error"])


if __name__ == "__main__":
    unittest.main()
