from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

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
