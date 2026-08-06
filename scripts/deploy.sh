#!/usr/bin/env bash
# deploy.sh — Fluxo completo de deploy:
#   1. Build do dist da API
#   2. Commit local (source + dist)
#   3. Force-push para o mirror → Render faz auto-deploy
#
# Uso: bash scripts/deploy.sh
# Requer: GITHUB_PERSONAL_ACCESS_TOKEN (conta reinaldoromero2)

set -euo pipefail

TOKEN="${GITHUB_PERSONAL_ACCESS_TOKEN:-}"
MIRROR_REPO="reinaldoromero2/programacao-entrega"

if [ -z "$TOKEN" ]; then
  echo "❌ GITHUB_PERSONAL_ACCESS_TOKEN não está definido"
  echo "   Configure em Replit Secrets e tente novamente."
  exit 1
fi

echo "========================================="
echo " Deploy — $(date -u '+%Y-%m-%d %H:%M UTC')"
echo "========================================="

# ── 1. Build ──────────────────────────────────
echo ""
echo "🔨 [1/3] Buildando API (esbuild)..."
pnpm --filter @workspace/api-server run build
echo "   ✓ artifacts/api-server/dist/index.mjs atualizado"

# ── 2. Commit local ───────────────────────────
echo ""
echo "📦 [2/3] Verificando mudanças para commitar..."

# Garante identidade git (necessário no ambiente Replit)
git config user.email "deploy@replit.local" 2>/dev/null || true
git config user.name  "Replit Deploy"       2>/dev/null || true

git add -A
if git diff --cached --quiet; then
  echo "   (nada novo — working tree limpa)"
else
  TIMESTAMP=$(date -u '+%Y-%m-%d %H:%M UTC')
  git commit -m "deploy: ${TIMESTAMP}"
  echo "   ✓ Commit criado"
fi

# ── 3. Push para o mirror ─────────────────────
# O mirror (reinaldoromero2/programacao-entrega) é exclusivamente um alvo de deploy;
# usa --force porque o histórico pode divergir do sync anterior via GitHub API.
echo ""
echo "🚀 [3/3] Enviando para mirror ${MIRROR_REPO}..."
git push "https://${TOKEN}@github.com/${MIRROR_REPO}.git" main --force
echo "   ✓ Mirror atualizado"

echo ""
echo "✅ Deploy enviado!"
echo "   Render auto-deploys: https://dashboard.render.com"
echo "   App em produção:     https://data-fill-tool.onrender.com"
