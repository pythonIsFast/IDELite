# Copyright 2026 Code Lite contributors
# Licensed under the Apache License, Version 2.0 (see LICENSE).
# Adapted for IDELite: bounded downloads, validation, and graceful shutdown.

"""Small self-updater for installed Debian and Windows packages."""

from __future__ import annotations

import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import urllib.request
from pathlib import Path
from typing import Any

RELEASE_API = "https://api.github.com/repos/pythonIsFast/IDELite/releases/latest"
USER_AGENT = "IDELite-Updater"
INSTALLED_APP = Path("/opt/idelite/idelite.pyz")
WINDOWS_APP = Path(os.environ.get("LOCALAPPDATA", "")) / "Programs" / "IDELite" / "IDELite.exe"
PACKAGE_NAME = "idelite"
_VERSION_RE = re.compile(r"^\d+(?:\.\d+){1,3}$")


class UpdateError(RuntimeError):
    pass


def _installed_version() -> tuple[str | None, str | None]:
    if sys.platform.startswith("linux"):
        if Path(sys.argv[0]).resolve() != INSTALLED_APP:
            return None, None
        try:
            result = subprocess.run(
                ["dpkg-query", "-W", "-f=${Version}", PACKAGE_NAME],
                capture_output=True,
                text=True,
                timeout=5,
                check=True,
            )
        except (OSError, subprocess.SubprocessError):
            return None, None
        return "linux-deb", result.stdout.strip()
    if sys.platform == "win32" and getattr(sys, "frozen", False):
        executable = Path(sys.executable).resolve()
        if executable != WINDOWS_APP.resolve():
            return None, None
        try:
            return "windows-exe", (executable.parent / "version.txt").read_text(encoding="utf-8").strip()
        except OSError:
            return None, None
    return None, None


def _version_tuple(value: str) -> tuple[int, ...]:
    clean = value.removeprefix("v")
    if not _VERSION_RE.fullmatch(clean):
        raise UpdateError(f"Invalid release version: {value}")
    parts = tuple(int(part) for part in clean.split("."))
    return parts + (0,) * (4 - len(parts))


def _release() -> dict[str, Any]:
    release_request = urllib.request.Request(
        RELEASE_API,
        headers={"Accept": "application/vnd.github+json", "User-Agent": USER_AGENT},
    )
    try:
        with urllib.request.urlopen(release_request, timeout=15) as response:
            raw = response.read(1024 * 1024 + 1)
            if len(raw) > 1024 * 1024:
                raise UpdateError("GitHub release response is too large")
            payload = json.loads(raw)
    except (OSError, ValueError) as error:
        raise UpdateError(f"Could not check for updates: {error}") from error
    if not isinstance(payload, dict) or not isinstance(payload.get("assets"), list):
        raise UpdateError("GitHub returned an invalid release response")
    if payload.get("draft") or payload.get("prerelease"):
        raise UpdateError("Only stable published releases can be installed")
    _version_tuple(str(payload.get("tag_name", "")))
    return payload


def _installer_name(platform: str, version: str) -> str:
    if platform == "linux-deb":
        return f"idelite_{version}_all.deb"
    if platform == "windows-exe":
        return f"IDELite-Setup-{version}.exe"
    raise UpdateError(f"Unsupported update platform: {platform}")


def check_update() -> dict[str, Any]:
    platform, current = _installed_version()
    if not platform or not current:
        return {"supported": False}

    release = _release()
    latest = str(release.get("tag_name") or "").lstrip("v")
    expected = _installer_name(platform, latest)
    assets = release.get("assets") or []
    names = {str(asset.get("name")) for asset in assets if isinstance(asset, dict)}
    return {
        "supported": True,
        "platform": platform,
        "current_version": current,
        "latest_version": latest,
        "available": _version_tuple(latest) > _version_tuple(current),
        "asset_available": expected in names and "SHA256SUMS.txt" in names,
    }


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        while chunk := handle.read(1024 * 1024):
            digest.update(chunk)
    return digest.hexdigest()


def _download(url: str, target: Path, limit: int) -> None:
    download_request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    try:
        with urllib.request.urlopen(download_request, timeout=30) as response, target.open("wb") as output:
            size = 0
            while chunk := response.read(64 * 1024):
                size += len(chunk)
                if size > limit:
                    raise UpdateError("Update download exceeds its size limit")
                output.write(chunk)
    except OSError as error:
        raise UpdateError(f"Could not download the update: {error}") from error


