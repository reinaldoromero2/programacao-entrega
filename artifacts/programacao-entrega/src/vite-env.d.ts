/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Base URL of the Render API server (e.g. https://my-api.onrender.com).
   *  Set this in Vercel environment variables so the frontend points to the
   *  correct backend. When absent the frontend uses relative /api paths
   *  (works in Replit and when frontend+backend are served together). */
  readonly VITE_API_URL?: string;
  readonly VITE_APP_VERSION: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
