#!/usr/bin/env bash
# ============================================================================
# clear-state.sh - bersihkan runtime/state.json di awal run
# (biar panel tidak menampilkan sesi lama saat run baru dimulai)
# Butuh env: PANEL_KEY, GH_TOKEN, GITHUB_REPOSITORY
# Jalan di bash (Linux runner & Git Bash di Windows runner).
# ============================================================================
set -uo pipefail
[ -n "${PANEL_KEY:-}" ] || { echo "skip: PANEL_KEY kosong"; exit 0; }
[ -n "${GH_TOKEN:-}" ] || { echo "skip: GH_TOKEN kosong"; exit 0; }
REPO="${GITHUB_REPOSITORY:-}"
[ -n "$REPO" ] || { echo "skip: GITHUB_REPOSITORY kosong"; exit 0; }

PY=$(command -v python3 || command -v python || echo "")
[ -n "$PY" ] || { echo "skip: python tidak ada"; exit 0; }

IV=$(openssl rand -hex 16)
NOW=$(date -u +%Y-%m-%dT%H:%M:%SZ)
PAST=$(date -u -d '1 minute ago' +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || date -u -v-1M +%Y-%m-%dT%H:%M:%SZ)
PAYLOAD="{\"v\":1,\"ip\":\"\",\"dns\":\"\",\"user\":\"\",\"pass\":\"\",\"machine\":\"\",\"starting\":true,\"provisionedAt\":\"$NOW\",\"expiresAt\":\"$PAST\"}"
IVB=$(printf '%s' "$IV" | "$PY" -c "import sys,binascii,base64;print(base64.b64encode(binascii.unhexlify(sys.stdin.read().strip())).decode())")
CT=$(printf '%s' "$PAYLOAD" | openssl enc -aes-256-cbc -K "$PANEL_KEY" -iv "$IV" -base64 -A)
BLOB="v1.$IVB.$CT"
B64=$(printf '%s' "$BLOB" | base64 -w0)

SHA=$("$PY" - <<PYEOF
import json,sys,urllib.request
try:
    req=urllib.request.Request("https://api.github.com/repos/$REPO/contents/runtime/state.json",headers={"Authorization":"Bearer $GH_TOKEN","User-Agent":"kall"})
    print(json.load(urllib.request.urlopen(req)).get("sha",""))
except Exception:
    print("")
PYEOF
)
BODY=$("$PY" - "$SHA" "$B64" <<'PYEOF'
import json,sys
d={"message":"clear state (run start)","content":sys.argv[2]}
if sys.argv[1]: d["sha"]=sys.argv[1]
print(json.dumps(d))
PYEOF
)
curl -s -X PUT -H "Authorization: Bearer $GH_TOKEN" -H "Accept: application/vnd.github+json" \
  -d "$BODY" "https://api.github.com/repos/$REPO/contents/runtime/state.json" -o /dev/null -w '' 2>/dev/null || true
echo "state lama dibersihkan (starting)"