def _install_after_exit(
    installer: Path, directory: Path, parent_pid: int, restart: list[str]
) -> None:
    command = ["/usr/bin/pkexec", "/usr/bin/apt-get", "install", "-y", str(installer)]
    runner = """
import json
import os
import shutil
import subprocess
import sys
import time
from pathlib import Path

parent_pid = int(sys.argv[1])
command = json.loads(sys.argv[2])
restart = json.loads(sys.argv[3])
directory = sys.argv[4]
log_path = Path(os.environ.get("XDG_DATA_HOME", Path.home() / ".local/share")) / "idelite/update.log"
log_path.parent.mkdir(parents=True, exist_ok=True)
try:
    with log_path.open("w") as log:
        deadline = time.monotonic() + 120
        while time.monotonic() < deadline:
            try:
                os.kill(parent_pid, 0)
            except ProcessLookupError:
                break
            time.sleep(0.2)
        else:
            log.write("Update cancelled: IDELite did not exit within two minutes.\\n")
            sys.exit(1)
        try:
            result = subprocess.run(command, stdout=log, stderr=log)
            log.write(f"Installer exited with code {result.returncode}.\\n")
        except OSError as error:
            log.write(f"Installation failed: {error}\\n")
        # Restart the existing version too if installation was cancelled or failed.
        subprocess.Popen(restart, cwd=str(Path.home()), stdout=log, stderr=log)
finally:
    shutil.rmtree(directory, ignore_errors=True)
"""
    try:
        subprocess.Popen(
            [
                sys.executable,
                "-c",
                runner,
                str(parent_pid),
                json.dumps(command),
                json.dumps(restart),
                str(directory),
            ],
            start_new_session=True,
        )
    except OSError as error:
        raise UpdateError(f"Could not start the installer: {error}") from error


def _install_windows_after_exit(
    installer: Path, directory: Path, parent_pid: int, restart: list[str]
) -> None:
    script = directory / "install-update.ps1"
    script.write_text(
        """param([int]$ParentPid, [string]$Installer, [string]$RestartJson, [string]$Directory)
$log = Join-Path $env:LOCALAPPDATA 'IDELite\\update.log'
New-Item -ItemType Directory -Force -Path (Split-Path $log) | Out-Null
while (Get-Process -Id $ParentPid -ErrorAction SilentlyContinue) { Start-Sleep -Milliseconds 200 }
try {
  Start-Process -FilePath $Installer -ArgumentList '/VERYSILENT','/SUPPRESSMSGBOXES','/NORESTART' -Wait
  $restart = ConvertFrom-Json $RestartJson
  Start-Process -FilePath $restart[0] -ArgumentList @($restart[1..($restart.Count - 1)])
} catch { $_ | Out-File -Append $log }
Remove-Item -Recurse -Force $Directory -ErrorAction SilentlyContinue
""",
        encoding="utf-8",
    )
    try:
        subprocess.Popen(
            ["powershell.exe", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", str(script),
             str(parent_pid), str(installer), json.dumps(restart), str(directory)],
            creationflags=getattr(subprocess, "CREATE_NEW_PROCESS_GROUP", 0)
            | getattr(subprocess, "DETACHED_PROCESS", 0),
        )
    except OSError as error:
        raise UpdateError(f"Could not start the installer: {error}") from error


def install_update(restart: list[str]) -> dict[str, str]:
    platform, current = _installed_version()
    if platform not in {"linux-deb", "windows-exe"} or not current:
        raise UpdateError("Updates are only available for installed IDELite packages")

    if platform == "linux-deb" and not all(os.access(tool, os.X_OK) for tool in ("/usr/bin/pkexec", "/usr/bin/apt-get")):
        raise UpdateError("Install pkexec and apt before using automatic updates")

    release = _release()
    latest = str(release.get("tag_name") or "").removeprefix("v")
    if _version_tuple(latest) <= _version_tuple(current):
        raise UpdateError("IDELite is already up to date")

    expected = _installer_name(platform, latest)
    assets = {
        str(asset.get("name")): str(asset.get("browser_download_url") or "")
        for asset in release.get("assets") or []
        if isinstance(asset, dict)
    }
    if not assets.get(expected) or not assets.get("SHA256SUMS.txt"):
        raise UpdateError("The release does not contain the expected installer or checksums")

    for name in (expected, "SHA256SUMS.txt"):
        url = f"https://github.com/pythonIsFast/IDELite/releases/download/v{latest}/{name}"
        if assets[name] != url:
            raise UpdateError("Release asset URL does not belong to the expected IDELite release")

    directory = Path(tempfile.mkdtemp(prefix="idelite-update-"))
    installer = directory / expected
    checksums = directory / "SHA256SUMS.txt"
    try:
        _download(assets[expected], installer, 100 * 1024 * 1024 if platform == "windows-exe" else 5 * 1024 * 1024)
        _download(assets["SHA256SUMS.txt"], checksums, 64 * 1024)

        expected_hash = None
        for line in checksums.read_text(encoding="utf-8").splitlines():
            digest, separator, name = line.partition("  ")
            if separator and name == expected:
                expected_hash = digest.lower()
                break
        if not expected_hash or _sha256(installer) != expected_hash:
            raise UpdateError("The downloaded installer's SHA-256 checksum did not match")

        if platform == "windows-exe":
            _install_windows_after_exit(installer, directory, os.getpid(), restart)
        else:
            _install_after_exit(installer, directory, os.getpid(), restart)
    except Exception as error:
        shutil.rmtree(directory, ignore_errors=True)
        if isinstance(error, UpdateError):
            raise
        raise UpdateError(f"Could not prepare the update: {error}") from error
    return {"status": "started", "version": latest}
