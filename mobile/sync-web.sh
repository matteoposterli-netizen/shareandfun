#!/usr/bin/env bash
#
# sync-web.sh — Assembla mobile/www copiando gli asset della SPA dalla root.
#
# Idempotente: ricostruisce www/ da zero a ogni esecuzione. Da rilanciare
# ad ogni modifica della SPA prima di `npx cap sync`.
#
# Copia: index.html, styles.css, js/, web-mobile/ (mobile-init.js) e assets/.
# Esclude tutto il resto (devboard.html, docs, supabase/, scripts/, ...).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
WWW="$SCRIPT_DIR/www"

echo "→ Sorgente: $ROOT"
echo "→ Destinazione: $WWW"

rm -rf "$WWW"
mkdir -p "$WWW"

# File singoli obbligatori
cp "$ROOT/index.html" "$WWW/index.html"
cp "$ROOT/styles.css" "$WWW/styles.css"

# Cartelle di asset referenziate da index.html
cp -R "$ROOT/js"          "$WWW/js"
cp -R "$ROOT/web-mobile"  "$WWW/web-mobile"

# assets/ (immagini) — opzionale, copiato se presente
if [ -d "$ROOT/assets" ]; then
  cp -R "$ROOT/assets" "$WWW/assets"
fi

echo "✓ www assemblato ($(find "$WWW" -type f | wc -l | tr -d ' ') file)"
