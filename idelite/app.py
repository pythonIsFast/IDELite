"""Local Flask backend for IDELite."""

from __future__ import annotations

import importlib.resources
import json
import mimetypes
import os
import secrets
import shlex
import subprocess
import sys
import threading
from pathlib import Path
from typing import Any

from flask import Flask, Response, jsonify, request

from .database import Database
from .workspace import Workspace, WorkspaceError

DEFAULT_SETTINGS = {
    "fontSize": 14,
    "tabSize": 4,
    "wordWrap": False,
    "theme": "dark",
}


class AppState:
    def __init__(self, workspace: Path, database: Database) -> None:
        self.workspace = Workspace(workspace)
        self.terminal_cwd = self.workspace.root
        self.database = database
        self.lock = threading.RLock()
        self.database.touch_workspace(self.workspace.root)

    def change_workspace(self, path: Path) -> None:
        workspace = Workspace(path)
        with self.lock:
            self.workspace = workspace
            self.terminal_cwd = workspace.root
            self.database.touch_workspace(workspace.root)


def _data_directory() -> Path:
    if sys.platform == "win32":
        base = Path(os.environ.get("LOCALAPPDATA", Path.home() / "AppData" / "Local"))
    else:
        base = Path(os.environ.get("XDG_DATA_HOME", Path.home() / ".local" / "share"))
    return base / "idelite"


