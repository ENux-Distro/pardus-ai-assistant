#!/usr/bin/env bash
# Builds a .deb of Pardus Assistant that installs and runs with zero further
# setup: no `bun`, `git`, or network access needed on the target machine.
#
# It ships:
#   - a private `bun` runtime (Debian doesn't package bun)
#   - the OpenCode engine as the single compiled binary from `make engine`
#     (NOT its source + node_modules — that's several GB; the compiled
#     binary is self-contained)
#   - the OpenCode JS SDK's actual runtime files. The backend loads it via a
#     dynamic `import()`, so it needs real source on disk; its own runtime
#     dependency footprint is tiny (cross-spawn and a couple of its deps) —
#     nowhere near the full monorepo's node_modules.
#
# Usage: run from the repo root: bash packaging/build-deb.sh
set -euo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$APP_DIR"

PKG=pardus-assistant
VERSION="$(grep -m1 '"version"' backend/package.json | sed -E 's/.*"([0-9.]+)".*/\1/')"
ARCH="$(dpkg --print-architecture)"
OUT="$APP_DIR/dist-deb"
ROOT="$OUT/pkgroot"

say() { printf '\033[1;33m==>\033[0m %s\n' "$1"; }
fail() { printf '\033[1;31mError:\033[0m %s\n' "$1" >&2; exit 1; }

# --- sanity checks -----------------------------------------------------------
ENGINE_BIN="$(ls opencode/packages/opencode/dist/*/bin/opencode 2>/dev/null | head -1 || true)"
[ -n "$ENGINE_BIN" ] || fail "no compiled engine found. Run 'make engine' first."

BUN="$(command -v bun 2>/dev/null || true)"
[ -z "$BUN" ] && [ -x "$HOME/.bun/bin/bun" ] && BUN="$HOME/.bun/bin/bun"
[ -n "$BUN" ] || fail "bun not found on this machine (needed to bundle the runtime)."

[ -d opencode/packages/sdk/js/node_modules ] || fail "opencode/packages/sdk/js/node_modules missing — run 'make engine' first."

say "Packaging $PKG $VERSION ($ARCH)"
say "  engine binary: $ENGINE_BIN ($(du -h "$ENGINE_BIN" | cut -f1))"
say "  bun runtime:   $BUN ($(du -h "$(readlink -f "$BUN")" | cut -f1))"

rm -rf "$OUT"
mkdir -p "$ROOT/opt/$PKG/app" "$ROOT/opt/$PKG/runtime" "$ROOT/usr/bin" "$ROOT/usr/share/applications" "$ROOT/DEBIAN"

# --- app files -----------------------------------------------------------
say "Copying app files…"
cp -r backend frontend bin "$ROOT/opt/$PKG/app/"
rm -f "$ROOT/opt/$PKG/app/backend/actions.log"

# --- engine: compiled binary only, real dir structure config.ts expects ---
say "Copying compiled engine…"
ENGINE_REL="${ENGINE_BIN#opencode/}"
mkdir -p "$ROOT/opt/$PKG/app/opencode/$(dirname "$ENGINE_REL")"
cp "$ENGINE_BIN" "$ROOT/opt/$PKG/app/opencode/$ENGINE_REL"
chmod +x "$ROOT/opt/$PKG/app/opencode/$ENGINE_REL"

