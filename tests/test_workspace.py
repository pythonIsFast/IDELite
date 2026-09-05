from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from idelite.workspace import Workspace, WorkspaceError


class WorkspaceTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary.name)
        (self.root / "src").mkdir()
        (self.root / "src" / "hello.py").write_text("print('hello')\n", encoding="utf-8")
        (self.root / ".git").mkdir()
        (self.root / ".git" / "config").write_text("ignored", encoding="utf-8")
        self.workspace = Workspace(self.root)

    def tearDown(self) -> None:
        self.temporary.cleanup()

    def test_tree_includes_hidden_and_dependency_directories_without_limit(self) -> None:
        for name in (".venv", "node_modules", "__pycache__"):
            (self.root / name).mkdir()
        (self.root / ".idelite-not-a-real-file.tmp").write_text("temporary")
        tree = self.workspace.tree()
        names = {node["name"] for node in tree}
        self.assertTrue({"src", ".git", ".venv", "node_modules", "__pycache__"}.issubset(names))
        self.assertNotIn(".idelite-not-a-real-file.tmp", names)
        self.assertEqual(next(node for node in tree if node["name"] == "src")["children"][0]["path"], "src/hello.py")

    def test_tree_does_not_truncate_after_five_thousand_entries(self) -> None:
        many = self.root / "many"
        many.mkdir()
        for index in range(5001):
            (many / f"folder-{index:04d}").mkdir()
        tree = self.workspace.tree()
        node = next(item for item in tree if item["name"] == "many")
        self.assertEqual(len(node["children"]), 5001)

    def test_crud_operations(self) -> None:
        self.workspace.create("notes.txt", "file")
        self.workspace.write_file("notes.txt", "one\ntwo")
        self.assertEqual(self.workspace.read_file("notes.txt"), "one\ntwo")
        self.workspace.rename("notes.txt", "readme.txt")
        self.assertTrue((self.root / "readme.txt").exists())
        self.workspace.delete("readme.txt")
        self.assertFalse((self.root / "readme.txt").exists())

    def test_paths_cannot_escape_workspace(self) -> None:
        with self.assertRaises(WorkspaceError):
            self.workspace.read_file("../secret.txt")

    def test_search_returns_line_numbers(self) -> None:
        results = self.workspace.search("hello")
        self.assertEqual(results[0]["path"], "src/hello.py")
        self.assertEqual(results[0]["line"], 1)


if __name__ == "__main__":
    unittest.main()
