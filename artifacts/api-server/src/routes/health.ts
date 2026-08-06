import { Router, type IRouter } from "express";
import { HealthCheckResponse } from "@workspace/api-zod";

// Injected at build time by esbuild define; see build.mjs.
// In production deploys set by deploy.sh via DEPLOY_RELEASE_ID env var.
// In local dev builds falls back to "dev-<short-sha>".
declare const __BUILD_RELEASE__: string;

const router: IRouter = Router();

router.get("/healthz", (_req, res) => {
  const data = HealthCheckResponse.parse({ status: "ok" });
  res.json({ ...data, release: __BUILD_RELEASE__ });
});

export default router;
