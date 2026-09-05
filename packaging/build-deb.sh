#!/usr/bin/env bash
# Build the IDELite Debian package around the compact zip application.
set -euo pipefail

version="${1:-$(tr -d '[:space:]' < VERSION)}"
pyz="${2:-dist/idelite-${version}.pyz}"
outdir="${3:-dist}"

root="$(cd "$(dirname "$0")/.." && pwd)"
pyz="$(cd "$(dirname "$pyz")" && pwd)/$(basename "$pyz")"
stage="$(mktemp -d)"
trap 'rm -rf "$stage"' EXIT
chmod 755 "$stage"

if [[ ! -f "$pyz" ]]; then
    echo "Missing zip application: $pyz" >&2
    exit 1
fi

install -Dm755 "$pyz" "$stage/opt/idelite/idelite.pyz"
install -Dm755 "$root/packaging/linux/idelite" "$stage/usr/bin/idelite"
install -Dm644 "$root/packaging/linux/idelite.desktop" \
    "$stage/usr/share/applications/idelite.desktop"
install -Dm644 "$root/packaging/linux/idelite.svg" \
    "$stage/usr/share/icons/hicolor/scalable/apps/idelite.svg"
install -Dm644 "$root/LICENSE" "$stage/usr/share/doc/idelite/copyright"
install -Dm644 "$root/NOTICE" "$stage/usr/share/doc/idelite/NOTICE"

mkdir -p "$stage/DEBIAN"
cat > "$stage/DEBIAN/control" <<EOF
Package: idelite
Version: $version
Section: devel
Priority: optional
Architecture: all
Maintainer: pythonIsFast <pythonIsFast@users.noreply.github.com>
Depends: python3 (>= 3.10), python3-gi, python3-gi-cairo, gir1.2-gtk-3.0, gir1.2-webkit2-4.1 | gir1.2-webkit2-4.0, pkexec | policykit-1, apt
Suggests: git, nodejs
Homepage: https://github.com/pythonIsFast/IDELite
Description: Compact VSCode-inspired desktop editor
 IDELite is a small local code editor with a workspace explorer, tabs, search,
 terminal, Git status, and lightweight syntax highlighting.
 .
 It uses the operating system's Python and WebKitGTK instead of bundling a
 browser engine, keeping the package in the low single-digit megabytes.
EOF

package="$outdir/idelite_${version}_all.deb"
mkdir -p "$outdir"
dpkg-deb --build --root-owner-group "$stage" "$package"
echo "Built $package ($(du -h "$package" | cut -f1))"
