"""Workspace-scoped filesystem operations."""

from __future__ import annotations

import os
from pathlib import Path
from typing import Any


MAX_FILE_SIZE = 2 * 1024 * 1024


class WorkspaceError(ValueError):
    pass


class Workspace:
    def __init__(self, root: Path) -> None:
        self.root = root.expanduser().resolve()
        if not self.root.is_dir():
            raise WorkspaceError(f"Workspace does not exist: {self.root}")

    def resolve(self, relative_path: str, *, must_exist: bool = False) -> Path:
        if not isinstance(relative_path, str) or "\x00" in relative_path:
            raise WorkspaceError("Invalid path")
        candidate = (self.root / relative_path).resolve()
        try:
            candidate.relative_to(self.root)
        except ValueError as error:
            raise WorkspaceError("Path is outside the workspace") from error
        if must_exist and not candidate.exists():
            raise WorkspaceError("Path does not exist")
        return candidate

    def relative(self, path: Path) -> str:
        return path.relative_to(self.root).as_posix()

    def tree(self) -> list[dict[str, Any]]:
        def visit(directory: Path) -> list[dict[str, Any]]:
            nodes: list[dict[str, Any]] = []
            try:
                entries = sorted(
                    directory.iterdir(),
                    key=lambda entry: (entry.is_file(), entry.name.lower()),
                )
            except OSError:
                return nodes

            for entry in entries:
                if entry.name.startswith(".idelite-"):
                    continue
                try:
                    is_directory = entry.is_dir()
                    node = {
                        "name": entry.name,
                        "path": self.relative(entry),
                        "type": "directory" if is_directory else "file",
                    }
                    if is_directory:
                        node["children"] = visit(entry)
                    nodes.append(node)
                except (OSError, ValueError):
                    continue
            return nodes

        return visit(self.root)

    def read_file(self, relative_path: str) -> str:
        path = self.resolve(relative_path, must_exist=True)
        if not path.is_file():
            raise WorkspaceError("Path is not a file")
        if path.stat().st_size > MAX_FILE_SIZE:
            raise WorkspaceError("File is larger than 2 MB")
        try:
            return path.read_text(encoding="utf-8")
        except UnicodeDecodeError as error:
            raise WorkspaceError("Binary files cannot be edited") from error

    def write_file(self, relative_path: str, content: str) -> None:
        path = self.resolve(relative_path)
        if not path.parent.is_dir():
            raise WorkspaceError("Parent directory does not exist")
        encoded = content.encode("utf-8")
        if len(encoded) > MAX_FILE_SIZE:
            raise WorkspaceError("File is larger than 2 MB")
        temporary = path.with_name(f".idelite-{path.name}.tmp")
        temporary.write_bytes(encoded)
        os.replace(temporary, path)

    def create(self, relative_path: str, kind: str) -> None:
        path = self.resolve(relative_path)
        if path.exists():
            raise WorkspaceError("Path already exists")
        if kind == "directory":
            path.mkdir(parents=False)
        elif kind == "file":
            path.touch()
        else:
            raise WorkspaceError("Type must be file or directory")

    def delete(self, relative_path: str) -> None:
        path = self.resolve(relative_path, must_exist=True)
        if path == self.root:
            raise WorkspaceError("The workspace root cannot be deleted")
        if path.is_dir():
            try:
                path.rmdir()
            except OSError as error:
                raise WorkspaceError("Directory must be empty") from error
        else:
            path.unlink()

    def rename(self, old_path: str, new_path: str) -> None:
        source = self.resolve(old_path, must_exist=True)
        destination = self.resolve(new_path)
        if destination.exists():
            raise WorkspaceError("Destination already exists")
        if not destination.parent.is_dir():
            raise WorkspaceError("Destination directory does not exist")
        source.rename(destination)

    def search(self, query: str, limit: int = 200) -> list[dict[str, Any]]:
        query_lower = query.lower()
        if not query_lower:
            return []
        results: list[dict[str, Any]] = []
        for directory, _names, files in os.walk(self.root):
            for filename in files:
                path = Path(directory) / filename
                try:
                    if path.stat().st_size > MAX_FILE_SIZE:
                        continue
                    for number, line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
                        if query_lower in line.lower():
                            results.append(
                                {
                                    "path": self.relative(path),
                                    "line": number,
                                    "preview": line.strip()[:240],
                                }
                            )
                            if len(results) >= limit:
                                return results
                except (OSError, UnicodeDecodeError, ValueError):
                    continue
        return results
