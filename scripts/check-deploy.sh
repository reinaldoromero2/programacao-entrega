#!/usr/bin/env bash
# check-deploy.sh — Smoke test pós-deploy.
#
# Verifica se os três estágios do deploy.sh concluíram com sucesso:
#   1. Build output existe e não está vazio
#   2. O mirror no GitHub tem o mesmo SHA que o HEAD local
#   3. O app em produção está rodando o release esperado (via /api/healthz)
#
# Uso: bash scripts/check-deploy.sh <release-id>
#   O release-id é o valor de RELEASE_ID gerado por deploy.sh (ex: 20260806192100)
#
# Requer: GITHUB_PERSONAL_ACCESS_TOKEN (conta reinaldoromero2)

set -euo pipefail

EXPECTED_RELEASE="${1:?Uso: bash scripts/check-deploy.sh <release-id>}"
TOKEN="${GITHUB_PERSONAL_ACCESS_TOKEN:-}"
MIRROR_REPO="reinaldoromero2/programacao-entrega"
DIST_FILE="artifacts/api-server/dist/index.mjs"
HEALTHZ_URL="https://data-fill-tool.onrender.com/api/healthz"

# Poll settings: wait up to 6 minutes (36 × 10 s)
POLL_ATTEMPTS=36
POLL_INTERVAL=10

PASS=0
FAIL=0

ok()   { echo "   ✅ $*"; PASS=$((PASS + 1)); }
fail() { echo "   ❌ $*"; FAIL=$((FAIL + 1)); }

echo "================================================="
echo " Smoke test — $(date -u '+%Y-%m-%d %H:%M UTC')"
echo " Esperando release: ${EXPECTED_RELEASE}"
echo "================================================="

# ── Token obrigatório ─────────────────────────────────
if [ -z "$TOKEN" ]; then
  echo "❌ GITHUB_PERSONAL_ACCESS_TOKEN não está definido"
  echo "   Configure em Replit Secrets e tente novamente."
  exit 1
fi

# ── 1. Build output ──────────────────────────────────
echo ""
echo "🔍 [1/3] Verificando build output..."
if [ -s "${DIST_FILE}" ]; then
  ok "${DIST_FILE} existe ($(wc -c < "${DIST_FILE}") bytes)"
else
  fail "${DIST_FILE} não encontrado ou vazio — rode deploy.sh novamente"
fi

# ── 2. Mirror SHA ────────────────────────────────────
echo ""
echo "🔍 [2/3] Verificando sincronização com o mirror..."
LOCAL_SHA=$(git rev-parse HEAD)
MIRROR_SHA=""
if ! MIRROR_SHA=$(git ls-remote "https://${TOKEN}@github.com/${MIRROR_REPO}.git" refs/heads/main 2>/dev/null | awk '{print $1}'); then
  fail "Erro ao contactar o mirror — verifique credenciais e conectividade"
elif [ -z "${MIRROR_SHA}" ]; then
  fail "Nenhum SHA retornado pelo mirror (branch main inexistente?)"
elif [ "${MIRROR_SHA}" = "${LOCAL_SHA}" ]; then
  ok "Mirror em sincronia com HEAD local (${MIRROR_SHA})"
else
  fail "Mirror desatualizado: local=${LOCAL_SHA} mirror=${MIRROR_SHA}"
  echo "   ⚠️  Execute 'bash scripts/deploy.sh' para sincronizar."
fi

# ── 3. Produção rodando o release esperado ────────────
echo ""
echo "🔍 [3/3] Aguardando produção reportar o release ${EXPECTED_RELEASE}..."
echo "   (máx ${POLL_ATTEMPTS} tentativas × ${POLL_INTERVAL}s = $((POLL_ATTEMPTS * POLL_INTERVAL))s)"

PROD_OK=false
for attempt in $(seq 1 "${POLL_ATTEMPTS}"); do
  PROD_RESPONSE=$(curl -sf --max-time 15 "${HEALTHZ_URL}" 2>/dev/null || true)
  PROD_RELEASE=$(echo "${PROD_RESPONSE}" | grep -o '"release":"[^"]*"' | cut -d'"' -f4 || true)

  if [ -z "${PROD_RESPONSE}" ]; then
    echo "   [${attempt}/${POLL_ATTEMPTS}] Sem resposta — aguardando ${POLL_INTERVAL}s..."
  elif [ -z "${PROD_RELEASE}" ]; then
    echo "   [${attempt}/${POLL_ATTEMPTS}] Campo 'release' ausente na resposta — aguardando ${POLL_INTERVAL}s..."
  elif [ "${PROD_RELEASE}" = "${EXPECTED_RELEASE}" ]; then
    PROD_OK=true
    ok "Produção rodando o release esperado (release=${PROD_RELEASE})"
    break
  else
    echo "   [${attempt}/${POLL_ATTEMPTS}] release em produção: ${PROD_RELEASE} — aguardando Render... (${POLL_INTERVAL}s)"
  fi
  sleep "${POLL_INTERVAL}"
done

if [ "${PROD_OK}" = "false" ]; then
  fail "Produção não atualizou para o release esperado dentro do timeout"
  echo "   ⚠️  Verifique o dashboard do Render: https://dashboard.render.com"
fi

# ── Resultado final ───────────────────────────────────
echo ""
echo "================================================="
if [ "${FAIL}" -eq 0 ]; then
  echo " ✅ Todos os ${PASS} checks passaram — deploy OK"
else
  echo " ❌ ${FAIL} check(s) falharam, ${PASS} passaram"
  exit 1
fi
echo "================================================="
