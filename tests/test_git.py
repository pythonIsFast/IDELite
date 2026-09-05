from __future__ import annotations

import subprocess
import tempfile
import unittest
from pathlib import Path

from idelite import create_app
from idelite.git import GitError, GitRepository
from idelite.workspace import Workspace


class GitTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.git("init", "-q", "-b", "main")
        self.git("config", "user.name", "Test User")
        self.git("config", "user.email", "test@example.invalid")
        self.git("config", "commit.gpgsign", "false")
        self.git("config", "core.hooksPath", str(self.root / "no-hooks"))
        self.repository = GitRepository(Workspace(self.root))

    def git(self, *args: str) -> str:
        return subprocess.run(["git", *args], cwd=self.root, check=True, capture_output=True, text=True).stdout

    def seed(self) -> None:
        (self.root / "app.py").write_text("print('before')\n")
        self.git("add", "app.py")
        self.git("commit", "-qm", "Initial commit")

    def test_unborn_repository_and_first_commit(self) -> None:
        self.assertEqual(self.repository.history(), [])
        (self.root / "app.py").write_text("print('hello')\n")
        status = self.repository.status()
        self.assertEqual(status["branch"], "main")
        self.assertEqual(status["files"][0]["status"], "??")
        self.assertIn("+print('hello')", self.repository.diff("app.py"))
        self.repository.stage("app.py")
        self.assertTrue(self.repository.status()["files"][0]["staged"])
        self.repository.commit("First commit")
        self.assertEqual(self.repository.status()["files"], [])
        self.assertEqual(self.repository.history()[0]["subject"], "First commit")

    def test_worktree_diff_staging_and_unstaging_preserve_files(self) -> None:
        self.seed()
        (self.root / "app.py").write_text("print('after')\n")
        self.assertIn("-print('before')", self.repository.diff("app.py"))
        self.repository.stage("app.py")
        self.assertIn("+print('after')", self.repository.diff("app.py", staged=True))
        self.repository.unstage("app.py")
        self.assertFalse(self.repository.status()["files"][0]["staged"])
        self.assertEqual((self.root / "app.py").read_text(), "print('after')\n")

    def test_unstage_before_first_commit(self) -> None:
        (self.root / "new.txt").write_text("keep this")
        self.repository.stage("new.txt")
        self.repository.unstage("new.txt")
        self.assertEqual((self.root / "new.txt").read_text(), "keep this")
        self.assertEqual(self.repository.status()["files"][0]["status"], "??")

    def test_literal_special_filename(self) -> None:
        name = "[special] file\nname.txt"
        (self.root / name).write_text("data")
        self.assertEqual(self.repository.status()["files"][0]["path"], name)
        self.repository.stage(name)
        self.assertTrue(self.repository.status()["files"][0]["staged"])

    def test_rename_records_and_history(self) -> None:
        self.seed()
        self.git("mv", "app.py", "renamed.py")
        status = self.repository.status()["files"][0]
        self.assertEqual(status["path"], "renamed.py")
        self.assertEqual(status["original"], "app.py")
        self.repository.commit("Rename file")
        history = self.repository.history()
        self.assertEqual(history[0]["parents"], [history[1]["id"]])
        self.assertIn("Rename file", self.repository.show_commit(history[0]["id"]))

    def test_commit_requires_staged_changes_and_message(self) -> None:
        self.seed()
        with self.assertRaisesRegex(GitError, "Stage changes"):
            self.repository.commit("Nothing")
        with self.assertRaises(GitError):
            self.repository.commit("")

    def test_paths_and_commit_ids_are_validated(self) -> None:
        for path in ("../outside", str(self.root / "file"), ".git/config"):
            with self.subTest(path=path), self.assertRaises(GitError):
                self.repository.stage(path)
        with self.assertRaises(GitError):
            self.repository.show_commit("--output=outside")

    def test_parent_repository_is_not_modified_from_subfolder(self) -> None:
        subfolder = self.root / "nested"
        subfolder.mkdir()
        with self.assertRaisesRegex(GitError, "repository root"):
            GitRepository(Workspace(subfolder))

    def test_routes_require_token_and_return_structured_data(self) -> None:
        self.seed()
        app = create_app(self.root, database_path=self.root / "state.db", api_token="test")
        client = app.test_client()
        self.assertEqual(client.post("/api/git/stage", json={}).status_code, 403)
        headers = {"X-IDELite-Token": "test"}
        data = client.get("/api/git/status", headers=headers).json
        self.assertEqual(data["branch"], "main")
        self.assertEqual(data["history"][0]["subject"], "Initial commit")
        self.assertEqual(client.get("/api/git/diff?commit=invalid", headers=headers).status_code, 400)
        self.assertEqual(client.post("/api/git/delete", headers=headers, json={}).status_code, 400)


if __name__ == "__main__":
    unittest.main()
