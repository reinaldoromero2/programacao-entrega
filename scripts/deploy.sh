#!/usr/bin/env bash
# deploy.sh — Fluxo completo de deploy:
#   1. Build do dist da API (com RELEASE_ID embutido)
#   2. Commit local (source + dist)
#   3. Force-push para o mirror → Render roda o dist pré-compilado
#   4. Smoke test: aguarda produção reportar o RELEASE_ID esperado
#
# Uso: bash scripts/deploy.sh
# Requer: GITHUB_PERSONAL_ACCESS_TOKEN (conta reinaldoromero2)

set -euo pipefail

TOKEN="${GITHUB_PERSONAL_ACCESS_TOKEN:-}"
MIRROR_REPO="reinaldoromero2/programacao-entrega"
DIST_FILE="artifacts/api-server/dist/index.mjs"

if [ -z "$TOKEN" ]; then
  echo "❌ GITHUB_PERSONAL_ACCESS_TOKEN não está definido"
  echo "   Configure em Replit Secrets e tente novamente."
  exit 1
fi

# Generate a stable release ID at deploy start — used throughout the workflow
# so the build, the commit, and the production check all reference the same value.
RELEASE_ID=$(date -u '+%Y%m%d%H%M%S')

echo "========================================="
echo " Deploy — $(date -u '+%Y-%m-%d %H:%M UTC')"
echo " Release: ${RELEASE_ID}"
echo "========================================="

# ── 1. Build ──────────────────────────────────
echo ""
echo "🔨 [1/3] Buildando API (esbuild)..."
# Pass the release ID so esbuild can embed it in the bundle
DEPLOY_RELEASE_ID="${RELEASE_ID}" pnpm --filter @workspace/api-server run build

# Verify build output exists and is non-empty
if [ ! -s "${DIST_FILE}" ]; then
  echo "❌ Build falhou: ${DIST_FILE} não encontrado ou vazio"
  exit 1
fi
echo "   ✓ ${DIST_FILE} atualizado ($(wc -c < "${DIST_FILE}") bytes)"

# ── 2. Commit local ───────────────────────────
echo ""
echo "📦 [2/3] Verificando mudanças para commitar..."

# Garante identidade git (necessário no ambiente Replit)
git config user.email "300593588+reinaldoromero2@users.noreply.github.com" 2>/dev/null || true
git config user.name  "Reinaldo Romero" 2>/dev/null || true

git add -A
if git diff --cached --quiet; then
  echo "   (nada novo — working tree limpa)"
else
  git commit -m "deploy: ${RELEASE_ID}"
  echo "   ✓ Commit criado"
fi

LOCAL_SHA=$(git rev-parse HEAD)
echo "   ✓ HEAD local: ${LOCAL_SHA}"

# ── 3. Push para o mirror ─────────────────────
# O mirror (reinaldoromero2/programacao-entrega) é exclusivamente um alvo de deploy;
# usa --force porque o histórico pode divergir do sync anterior via GitHub API.
echo ""
echo "🚀 [3/3] Enviando para mirror ${MIRROR_REPO}..."
git push "https://${TOKEN}@github.com/${MIRROR_REPO}.git" main --force

# Verify the mirror received our commit
MIRROR_SHA=$(git ls-remote "https://${TOKEN}@github.com/${MIRROR_REPO}.git" refs/heads/main | awk '{print $1}')
if [ "${MIRROR_SHA}" != "${LOCAL_SHA}" ]; then
  echo "❌ Push concluído mas SHA do mirror (${MIRROR_SHA}) difere do local (${LOCAL_SHA})"
  exit 1
fi
echo "   ✓ Mirror atualizado — SHA confirmado: ${MIRROR_SHA}"

echo ""
echo "✅ Push concluído! Aguardando Render iniciar e verificando produção..."
echo "   (Ctrl+C para pular a verificação e monitorar manualmente em https://dashboard.render.com)"
echo ""

# Run the smoke test — pass the exact RELEASE_ID so it can compare against the
# timestamp embedded in the pre-built dist (not just the SHA fallback).
bash "$(dirname "$0")/check-deploy.sh" "${RELEASE_ID}"
