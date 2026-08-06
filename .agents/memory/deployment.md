---
name: Deployment Setup
description: Vercel + Render deployment config, repos, and deploy workflow for Programação de Entrega
---

## Repos
- **Source (Replit pushes here)**: `reinaldoromero02/Data-Fill-Tool` (with zero)
  - ⚠️ `gitPush` tool returns success but does NOT actually reach remote (auth mismatch). Do NOT rely on it.
- **Mirror (Vercel + Render pull from here)**: `reinaldoromero2/programacao-entrega` (without zero)
  - Updated via `GITHUB_PERSONAL_ACCESS_TOKEN` (for `reinaldoromero2` account)

## Standard deploy workflow (one command)

```bash
bash scripts/deploy.sh
```

This script: (1) builds API dist via esbuild, (2) commits all changes locally with `git config user.email/name` set inline (required in Replit — identity not configured globally), (3) force-pushes local `main` to the mirror using PAT.

**Why force-push:** Mirror's commit history diverged from local because earlier syncs used GitHub API blobs (different SHAs). `--force` is safe here since mirror is a deploy-only target.

## Services
- **Vercel**: `programacao-entrega.vercel.app` — auto-deploys on mirror push
- **Render**: `https://data-fill-tool.onrender.com` — service ID `srv-d9n4levlk1mc73dns1n0`
  - Connected to mirror repo `reinaldoromero2/programacao-entrega`
  - Build: `pnpm install` (uses pre-built `artifacts/api-server/dist/index.mjs`)
  - Start: `node --enable-source-maps artifacts/api-server/dist/index.mjs`
  - Auto-deploy: yes (triggers on mirror push)
  - Manual trigger: `curl -X POST -H "Authorization: Bearer $RENDER_API_KEY" https://api.render.com/v1/services/srv-d9n4levlk1mc73dns1n0/deploys -d '{"clearCache":"do_not_clear"}'`

## DB
- **Render Postgres**: `entrega-db` (free tier, **expires Aug 31 2026** — migrate to Neon before then)

## Why mirror uses pre-built dist
Render's TypeScript build was using a cached/old compiled output. Pre-committing `artifacts/api-server/dist/index.mjs` and using `pnpm install` (no compile) as build command ensures Render always runs the exact binary we tested.

**Why:** gitPush fails silently → source repo stuck at old commit → Render compiled old TypeScript → wrong behavior. Committing dist to mirror + `pnpm install` build command bypasses the unreliable compile step.
