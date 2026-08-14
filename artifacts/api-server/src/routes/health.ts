import { Router, type IRouter } from "express";
import { HealthCheckResponse } from "@workspace/api-zod";
import { pool } from "@workspace/db";

// Injected at build time by esbuild define; see build.mjs.
// In production deploys set by deploy.sh via DEPLOY_RELEASE_ID env var.
// In local dev builds falls back to "dev-<short-sha>".
declare const __BUILD_RELEASE__: string;

const router: IRouter = Router();

router.get("/healthz", async (_req, res) => {
  let db: "ok" | "error" = "error";
  try {
    const client = await pool.connect();
    try {
      await client.query("SELECT 1");
      db = "ok";
    } finally {
      client.release();
    }
  } catch {
    // db stays "error"
  }

  const status = db === "ok" ? "ok" : "degraded";
  const data = HealthCheckResponse.parse({ status });
  const httpStatus = db === "ok" ? 200 : 503;

  res.status(httpStatus).json({ ...data, db, release: __BUILD_RELEASE__ });
});

export default router;
