# IDELite

[![CI](https://github.com/pythonIsFast/IDELite/actions/workflows/ci.yml/badge.svg)](https://github.com/pythonIsFast/IDELite/actions/workflows/ci.yml)
[![Latest release](https://img.shields.io/github/v/release/pythonIsFast/IDELite)](https://github.com/pythonIsFast/IDELite/releases/latest)
[![License](https://img.shields.io/github/license/pythonIsFast/IDELite)](LICENSE)

A compact VSCode-inspired desktop editor built with Python, Flask, SQLite, pywebview, and vanilla web technologies. It uses the operating system's webview instead of bundling Chromium.

## Download

Every release provides a standalone Linux zip application, a Debian package, and
a Windows 10/11 x64 installer. On Windows, run `IDELite-Setup-<version>.exe`;
it installs per user, adds Start-menu shortcuts, and can be uninstalled from
Windows Settings. On Debian or Ubuntu:

```bash
sudo apt install ./idelite_0.5.1_all.deb
idelite /path/to/project
```

The Debian package installs a desktop launcher and pulls in Python, GTK, and
WebKitGTK from the distribution. Windows requires the Microsoft Edge WebView2
Runtime, which is included with supported Windows 10 and 11 installations.

## Features

- Native desktop window with a VSCode-style workbench
- Workspace explorer with file and folder creation
- Multi-tab text editor with syntax highlighting and compiler-based Problems checks
- Atomic file saves and workspace path containment
- Global text search with line navigation
- Integrated workspace-scoped terminal
- Run support for Python, JavaScript, and shell files
- Git status, staging, commit, diffs, and compact commit graph
- Editor minimap, file outline, find, and editor navigation
- Quick Open (`Ctrl+P`)
- Persistent editor settings and workspace sessions in SQLite
- Per-launch token protection for the local Flask API

## Automatic updates

Installed Debian and Windows builds check the latest stable GitHub release on
startup and when Settings opens. A green arrow on Settings indicates an available
update. Choose **Settings → Install update** to download and verify the platform
installer against `SHA256SUMS.txt`. No package is downloaded or installed merely
by checking for updates.

Save or close all unsaved tabs first. Editing is locked during update preparation.
The installer waits for IDELite to exit and reopens the current workspace.
Debian uses `pkexec apt-get install`; Windows runs the per-user installer without
administrator approval. The installer never forcibly kills the editor; it aborts
if the process has not exited within two minutes. In headless mode, stop the
server manually after the UI reports that the package is verified, then reopen
the browser after restart.

Automatic installation is offered only for the Debian package or the Windows
installer, not source checkouts or portable PYZ files. A working Polkit
authentication agent is required for the Debian administrator dialog. Checksums
protect download integrity, but are not independent cryptographic signatures;
the updater trusts this repository's GitHub releases over HTTPS.

**Upgrading from v0.1.0:** install the v0.2.0 DEB once manually; v0.1.0 does not
contain the updater. Subsequent Debian updates can be started inside the app.

## Restoring your workspace

IDELite reopens the most recent existing workspace when started without a path,
and restores its open files, active tab, and expanded folders. Session data is
stored in `~/.local/share/idelite/idelite.db` (or
`$XDG_DATA_HOME/idelite/idelite.db`). It contains only relative paths and folder
state—never file contents or unsaved edits. Files and folders that no longer
exist are skipped during restoration.

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
| `F8` | Check active file for syntax errors |

## Build the compact Linux package

```bash
python3 packaging/build_pyz.py
packaging/build-deb.sh
./dist/idelite-0.3.2.pyz /path/to/project
```

The builders vendor the Python packages but not Python or WebKitGTK. The PYZ builder fails when its output exceeds 5 MB. Tagged versions are built and published automatically through GitHub Actions.

## Build the Windows installer

On Windows 10/11 x64, install Python 3.12, Inno Setup 6, and the build
dependencies, then run:

```powershell
python -m pip install -r requirements.txt pyinstaller pythonnet
./packaging/windows/build.ps1
```

This creates `dist/IDELite-Setup-<version>.exe`. The GitHub Actions Windows job
builds and tests the same installer for pull requests and releases.

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
