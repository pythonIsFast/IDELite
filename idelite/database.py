"""Small SQLite store for editor settings and recent workspaces."""

from __future__ import annotations

import json
import sqlite3
from pathlib import Path
from typing import Any


class Database:
    def __init__(self, path: Path) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        self.path = path
        self._initialize()

    def connect(self) -> sqlite3.Connection:
        connection = sqlite3.connect(self.path)
        connection.row_factory = sqlite3.Row
        return connection

    def _initialize(self) -> None:
        with self.connect() as connection:
            connection.executescript(
                """
                CREATE TABLE IF NOT EXISTS settings (
                    key TEXT PRIMARY KEY,
                    value TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS recent_workspaces (
                    path TEXT PRIMARY KEY,
                    opened_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
                );
                CREATE TABLE IF NOT EXISTS workspace_sessions (
                    path TEXT PRIMARY KEY,
                    state TEXT NOT NULL,
                    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
                );
                """
            )

    def get_settings(self) -> dict[str, Any]:
        with self.connect() as connection:
            rows = connection.execute("SELECT key, value FROM settings").fetchall()
        result: dict[str, Any] = {}
        for row in rows:
            try:
                result[row["key"]] = json.loads(row["value"])
            except json.JSONDecodeError:
                result[row["key"]] = row["value"]
        return result

    def set_settings(self, values: dict[str, Any]) -> None:
        with self.connect() as connection:
            connection.executemany(
                "INSERT OR REPLACE INTO settings(key, value) VALUES (?, ?)",
                [(key, json.dumps(value)) for key, value in values.items()],
            )

    def touch_workspace(self, path: Path) -> None:
        with self.connect() as connection:
            connection.execute(
                """
                INSERT INTO recent_workspaces(path, opened_at) VALUES (?, CURRENT_TIMESTAMP)
                ON CONFLICT(path) DO UPDATE SET opened_at = CURRENT_TIMESTAMP
                """,
                (str(path),),
            )

    def recent_workspaces(self, limit: int = 8) -> list[str]:
        with self.connect() as connection:
            rows = connection.execute(
                "SELECT path FROM recent_workspaces ORDER BY opened_at DESC LIMIT ?",
                (limit,),
            ).fetchall()
        return [row["path"] for row in rows]

    def latest_existing_workspace(self) -> Path | None:
        with self.connect() as connection:
            rows = connection.execute(
                "SELECT path FROM recent_workspaces ORDER BY opened_at DESC"
            ).fetchall()
        for row in rows:
            path = Path(row["path"]).expanduser()
            if path.is_dir():
                return path.resolve()
        return None

    def workspace_session(self, path: Path) -> dict[str, Any]:
        with self.connect() as connection:
            row = connection.execute(
                "SELECT state FROM workspace_sessions WHERE path = ?", (str(path),)
            ).fetchone()
        if row is None:
            return {"openFiles": [], "activeFile": None, "expandedFolders": []}
        try:
            state = json.loads(row["state"])
        except json.JSONDecodeError:
            return {"openFiles": [], "activeFile": None, "expandedFolders": []}
        return state if isinstance(state, dict) else {"openFiles": [], "activeFile": None, "expandedFolders": []}

    def set_workspace_session(self, path: Path, state: dict[str, Any]) -> None:
        with self.connect() as connection:
            connection.execute(
                """
                INSERT INTO workspace_sessions(path, state, updated_at)
                VALUES (?, ?, CURRENT_TIMESTAMP)
                ON CONFLICT(path) DO UPDATE SET state = excluded.state, updated_at = CURRENT_TIMESTAMP
                """,
                (str(path), json.dumps(state, separators=(",", ":"))),
            )
