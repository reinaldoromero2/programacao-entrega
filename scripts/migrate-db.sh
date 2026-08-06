#!/usr/bin/env bash
# Migração completa: exporta do banco atual e importa no novo banco.
#
# Uso:
#   OLD_DB_URL="postgres://..." NEW_DB_URL="postgres://..." bash scripts/migrate-db.sh
#
# Variáveis:
#   OLD_DB_URL  — URL do banco atual no Render (expira 31/ago/2026)
#   NEW_DB_URL  — URL do novo banco (Neon, Supabase, Railway, etc.)

set -euo pipefail

OLD_DB_URL="${OLD_DB_URL:-}"
NEW_DB_URL="${NEW_DB_URL:-}"

if [ -z "$OLD_DB_URL" ] || [ -z "$NEW_DB_URL" ]; then
  echo "❌  Defina OLD_DB_URL e NEW_DB_URL."
  echo ""
  echo "  OLD_DB_URL='postgres://user:pass@host/old_db' \\"
  echo "  NEW_DB_URL='postgres://user:pass@ep-xxx.neon.tech/new_db?sslmode=require' \\"
  echo "  bash scripts/migrate-db.sh"
  exit 1
fi

TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_FILE="scripts/backup_${TIMESTAMP}.sql"

echo "============================================"
echo "  Migração do Banco de Dados"
echo "============================================"
echo ""

# ── 1. Backup ───────────────────────────────────
echo "1️⃣  Exportando banco atual..."
pg_dump \
  --no-owner \
  --no-privileges \
  --format=plain \
  --encoding=UTF8 \
  "$OLD_DB_URL" \
  > "$BACKUP_FILE"
echo "   ✅ Backup salvo em: $BACKUP_FILE"
echo ""

# ── 2. Criar schema no novo banco ───────────────
echo "2️⃣  Criando schema no novo banco (drizzle push)..."
DATABASE_URL="$NEW_DB_URL" pnpm --filter @workspace/db push-force
echo "   ✅ Schema criado."
echo ""

# ── 3. Restaurar dados ──────────────────────────
echo "3️⃣  Restaurando dados..."
# Extrair somente os INSERTs (pular CREATE TABLE já feitos pelo drizzle)
psql "$NEW_DB_URL" \
  --set ON_ERROR_STOP=1 \
  --quiet \
  < "$BACKUP_FILE"
echo "   ✅ Dados restaurados."
echo ""

# ── 4. Verificação rápida ────────────────────────
echo "4️⃣  Verificação rápida..."
ENTREGAS=$(psql "$NEW_DB_URL" -t -c "SELECT COUNT(*) FROM entregas;" 2>/dev/null | tr -d ' ')
MOTORISTAS=$(psql "$NEW_DB_URL" -t -c "SELECT COUNT(*) FROM motoristas;" 2>/dev/null | tr -d ' ')
echo "   📦 entregas:   $ENTREGAS registros"
echo "   🚗 motoristas: $MOTORISTAS registros"
echo ""

echo "============================================"
echo "  ✅ Migração concluída com sucesso!"
echo "============================================"
echo ""
echo "Próximo passo OBRIGATÓRIO:"
echo "  Atualize DATABASE_URL no Render:"
echo "  https://dashboard.render.com → programacao-entrega-api"
echo "  → Environment → DATABASE_URL → cole a URL do novo banco"
echo ""
echo "  Nova URL: $NEW_DB_URL"
