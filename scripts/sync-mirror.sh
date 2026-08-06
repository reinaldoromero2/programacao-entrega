#!/usr/bin/env bash
# ⚠️  DEPRECADO — Use `bash scripts/deploy.sh` no lugar deste script.
#    deploy.sh faz build + commit + push completo para o mirror num único passo.
#
# Este script mantido apenas como fallback para sincronizar arquivos específicos
# via GitHub API (útil se o git push direto não funcionar por alguma razão).
#
# Syncs changed files from source repo to the Vercel mirror repo via GitHub API.
# Run after local changes + gitPush. Requires GITHUB_PERSONAL_ACCESS_TOKEN env var.

set -euo pipefail

MIRROR="reinaldoromero2/programacao-entrega"
TOKEN="${GITHUB_PERSONAL_ACCESS_TOKEN:-}"

if [ -z "$TOKEN" ]; then
  echo "⚠ GITHUB_PERSONAL_ACCESS_TOKEN not set, skipping mirror sync"
  exit 0
fi

echo "🔄 Syncing mirror ${MIRROR}..."

python3 << 'PYEOF'
import os, json, base64, urllib.request, urllib.error, sys

TOKEN = os.environ["GITHUB_PERSONAL_ACCESS_TOKEN"]
MIRROR = "reinaldoromero2/programacao-entrega"
BASE = "https://api.github.com"

FILES = [
    "artifacts/programacao-entrega/src/components/relatorio-modal.tsx",
    "artifacts/api-server/src/routes/entregas.ts",
    "artifacts/api-server/dist/index.mjs",
    "vercel.json",
]

def gh(method, path, body=None):
    url = f"{BASE}{path}"
    data = json.dumps(body).encode() if body else None
    req = urllib.request.Request(url, data=data, method=method, headers={
        "Authorization": f"Bearer {TOKEN}",
        "Accept": "application/vnd.github+json",
        "Content-Type": "application/json",
    })
    try:
        with urllib.request.urlopen(req) as r:
            return json.loads(r.read())
    except urllib.error.HTTPError as e:
        return json.loads(e.read())

# Get current HEAD
ref = gh("GET", f"/repos/{MIRROR}/git/refs/heads/main")
head_sha = ref["object"]["sha"]
commit = gh("GET", f"/repos/{MIRROR}/git/commits/{head_sha}")
base_tree = commit["tree"]["sha"]

tree_entries = []
for path in FILES:
    if not os.path.exists(path):
        print(f"  ⚠ skip {path} (not found)")
        continue
    with open(path, "rb") as f:
        content = base64.b64encode(f.read()).decode()
    blob = gh("POST", f"/repos/{MIRROR}/git/blobs", {"content": content, "encoding": "base64"})
    blob_sha = blob.get("sha")
    if not blob_sha:
        print(f"  ✗ blob failed for {path}: {blob.get('message','?')}")
        continue
    tree_entries.append({"path": path, "mode": "100644", "type": "blob", "sha": blob_sha})
    print(f"  ✓ blob {path} → {blob_sha[:8]}")

if not tree_entries:
    print("Nothing to sync.")
    sys.exit(0)

new_tree = gh("POST", f"/repos/{MIRROR}/git/trees", {"base_tree": base_tree, "tree": tree_entries})
new_tree_sha = new_tree.get("sha")

new_commit = gh("POST", f"/repos/{MIRROR}/git/commits", {
    "message": "sync: update from source repo",
    "tree": new_tree_sha,
    "parents": [head_sha]
})
new_commit_sha = new_commit.get("sha")

result = gh("PATCH", f"/repos/{MIRROR}/git/refs/heads/main", {"sha": new_commit_sha})
print(f"\n✅ Mirror updated → {result.get('object',{}).get('sha','ERR')[:7]}")
PYEOF
