#!/usr/bin/env bash
# Restaura um backup .sql para um novo banco de dados (Neon, Supabase, Railway…).
# Uso: NEW_DB_URL="postgres://..." BACKUP_FILE="scripts/backup_YYYYMMDD_HHMMSS.sql" bash scripts/restore-db.sh
set -euo pipefail

NEW_DB_URL="${NEW_DB_URL:-}"
BACKUP_FILE="${BACKUP_FILE:-}"

if [ -z "$NEW_DB_URL" ]; then
  echo "❌  Defina NEW_DB_URL com a URL do novo banco."
  echo "    Exemplo: NEW_DB_URL='postgres://user:pass@ep-xxx.neon.tech/dbname?sslmode=require' \\"
  echo "             BACKUP_FILE='scripts/backup_20260810_120000.sql' \\"
  echo "             bash scripts/restore-db.sh"
  exit 1
fi

if [ -z "$BACKUP_FILE" ]; then
  # Usa o backup mais recente automaticamente
  BACKUP_FILE=$(ls -t scripts/backup_*.sql 2>/dev/null | head -1)
  if [ -z "$BACKUP_FILE" ]; then
    echo "❌  Nenhum arquivo de backup encontrado. Rode backup-db.sh primeiro."
    exit 1
  fi
  echo "ℹ️   Usando backup mais recente: $BACKUP_FILE"
fi

if [ ! -f "$BACKUP_FILE" ]; then
  echo "❌  Arquivo não encontrado: $BACKUP_FILE"
  exit 1
fi

echo "🚀  Restaurando dados para o novo banco..."
echo "    Arquivo: $BACKUP_FILE"

psql "$NEW_DB_URL" \
  --set ON_ERROR_STOP=1 \
  --quiet \
  < "$BACKUP_FILE"

echo "✅  Restauração concluída!"
echo ""
echo "Próximo passo: atualize DATABASE_URL no Render:"
echo "  Render Dashboard → programacao-entrega-api → Environment → DATABASE_URL"
