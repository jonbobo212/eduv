#!/usr/bin/env bash
# Pass 1 — static mirror via wget.
# Grabs everything reachable by parsing HTML and CSS: pages, stylesheets,
# scripts, images, fonts. Whatever only appears because JS ran is picked up
# later by pass 2 (tools/capture.mjs).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

ORIGIN=$(jq -r '.origin'  config.json)
OUTDIR=$(jq -r '.outDir'  config.json)
HOST=${ORIGIN#https://}; HOST=${HOST#http://}; HOST=${HOST%%/*}

# Asset hosts (CDNs, font providers) we also want pulled down, so the copy has
# no outbound dependencies at all.
EXTRA=$(jq -r '.extraHosts | join(",")' config.json)
DOMAINS="$HOST"
[ -n "$EXTRA" ] && DOMAINS="$HOST,$EXTRA"

UA='Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'

echo "==> mirroring $ORIGIN into $OUTDIR/"
mkdir -p "$OUTDIR"

# --page-requisites  pull every asset a page needs to render
# --convert-links    rewrite hrefs/srcs to point at the local copies
# --adjust-extension save /about as about.html so a plain static server works
# --span-hosts       follow into the CDN hosts listed above (and only those)
# --no-clobber is deliberately NOT used: we want re-runs to refresh content.
set +e
wget \
  --recursive --level=inf \
  --page-requisites \
  --convert-links \
  --adjust-extension \
  --span-hosts --domains="$DOMAINS" \
  --execute robots=off \
  --user-agent="$UA" \
  --wait=0.3 --random-wait \
  --tries=3 --timeout=30 \
  --no-verbose \
  --directory-prefix="$OUTDIR" \
  --no-host-directories \
  "$ORIGIN/"
STATUS=$?
set -e

# wget exits 8 on any 404 among requisites, which is normal for a real site
# (missing favicons, referenced-but-absent sourcemaps). Only a hard failure
# with nothing on disk is worth aborting for.
if [ ! -s "$OUTDIR/index.html" ]; then
  echo "!! mirror failed - no index.html was written (wget exit $STATUS)" >&2
  echo "   If this is a 403/CONNECT error the host is blocked by an egress" >&2
  echo "   policy; run this script from an unrestricted machine." >&2
  exit 1
fi

echo "==> pass 1 complete"
find "$OUTDIR" -type f | wc -l | xargs printf '    %s files\n'
du -sh "$OUTDIR" | awk '{printf "    %s on disk\n", $1}'
