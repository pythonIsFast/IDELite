"""Run local syntax checks and normalize their diagnostics for the editor."""
from __future__ import annotations

import re
import shutil
import subprocess
import sys
from pathlib import Path

CHECKS = {
    ".py": lambda path: [sys.executable, "-m", "py_compile", str(path)],
    ".js": lambda path: ["node", "--check", str(path)],
    ".mjs": lambda path: ["node", "--check", str(path)],
    ".cjs": lambda path: ["node", "--check", str(path)],
    ".ts": lambda path: ["tsc", "--noEmit", "--pretty", "false", str(path)],
    ".tsx": lambda path: ["tsc", "--noEmit", "--pretty", "false", str(path)],
    ".c": lambda path: ["gcc", "-fsyntax-only", str(path)],
    ".cc": lambda path: ["g++", "-fsyntax-only", str(path)],
    ".cpp": lambda path: ["g++", "-fsyntax-only", str(path)],
    ".cxx": lambda path: ["g++", "-fsyntax-only", str(path)],
    ".cs": lambda path: ["dotnet", "build", "--nologo", str(path)],
    ".java": lambda path: ["javac", "-XDrawDiagnostics", str(path)],
    ".kt": lambda path: ["kotlinc", str(path), "-d", str(path.parent / ".idelite-kotlin-check")],
    ".go": lambda path: ["go", "tool", "compile", str(path)],
    ".rs": lambda path: ["rustc", "--emit=metadata", str(path)],
    ".php": lambda path: ["php", "-l", str(path)],
    ".rb": lambda path: ["ruby", "-c", str(path)],
    ".sh": lambda path: ["bash", "-n", str(path)],
    ".bash": lambda path: ["bash", "-n", str(path)],
    ".ps1": lambda path: ["pwsh", "-NoProfile", "-Command", "[scriptblock]::Create((Get-Content -Raw -LiteralPath $args[0])) | Out-Null", str(path)],
}
LINE = re.compile(r"(?::|\()(?P<line>\d+)(?::|,|\))(?P<column>\d+)?")


def diagnose(path: Path, root: Path) -> dict[str, object]:
    suffix = path.suffix.lower()
    factory = CHECKS.get(suffix)
    if factory is None:
        return {"supported": False, "diagnostics": [], "message": "No syntax checker is available for this file type."}
    command = factory(path)
    if shutil.which(command[0]) is None:
        return {"supported": True, "diagnostics": [], "message": f"{command[0]} is not installed; install it to check this file."}
    try:
        result = subprocess.run(command, cwd=root, capture_output=True, text=True, errors="replace", timeout=20)
    except (OSError, subprocess.SubprocessError) as error:
        return {"supported": True, "diagnostics": [], "message": f"Could not run syntax check: {error}"}
    output = (result.stderr or result.stdout).strip()
    if result.returncode == 0:
        return {"supported": True, "diagnostics": [], "message": "No syntax errors found."}
    diagnostics = []
    for text in output.splitlines():
        match = LINE.search(text)
        if match and ("error" in text.lower() or "syntax" in text.lower()):
            diagnostics.append({"line": int(match["line"]), "column": int(match["column"] or 1), "message": text.strip()[:500]})
    if not diagnostics:
        diagnostics = [{"line": 1, "column": 1, "message": output[:500] or "The syntax check failed."}]
    return {"supported": True, "diagnostics": diagnostics[:100], "message": f"{len(diagnostics)} problem(s) found."}
