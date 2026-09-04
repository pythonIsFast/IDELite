#!/usr/bin/env python3
"""Build a compact, self-contained Python zip application for Linux."""

from __future__ import annotations

import os
import shutil
import subprocess
import sys
import tempfile
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
VERSION = (ROOT / "VERSION").read_text(encoding="utf-8").strip()
OUTPUT = ROOT / "dist" / f"idelite-{VERSION}.pyz"


def main() -> None:
    with tempfile.TemporaryDirectory(prefix="idelite-build-") as temporary:
        stage = Path(temporary)
        subprocess.run(
            [
                sys.executable,
                "-m",
                "pip",
                "install",
                "--quiet",
                "--no-compile",
                "--target",
                str(stage),
                "-r",
                str(ROOT / "requirements.txt"),
            ],
            check=True,
        )
        shutil.copytree(ROOT / "idelite", stage / "idelite")
        shutil.copy2(ROOT / "run.py", stage / "run.py")
        (stage / "__main__.py").write_text("from run import main\nmain()\n", encoding="utf-8")

        for path in list(stage.rglob("*")):
            if path.is_dir() and path.name == "__pycache__":
                shutil.rmtree(path)
        for pattern in ("*.pyc", "*.so", "*.pyd"):
            for path in stage.rglob(pattern):
                path.unlink()
        # zipimport does not reliably discover implicit namespace subpackages.
        for path in list(stage.rglob("*")):
            if path.is_dir() and any(child.suffix == ".py" for child in path.iterdir() if child.is_file()):
                initializer = path / "__init__.py"
                if not initializer.exists():
                    initializer.touch()

        OUTPUT.parent.mkdir(exist_ok=True)
        archive = OUTPUT.with_suffix(".zip")
        with zipfile.ZipFile(archive, "w", zipfile.ZIP_DEFLATED, compresslevel=9) as bundle:
            for path in sorted(stage.rglob("*")):
                if path.is_file():
                    bundle.write(path, path.relative_to(stage))
        with OUTPUT.open("wb") as destination, archive.open("rb") as source:
            destination.write(b"#!/usr/bin/env python3\n")
            shutil.copyfileobj(source, destination)
        archive.unlink()
        OUTPUT.chmod(OUTPUT.stat().st_mode | 0o111)

    size = OUTPUT.stat().st_size
    print(f"Built {OUTPUT.relative_to(ROOT)} ({size / 1024 / 1024:.2f} MB)")
    if size > 5 * 1024 * 1024:
        raise SystemExit("Build exceeds the 5 MB target")


if __name__ == "__main__":
    main()
