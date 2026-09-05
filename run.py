#!/usr/bin/env python3
"""Start IDELite in a native system webview."""

from __future__ import annotations

import argparse
import importlib.resources
import sys
import tempfile
import threading
import webbrowser
from contextlib import contextmanager
from pathlib import Path

from werkzeug.serving import make_server

from idelite import create_app


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="A tiny VSCode-inspired editor")
    parser.add_argument("workspace", nargs="?", default=".", help="Folder to open")
    parser.add_argument("--headless", action="store_true", help="Run in the browser")
    parser.add_argument("--port", type=int, default=7483, help="Headless server port")
    return parser.parse_args()


class WindowApi:
    def __init__(self, update_started: threading.Event) -> None:
        self.update_started = update_started
        self._maximized = False

    def minimize(self) -> None:
        import webview

        webview.windows[0].minimize()

    def toggle_maximize(self) -> None:
        import webview

        window = webview.windows[0]
        if self._maximized:
            window.restore()
        else:
            window.maximize()
        self._maximized = not self._maximized

    def close(self) -> None:
        import webview

        webview.windows[0].destroy()

    def quit_for_update(self) -> bool:
        """Close the native window only after a verified update has been staged."""
        if not self.update_started.is_set():
            return False
        import webview

        threading.Timer(0.5, webview.windows[0].destroy).start()
        return True


@contextmanager
def webview_assets():
    """Expose pywebview's bridge scripts as real files when running from a PYZ."""
    from webview import util

    original = util.get_js_dir
    try:
        original()
    except FileNotFoundError:
        with tempfile.TemporaryDirectory(prefix="idelite-webview-") as temporary:
            def copy_resources(source, target: Path) -> None:
                target.mkdir(exist_ok=True)
                for item in source.iterdir():
                    destination = target / item.name
                    if item.is_dir():
                        copy_resources(item, destination)
                    else:
                        destination.write_bytes(item.read_bytes())

            copy_resources(importlib.resources.files("webview").joinpath("js"), Path(temporary))
            util.get_js_dir = lambda: temporary
            try:
                yield
            finally:
                util.get_js_dir = original
    else:
        yield


def configure_linux_identity() -> None:
    """Match GTK's X11 WM_CLASS and Wayland app ID to idelite.desktop."""
    if not sys.platform.startswith("linux"):
        return
    try:
        import gi

        gi.require_version("Gdk", "3.0")
        from gi.repository import GLib, Gdk
    except (ImportError, ValueError):
        return
    GLib.set_prgname("idelite")
    GLib.set_application_name("IDELite")
    Gdk.set_program_class("idelite")


def run_native(app: object) -> None:
    server = make_server("127.0.0.1", 0, app, threaded=True)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    url = f"http://127.0.0.1:{server.server_port}"

    try:
        configure_linux_identity()
        import webview

        webview.create_window(
            "IDELite",
            url,
            width=1280,
            height=800,
            min_size=(820, 520),
            background_color="#181818",
            frameless=True,
            easy_drag=False,
            js_api=WindowApi(app.extensions["update_started"]),
        )
        icon = importlib.resources.files("idelite").joinpath("static", "icon.svg")
        with webview_assets(), importlib.resources.as_file(icon) as icon_path:
            webview.start(debug=False, icon=str(icon_path))
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
        app.config["UPDATE_RESTART_FLAGS"] = ["--headless", "--port", str(args.port)]
        app.run(host="127.0.0.1", port=args.port, debug=False)
    else:
        run_native(app)


if __name__ == "__main__":
    main()
