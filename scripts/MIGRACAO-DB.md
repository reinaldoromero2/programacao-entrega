# Migração do Banco de Dados — Antes de 31/ago/2026

O banco PostgreSQL gratuito `entrega-db` no Render **expira em 31 de agosto de 2026** e será deletado automaticamente. Este guia explica como migrar para o **Neon** (free tier permanente, sem expiração).

---

## Resumo do processo

```
[Render DB antigo] → pg_dump → backup.sql → psql → [Neon DB novo]
                                                         ↓
                                              Atualizar DATABASE_URL no Render
```

---

## Passo 1 — Criar conta e banco no Neon (gratuito, sem expiração)

1. Acesse [neon.tech](https://neon.tech) e crie uma conta gratuita
2. Clique em **"New Project"**
3. Escolha o nome `programacao-entrega` e região **US East (Ohio)** (para ficarem próximos)
4. Clique em **"Create Project"**
5. Na tela seguinte, copie a **Connection String** (começa com `postgresql://...`)
   - Clique em **"Connection string"** → marque **"Pooled connection"** (recomendado)
   - Copie o valor — este será o `NEW_DB_URL`

---

## Passo 2 — Obter a URL atual do Render

1. Acesse [dashboard.render.com](https://dashboard.render.com)
2. Clique no serviço **programacao-entrega-api**
3. Vá em **Environment** → copie o valor de `DATABASE_URL`
   - Este será o `OLD_DB_URL`

> Alternativamente, acesse o banco diretamente:
> Render Dashboard → **entrega-db** (o banco) → **Connections** → copie o campo **External Database URL**

---

## Passo 3 — Rodar a migração (no terminal do Replit)

```bash
OLD_DB_URL="postgres://usuario:senha@host.render.com/nome_db" \
NEW_DB_URL="postgresql://usuario:senha@ep-xxx.us-east-2.aws.neon.tech/dbname?sslmode=require" \
bash scripts/migrate-db.sh
```

O script vai:
1. Fazer o backup do banco atual (`scripts/backup_YYYYMMDD_HHMMSS.sql`)
2. Criar o schema no Neon via `drizzle push`
3. Restaurar todos os dados
4. Exibir a contagem de registros para confirmação

**Tempo estimado:** 1–2 minutos.

---

## Passo 4 — Atualizar DATABASE_URL no Render

1. Acesse [dashboard.render.com](https://dashboard.render.com)
2. Clique em **programacao-entrega-api** → **Environment**
3. Edite a variável `DATABASE_URL`
4. Cole a URL do Neon (o `NEW_DB_URL` usado no passo 3)
5. Clique em **Save Changes**
6. O Render vai reiniciar o serviço automaticamente

---

## Passo 5 — Verificar que está funcionando

Acesse [data-fill-tool.onrender.com/api/health](https://data-fill-tool.onrender.com/api/health) — deve retornar `{"status":"ok"}`.

Abra o app em [programacao-entrega.vercel.app](https://programacao-entrega.vercel.app) e confirme que as entregas estão aparecendo normalmente.

---

## Comandos individuais (se precisar rodar separado)

### Só o backup:
```bash
OLD_DB_URL="postgres://..." bash scripts/backup-db.sh
# Gera: scripts/backup_YYYYMMDD_HHMMSS.sql
```

### Só a restauração (usando o backup mais recente):
```bash
NEW_DB_URL="postgresql://..." bash scripts/restore-db.sh
```

### Restauração de um arquivo específico:
```bash
NEW_DB_URL="postgresql://..." BACKUP_FILE="scripts/backup_20260810_120000.sql" bash scripts/restore-db.sh
```

---

## Outras opções de provedor (além do Neon)

| Provedor | Free tier | Observação |
|----------|-----------|------------|
| **Neon** | ✅ Permanente | Recomendado — serverless, cold start rápido |
| **Supabase** | ✅ Permanente | Pausa após 1 semana inativo (free) |
| **Railway** | 🟡 $5 crédito/mês | Expira crédito — pode custar algo |
| **Render Paid** | ❌ Pago | US$ 7/mês (evitar se free tier resolve) |

---

## Em caso de problema

Se o script falhar por conflito de schema (tabelas já existem no novo banco):

```bash
# Limpa o schema no novo banco antes de restaurar:
psql "$NEW_DB_URL" -c "DROP TABLE IF EXISTS entregas CASCADE; DROP TABLE IF EXISTS motoristas CASCADE; DROP TABLE IF EXISTS drizzle_migrations CASCADE;"

# Rode o migrate novamente:
OLD_DB_URL="..." NEW_DB_URL="..." bash scripts/migrate-db.sh
```

---

## Arquivos de backup

Backups salvos em `scripts/backup_*.sql` **não são enviados ao GitHub** (estão no `.gitignore` abaixo).
Guarde o arquivo de backup em local seguro (Google Drive, etc.) como precaução adicional.
