# Programação de Entrega

A daily logistics delivery scheduling app ("Controle Logístico Diário") built in Portuguese.

## Stack

- **Frontend**: React + Vite + Tailwind CSS v4 + shadcn/ui (`artifacts/programacao-entrega`)
- **API**: Express 5 + TypeScript, built with esbuild (`artifacts/api-server`)
- **Database**: PostgreSQL via Drizzle ORM (`lib/db`)
- **Shared libs**: `lib/api-spec` (OpenAPI), `lib/api-zod` (Zod schemas), `lib/api-client-react` (React Query hooks)
- **Package manager**: pnpm workspace

## How to run

All workflows are configured and start automatically:

| Workflow | Command |
|---|---|
| `artifacts/programacao-entrega: web` | `pnpm --filter @workspace/programacao-entrega run dev` |
| `artifacts/api-server: API Server` | `pnpm --filter @workspace/api-server run dev` |

## Database

Uses Replit's built-in PostgreSQL. Schema is managed with Drizzle Kit.

- Push schema changes: `cd lib/db && pnpm run push`
- Tables: `entregas` (deliveries), `motoristas` (drivers)

## Deploy para produção

Um único comando faz tudo: build → commit → push para mirror → Render auto-deploya.

```bash
bash scripts/deploy.sh
```

Requer `GITHUB_PERSONAL_ACCESS_TOKEN` no Replit Secrets (conta `reinaldoromero2`).

**Nota:** `gitPush` do Replit **não funciona** para o repo fonte (`reinaldoromero02/Data-Fill-Tool`) por incompatibilidade de credencial. Sempre use `scripts/deploy.sh`.

### Verificar o deploy

`deploy.sh` executa o smoke test automaticamente ao final. Para rodar manualmente:

```bash
bash scripts/check-deploy.sh <release-id>
```

O smoke test verifica:
1. **Build output** — `artifacts/api-server/dist/index.mjs` existe e não está vazio
2. **Mirror sincronizado** — SHA do GitHub mirror bate com o HEAD local
3. **Revisão correta em produção** — `/api/healthz` reporta o `release` exato desta build (polling por até 6 min)

### Serviços em produção
- **Render** (API + frontend): https://data-fill-tool.onrender.com
- **Vercel** (frontend): https://programacao-entrega.vercel.app
- **Mirror repo**: `reinaldoromero2/programacao-entrega` (alvo do deploy)

## Key environment variables

- `DATABASE_URL` — provided automatically by Replit
- `SESSION_SECRET` — set in Replit Secrets
- `PORT` — set per-artifact by Replit
- `GITHUB_PERSONAL_ACCESS_TOKEN` — PAT da conta `reinaldoromero2`, usado por `deploy.sh`

## User preferences

_(none recorded yet)_
