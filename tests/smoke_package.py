"""Smoke-test bundled resources without relying on installed Python packages."""

import sys
import tempfile
from pathlib import Path
from types import SimpleNamespace


def main() -> None:
    archive = Path(sys.argv[1]).resolve()
    sys.path.insert(0, str(archive))
    from idelite import create_app
    from run import webview_assets
    from webview import util

    with tempfile.TemporaryDirectory() as temporary:
        root = Path(temporary)
        app = create_app(root, database_path=root / "state.db", api_token="smoke")
        client = app.test_client()
        assert client.get("/").status_code == 200
        assert client.get("/static/app.js").status_code == 200
        assert client.get("/api/update", headers={"X-IDELite-Token": "smoke"}).json == {"supported": False}

    with webview_assets():
        location = Path(util.get_js_dir())
        window = SimpleNamespace(
            uid="smoke", js_api_endpoint="smoke", text_select=True, zoomable=False,
            draggable=False, easy_drag=False, frameless=False, state={},
        )
        code, finish = util.load_js_files(window, "gtk")
        assert "pywebview" in code and finish
    assert not location.exists()
    print("Packaged UI, update API, and native bridge resources passed")


if __name__ == "__main__":
    main()
