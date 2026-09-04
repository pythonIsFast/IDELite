# IDELite

[![CI](https://github.com/pythonIsFast/IDELite/actions/workflows/ci.yml/badge.svg)](https://github.com/pythonIsFast/IDELite/actions/workflows/ci.yml)
[![Latest release](https://img.shields.io/github/v/release/pythonIsFast/IDELite)](https://github.com/pythonIsFast/IDELite/releases/latest)
[![License](https://img.shields.io/github/license/pythonIsFast/IDELite)](LICENSE)

A compact VSCode-inspired desktop editor built with Python, Flask, SQLite, pywebview, and vanilla web technologies. It uses the operating system's webview instead of bundling Chromium.

## Download

Every release provides a standalone Linux zip application and a Debian package:

```bash
sudo apt install ./idelite_0.1.0_all.deb
idelite /path/to/project
```

The package installs a desktop launcher and pulls in Python, GTK, and WebKitGTK from the distribution.

## Features

- Native desktop window with a VSCode-style workbench
- Workspace explorer with file and folder creation
- Multi-tab text editor with lightweight syntax highlighting
- Atomic file saves and workspace path containment
- Global text search with line navigation
- Integrated workspace-scoped terminal
- Run support for Python, JavaScript, and shell files
- Git status view
- Quick Open (`Ctrl+P`)
- Persistent editor settings in SQLite
- Per-launch token protection for the local Flask API

## Run from source

```bash
python3 -m venv .venv
. .venv/bin/activate
pip install -r requirements.txt
python run.py /path/to/project
```

Use browser mode while developing:

```bash
python run.py /path/to/project --headless
```

On Debian or Ubuntu, the native window uses the system WebKitGTK engine:

```bash
sudo apt install python3-gi python3-gi-cairo gir1.2-gtk-3.0 gir1.2-webkit2-4.1
```

If `gi` is installed system-wide but unavailable in a virtual environment, use the system Python or create the environment with `--system-site-packages`.

## Shortcuts

| Shortcut | Action |
|---|---|
| `Ctrl+P` | Quick Open |
| `Ctrl+S` | Save active file |
| `Ctrl+W` | Close active tab |
| `Ctrl+B` | Toggle sidebar |
| `Ctrl+\`` | Toggle terminal |
| `Ctrl+Shift+F` | Search workspace |
| `Ctrl+Shift+E` | Show Explorer |
| `F5` | Run active file |

## Build the compact Linux package

```bash
python3 packaging/build_pyz.py
packaging/build-deb.sh
./dist/idelite-0.1.0.pyz /path/to/project
```

The builders vendor the Python packages but not Python or WebKitGTK. The PYZ builder fails when its output exceeds 5 MB. Tagged versions are built and published automatically through GitHub Actions.

## Architecture

```text
Native pywebview window
        ↕
Local Flask server ── per-launch API token
        ├── workspace-safe file API
        ├── search, Git, run, and terminal API
        └── SQLite settings/recent workspaces
        ↕
Vanilla HTML + CSS + JavaScript
```

The server binds only to `127.0.0.1`. Terminal commands are deliberately restricted to the selected workspace as their working directory, but they are not sandboxed and run with the current user's permissions.
