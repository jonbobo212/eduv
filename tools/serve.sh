#!/usr/bin/env bash
# Preview the mirror locally. Defaults to port 8080.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUTDIR=$(jq -r '.outDir' "$ROOT/config.json")
PORT="${1:-8080}"
cd "$ROOT/$OUTDIR"
echo "==> serving $OUTDIR/ at http://localhost:$PORT"
echo "    (network can be off - the mirror is self-contained)"
python3 -m http.server "$PORT"
