#!/usr/bin/env python3
"""Start IDELite in a native system webview."""

from __future__ import annotations

import argparse
import threading
import webbrowser
from pathlib import Path

from werkzeug.serving import make_server

from idelite import create_app


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="A tiny VSCode-inspired editor")
    parser.add_argument("workspace", nargs="?", default=".", help="Folder to open")
    parser.add_argument("--headless", action="store_true", help="Run in the browser")
    parser.add_argument("--port", type=int, default=7483, help="Headless server port")
    return parser.parse_args()


def run_native(app: object) -> None:
    server = make_server("127.0.0.1", 0, app, threaded=True)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    url = f"http://127.0.0.1:{server.server_port}"

    try:
        import webview

        webview.create_window(
            "IDELite",
            url,
            width=1280,
            height=800,
            min_size=(820, 520),
            background_color="#181818",
        )
        webview.start(debug=False)
    except ImportError:
        print(f"pywebview is not installed; opening {url} in your browser")
        webbrowser.open(url)
        try:
            thread.join()
        except KeyboardInterrupt:
            pass
    finally:
        server.shutdown()


def main() -> None:
    args = parse_args()
    workspace = Path(args.workspace).expanduser().resolve()
    app = create_app(workspace)
    if args.headless:
        app.run(host="127.0.0.1", port=args.port, debug=False)
    else:
        run_native(app)


if __name__ == "__main__":
    main()
