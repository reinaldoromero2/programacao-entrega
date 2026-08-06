#!/usr/bin/env bash
# Exporta o banco atual do Render para um arquivo .sql local.
# Uso: OLD_DB_URL="postgres://..." bash scripts/backup-db.sh
set -euo pipefail

OLD_DB_URL="${OLD_DB_URL:-${DATABASE_URL:-}}"

if [ -z "$OLD_DB_URL" ]; then
  echo "❌  Defina OLD_DB_URL (ou DATABASE_URL) com a URL do banco atual do Render."
  echo "    Exemplo: OLD_DB_URL='postgres://user:pass@host/dbname' bash scripts/backup-db.sh"
  exit 1
fi

TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_FILE="scripts/backup_${TIMESTAMP}.sql"

echo "📦  Exportando banco de dados..."
echo "    Destino: $BACKUP_FILE"

pg_dump \
  --no-owner \
  --no-privileges \
  --format=plain \
  --encoding=UTF8 \
  "$OLD_DB_URL" \
  > "$BACKUP_FILE"

echo "✅  Backup concluído: $BACKUP_FILE"
echo "    Guarde este arquivo em local seguro antes de 31/ago/2026."