# --- SDK: real source + its actual (tiny) runtime deps -----------------------
# The backend loads the SDK via a dynamic `import()`, so real source must be on
# disk (not bundled). bun links its deps through its own content-addressed
# store (node_modules/.bun/<pkg>@<ver>/...), NOT plain node_modules symlink
# hoisting — `cp -rL` of the SDK's local node_modules only grabs cross-spawn
# itself, not ITS transitive deps, so `require('which')` fails at runtime.
# Materialize a normal flat node_modules by hand instead, with cross-spawn's
# full (small) runtime closure — nothing else. This is @opencode-ai/sdk's only
# runtime dependency; typecheck-only devDependencies are skipped entirely.
say "Copying SDK source + slim runtime deps…"
mkdir -p "$ROOT/opt/$PKG/app/opencode/packages/sdk/js"
cp -r opencode/packages/sdk/js/src "$ROOT/opt/$PKG/app/opencode/packages/sdk/js/"
cp opencode/packages/sdk/js/package.json opencode/packages/sdk/js/tsconfig.json "$ROOT/opt/$PKG/app/opencode/packages/sdk/js/" 2>/dev/null || true
SDK_NM="$ROOT/opt/$PKG/app/opencode/packages/sdk/js/node_modules"
mkdir -p "$SDK_NM"
for spec in cross-spawn@7.0.6 which@2.0.2 path-key@3.1.1 shebang-command@2.0.0 isexe@2.0.0 shebang-regex@3.0.0; do
  name="${spec%@*}"
  src="opencode/node_modules/.bun/$spec/node_modules/$name"
  [ -d "$src" ] || fail "engine store is missing $spec — did 'make engine' resolve different versions? Update packaging/build-deb.sh's pinned list."
  cp -r "$src" "$SDK_NM/$name"
done

# --- private bun runtime ---------------------------------------------------
say "Bundling bun runtime…"
cp "$(readlink -f "$BUN")" "$ROOT/opt/$PKG/runtime/bun"
chmod +x "$ROOT/opt/$PKG/runtime/bun"

# --- launcher symlink + desktop entry --------------------------------------
chmod +x "$ROOT/opt/$PKG/app/bin/pardus-assistant"
ln -sf "/opt/$PKG/app/bin/pardus-assistant" "$ROOT/usr/bin/pardus-assistant"

cat > "$ROOT/usr/share/applications/pardus-assistant.desktop" <<EOF
[Desktop Entry]
Type=Application
Name=Pardus Assistant
Comment=A friendly AI helper for your computer
Exec=/usr/bin/pardus-assistant
Icon=system-help
Terminal=false
Categories=Utility;System;
StartupWMClass=PardusAssistant
EOF

# --- installed size (KB, for the control file) -----------------------------
SIZE_KB="$(du -sk "$ROOT" | cut -f1)"

# --- DEBIAN/control ----------------------------------------------------------
cat > "$ROOT/DEBIAN/control" <<EOF
Package: $PKG
Version: $VERSION
Section: utils
Priority: optional
Architecture: $ARCH
Installed-Size: $SIZE_KB
Maintainer: ENux-Distro <emir73503@gmail.com>
Recommends: python3-gi, gir1.2-webkit2-4.1
Suggests: chromium
Homepage: https://github.com/ENux-Distro/pardus-ai-assistant
Description: Friendly AI assistant for absolute Linux beginners
 Pardus Assistant is a plain-language AI helper for people who are brand
 new to Linux. It ships its own bun runtime and a precompiled OpenCode
 engine, so it works offline right after install — no extra downloads,
 no API keys.
EOF

cat > "$ROOT/DEBIAN/postinst" <<'EOF'
#!/bin/sh
set -e
command -v update-desktop-database >/dev/null 2>&1 && \
  update-desktop-database -q /usr/share/applications || true
exit 0
EOF
chmod +x "$ROOT/DEBIAN/postinst"

cat > "$ROOT/DEBIAN/postrm" <<'EOF'
#!/bin/sh
# Saved conversations live under each user's own $HOME and are intentionally
# left in place on removal/purge — only the app itself is removed.
set -e
command -v update-desktop-database >/dev/null 2>&1 && \
  update-desktop-database -q /usr/share/applications || true
exit 0
EOF
chmod +x "$ROOT/DEBIAN/postrm"

# --- build -------------------------------------------------------------------
say "Building .deb…"
DEB="$OUT/${PKG}_${VERSION}_${ARCH}.deb"
dpkg-deb --root-owner-group --build "$ROOT" "$DEB" >/dev/null

say "Built: $DEB ($(du -h "$DEB" | cut -f1))"
dpkg-deb --info "$DEB"
echo
dpkg-deb --contents "$DEB" | awk '{print $1, $6}' | sort -k2 | head -30 || true
