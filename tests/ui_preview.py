"""Serve a disposable UI integration fixture for the existing browser tool."""

import json
import subprocess
import sys
import tempfile
from pathlib import Path

from flask import Response, request

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from idelite import create_app


def main() -> None:
    with tempfile.TemporaryDirectory(prefix="ui-preview-", dir=ROOT / ".codelite") as temporary:
        workspace = Path(temporary) / "workspace"
        workspace.mkdir()
        def git(*args):
            subprocess.run(["git", *args], cwd=workspace, check=True, capture_output=True)
        git("init", "-b", "main")
        git("config", "user.name", "UI Test")
        git("config", "user.email", "ui@example.invalid")
        git("config", "commit.gpgsign", "false")
        git("config", "core.hooksPath", str(workspace / "no-hooks"))
        code = "# UI test fixture\n\ndef run():\n    print('before')\n\nrun()\n"
        (workspace / "app.py").write_text(code)
        git("add", "app.py")
        git("commit", "-m", "Initial application")
        (workspace / "app.py").write_text(code.replace("before", "after"))
        app = create_app(workspace, database_path=Path(temporary) / "state.db", api_token="ui-test-token")

        @app.get("/_test/ui")
        def ui():
            html = app.view_functions["index"]().get_data(as_text=True)
            script = (ROOT / "tests/ui_browser_check.js").read_text()
            return Response(html.replace("</body>", f"<script>{script}</script></body>"), mimetype="text/html")

        @app.post("/_test/results")
        def results():
            if request.headers.get("X-IDELite-Token") != "ui-test-token":
                return {"error": "Forbidden"}, 403
            result = request.get_json()
            (ROOT / ".codelite/ui-results.json").write_text(json.dumps(result, indent=2))
            return {"ok": True}

        app.run(host="127.0.0.1", port=7501, debug=False)


if __name__ == "__main__":
    main()
