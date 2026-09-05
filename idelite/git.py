"""Local Git operations for the source-control sidebar."""

from __future__ import annotations

import os
import re
import subprocess
from pathlib import Path

from .workspace import Workspace


class GitError(ValueError):
    pass


class GitRepository:
    def __init__(self, workspace: Workspace) -> None:
        self.workspace = workspace
        root = self.run("rev-parse", "--show-toplevel").stdout.strip()
        if Path(root).resolve() != workspace.root:
            raise GitError("Open the repository root to use source control")

    def run(self, *arguments: str, check: bool = True) -> subprocess.CompletedProcess:
        try:
            result = subprocess.run(
                ["git", "--no-pager", "--literal-pathspecs", *arguments],
                cwd=self.workspace.root,
                env={**os.environ, "GIT_TERMINAL_PROMPT": "0", "LC_ALL": "C"},
                capture_output=True, text=True, errors="replace", timeout=15,
            )
        except (OSError, subprocess.TimeoutExpired) as error:
            raise GitError(f"Git is unavailable or timed out: {error}") from error
        if check and result.returncode:
            raise GitError(result.stderr.strip()[:2000] or "Git command failed")
        return result

    def has_head(self) -> bool:
        return self.run("rev-parse", "--verify", "HEAD", check=False).returncode == 0

    def status(self) -> dict:
        output = self.run("status", "--porcelain=v1", "-z", "--untracked-files=normal").stdout
        if len(output) > 1024 * 1024:
            raise GitError("Too many changes to display")
        records = iter(output.split("\0"))
        files = []
        for record in records:
            if len(record) < 4:
                continue
            status, path = record[:2], record[3:]
            original = next(records, "") if "R" in status or "C" in status else ""
            files.append({
                "path": path, "original": original, "status": status,
                "staged": status[0] not in " ?", "changed": status[1] != " ",
            })
        branch = self.run("symbolic-ref", "--short", "HEAD", check=False).stdout.strip()
        if not branch:
            branch = self.run("rev-parse", "--short", "HEAD", check=False).stdout.strip() or "detached"
        return {"available": True, "branch": branch, "name": self.workspace.root.name, "files": files}

    def history(self) -> list[dict]:
        if not self.has_head():
            return []
        output = self.run("log", "--topo-order", "-40", "--format=%H%x00%P%x00%s%x00%an%x00%ar%x00%D").stdout
        commits = []
        for line in output.splitlines():
            fields = line.split("\0")
            if len(fields) != 6:
                continue
            commit, parents, subject, author, age, refs = fields
            commits.append({"id": commit, "parents": parents.split(), "subject": subject,
                            "author": author, "age": age, "refs": refs})
        return commits

    def path(self, value: str) -> str:
        if not isinstance(value, str) or not value:
            raise GitError("Invalid Git file path")
        path = Path(value)
        if path.is_absolute() or any(part in {".git", ".."} for part in path.parts):
            raise GitError("Invalid Git file path")
        self.workspace.resolve(value)
        return path.as_posix()

    def diff(self, path: str, staged: bool = False) -> str:
        path = self.path(path)
        arguments = ["diff", "--no-ext-diff", "--no-textconv", "--no-color"]
        if staged:
            arguments.append("--cached")
        output = self.run(*arguments, "--", path).stdout
        if not output and not staged:
            tracked = self.run("ls-files", "--error-unmatch", "--", path, check=False)
            if tracked.returncode:
                text = self.workspace.read_file(path)
                output = f"--- /dev/null\n+++ b/{path}\n" + "\n".join("+" + line for line in text.splitlines())
        return self.bounded_diff(output)

    def show_commit(self, commit: str) -> str:
        if not re.fullmatch(r"[a-f0-9]{40}|[a-f0-9]{64}", commit):
            raise GitError("Invalid commit ID")
        output = self.run("show", "--no-ext-diff", "--no-textconv", "--no-color", "--format=fuller", commit, "--").stdout
        return self.bounded_diff(output)

    @staticmethod
    def bounded_diff(output: str) -> str:
        if len(output) > 200000:
            return output[:200000] + "\n[Diff truncated at 200,000 characters]"
        return output or "No changes."

    def stage(self, path: str) -> None:
        path = self.path(path)
        paths = [path]
        if path != ".":
            for item in self.status()["files"]:
                if item["path"] == path and item["original"]:
                    paths.append(self.path(item["original"]))
        self.run("add", "-A", "--", *paths)

    def unstage(self, path: str) -> None:
        path = self.path(path)
        if self.has_head():
            self.run("restore", "--staged", "--", path)
        else:
            self.run("rm", "--cached", "-r", "--", path)

    def commit(self, message: str) -> str:
        if not isinstance(message, str) or not message.strip() or len(message) > 2000:
            raise GitError("Enter a commit message of 1–2000 characters")
        if not any(item["staged"] for item in self.status()["files"]):
            raise GitError("Stage changes before committing")
        return self.run("commit", "-m", message.strip()).stdout.strip()