def create_app(
    workspace: str | Path | None = None,
    *,
    database_path: str | Path | None = None,
    api_token: str | None = None,
) -> Flask:
    app = Flask(__name__, static_folder=None)
    app.config["JSON_SORT_KEYS"] = False
    app.config["MAX_CONTENT_LENGTH"] = 3 * 1024 * 1024

    root = Path(workspace or Path.cwd())
    database = Database(Path(database_path) if database_path else _data_directory() / "idelite.db")
    state = AppState(root, database)
    token = api_token or secrets.token_urlsafe(24)
    app.extensions["idelite_state"] = state
    app.extensions["idelite_token"] = token

    @app.before_request
    def protect_api() -> Response | None:
        if request.path.startswith("/api/") and request.headers.get("X-IDELite-Token") != token:
            return jsonify({"error": "Invalid local API token"}), 403
        return None

    @app.errorhandler(WorkspaceError)
    def handle_workspace_error(error: WorkspaceError) -> tuple[Response, int]:
        return jsonify({"error": str(error)}), 400

    @app.errorhandler(404)
    def handle_not_found(_error: Exception) -> tuple[Response, int]:
        if request.path.startswith("/api/"):
            return jsonify({"error": "Not found"}), 404
        return jsonify({"error": "Not found"}), 404

    @app.get("/")
    def index() -> Response:
        html = _asset("index.html").read_text(encoding="utf-8")
        bootstrap = json.dumps(
            {
                "token": token,
                "workspace": str(state.workspace.root),
                "name": state.workspace.root.name,
            }
        ).replace("</", "<\\/")
        return Response(html.replace("__IDELITE_BOOTSTRAP__", bootstrap), mimetype="text/html")

    @app.get("/static/<name>")
    def static_asset(name: str) -> Response:
        if name not in {"app.js", "styles.css"}:
            return jsonify({"error": "Not found"}), 404
        mimetype = mimetypes.guess_type(name)[0] or "application/octet-stream"
        return Response(_asset(name).read_bytes(), mimetype=mimetype)

    @app.get("/api/state")
    def get_state() -> Response:
        settings = DEFAULT_SETTINGS | database.get_settings()
        return jsonify(
            {
                "workspace": str(state.workspace.root),
                "name": state.workspace.root.name,
                "settings": settings,
                "recentWorkspaces": database.recent_workspaces(),
            }
        )

    @app.put("/api/settings")
    def save_settings() -> Response:
        payload = _json_object()
        allowed = {key: payload[key] for key in DEFAULT_SETTINGS if key in payload}
        database.set_settings(allowed)
        return jsonify({"settings": DEFAULT_SETTINGS | database.get_settings()})

    @app.post("/api/workspace")
    def change_workspace() -> Response:
        payload = _json_object()
        path = payload.get("path")
        if not isinstance(path, str) or not path.strip():
            raise WorkspaceError("A workspace path is required")
        state.change_workspace(Path(path))
        return jsonify({"workspace": str(state.workspace.root), "name": state.workspace.root.name})

    @app.get("/api/tree")
    def get_tree() -> Response:
        return jsonify({"items": state.workspace.tree()})

    @app.get("/api/file")
    def get_file() -> Response:
        path = request.args.get("path", "")
        return jsonify({"path": path, "content": state.workspace.read_file(path)})

    @app.put("/api/file")
    def put_file() -> Response:
        payload = _json_object()
        path = _required_string(payload, "path")
        content = payload.get("content")
        if not isinstance(content, str):
            raise WorkspaceError("Content must be text")
        state.workspace.write_file(path, content)
        return jsonify({"saved": True, "path": path})

    @app.post("/api/file")
    def create_file() -> Response:
        payload = _json_object()
        path = _required_string(payload, "path")
        state.workspace.create(path, payload.get("type", "file"))
        return jsonify({"created": True, "path": path}), 201

    @app.delete("/api/file")
    def delete_file() -> Response:
        path = request.args.get("path", "")
        state.workspace.delete(path)
        return jsonify({"deleted": True})

    @app.post("/api/rename")
    def rename_file() -> Response:
        payload = _json_object()
        state.workspace.rename(
            _required_string(payload, "oldPath"),
            _required_string(payload, "newPath"),
        )
        return jsonify({"renamed": True})

    @app.get("/api/search")
    def search() -> Response:
        return jsonify({"results": state.workspace.search(request.args.get("q", ""))})

    @app.get("/api/git/status")
    def git_status() -> Response:
        try:
            result = subprocess.run(
                ["git", "status", "--short", "--branch"],
                cwd=state.workspace.root,
                capture_output=True,
                text=True,
                timeout=5,
                check=False,
            )
            output = (result.stdout + result.stderr).strip()
            return jsonify({"available": result.returncode == 0, "output": output})
        except (OSError, subprocess.TimeoutExpired):
            return jsonify({"available": False, "output": "Git is not available"})

    @app.post("/api/run")
    def run_file() -> Response:
        payload = _json_object()
        relative_path = _required_string(payload, "path")
        path = state.workspace.resolve(relative_path, must_exist=True)
        commands: dict[str, list[str]] = {
            ".py": [sys.executable, str(path)],
            ".js": ["node", str(path)],
            ".sh": ["bash", str(path)],
        }
        command = commands.get(path.suffix.lower())
        if not command:
            raise WorkspaceError("This file type cannot be run directly")
        return jsonify(_execute(command, state.workspace.root, shell=False))

    @app.post("/api/terminal")
    def terminal() -> Response:
        payload = _json_object()
        command = _required_string(payload, "command").strip()
        if len(command) > 4096:
            raise WorkspaceError("Command is too long")

        if command == "cd" or command.startswith("cd "):
            target_text = command[2:].strip()
            if not target_text:
                target = state.workspace.root
            else:
                try:
                    parts = shlex.split(target_text)
                except ValueError as error:
                    raise WorkspaceError("Invalid cd command") from error
                if len(parts) != 1:
                    raise WorkspaceError("cd accepts one path")
                target = (state.terminal_cwd / parts[0]).resolve()
                try:
                    target.relative_to(state.workspace.root)
                except ValueError as error:
                    raise WorkspaceError("Terminal cannot leave the workspace") from error
            if not target.is_dir():
                raise WorkspaceError("Directory does not exist")
            state.terminal_cwd = target
            return jsonify({"output": "", "code": 0, "cwd": _relative_cwd(state)})

        result = _execute(command, state.terminal_cwd, shell=True)
        result["cwd"] = _relative_cwd(state)
        return jsonify(result)

    return app


def _asset(name: str) -> Any:
    return importlib.resources.files("idelite").joinpath("static", name)


def _json_object() -> dict[str, Any]:
    payload = request.get_json(silent=True)
    if not isinstance(payload, dict):
        raise WorkspaceError("A JSON object is required")
    return payload


def _required_string(payload: dict[str, Any], key: str) -> str:
    value = payload.get(key)
    if not isinstance(value, str) or not value:
        raise WorkspaceError(f"{key} is required")
    return value


def _relative_cwd(state: AppState) -> str:
    relative = state.terminal_cwd.relative_to(state.workspace.root).as_posix()
    return "." if relative == "." else relative


def _execute(command: str | list[str], cwd: Path, *, shell: bool) -> dict[str, Any]:
    try:
        result = subprocess.run(
            command,
            cwd=cwd,
            shell=shell,
            capture_output=True,
            text=True,
            timeout=30,
            check=False,
            errors="replace",
        )
        output = (result.stdout + result.stderr)[-200_000:]
        return {"output": output, "code": result.returncode}
    except subprocess.TimeoutExpired as error:
        output = ((error.stdout or "") + (error.stderr or ""))[-200_000:]
        return {"output": output + "\nProcess timed out after 30 seconds.", "code": 124}
    except OSError as error:
        return {"output": str(error), "code": 127}
