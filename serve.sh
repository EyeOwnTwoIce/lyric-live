#!/usr/bin/env bash
# Arranca la aplicacion en local.
#
# En macOS/Linux:  ./serve.sh
# En Windows:      py -m http.server 8080
#
# Notas:
#  - http://localhost:8080 SI permite microfono (localhost es contexto seguro).
#  - Abrirla desde el movil por la IP de la red local (http://192.168.x.x:8080)
#    NO funcionara: los navegadores exigen HTTPS para getUserMedia.
#    Para el movil usa la URL de GitHub Pages.

set -euo pipefail
PORT="${1:-8080}"
cd "$(dirname "$0")"

if command -v python3 >/dev/null 2>&1; then
  PY=python3
elif command -v py >/dev/null 2>&1; then
  PY=py
elif command -v python >/dev/null 2>&1; then
  PY=python
else
  echo "No encuentro Python. Alternativa con Node: npx serve -l ${PORT}" >&2
  exit 1
fi

exec "$PY" tools/serve.py "$PORT"
