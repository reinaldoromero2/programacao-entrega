import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";
import runtimeErrorOverlay from "@replit/vite-plugin-runtime-error-modal";
import { VitePWA } from "vite-plugin-pwa";
import { readFileSync } from "fs";

const appVersion = JSON.parse(
  readFileSync(path.resolve(__dirname, "../../package.json"), "utf-8")
).version as string;
const appDisplayVersion = appVersion.replace(/\.0$/, "");

export default defineConfig({
  base: './',
  define: {
    "import.meta.env.VITE_APP_VERSION": JSON.stringify(appDisplayVersion),
  },
  build: {
    outDir: path.resolve(__dirname, '../../dist'),
    emptyOutDir: true,
  },
  plugins: [
    react(),
    tailwindcss(),
    runtimeErrorOverlay(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["favicon.svg", "icon-192.svg", "icon-512.svg"],
      workbox: {
        // o Romaneio é outra página (public/romaneio): não pode cair na tela da Programação
        navigateFallbackDenylist: [/^\/romaneio/],
      },
      manifest: {
        name: "Programação de Entrega",
        short_name: "Prog. Entrega",
        description: "Controle logístico diário de programação de entrega",
        theme_color: "#ffffff",
        background_color: "#ffffff",
        display: "standalone",
        icons: [
          { src: "icon-192.svg", sizes: "192x192", type: "image/svg+xml" },
          { src: "icon-512.svg", sizes: "512x512", type: "image/svg+xml" }
        ]
      }
    })
  ],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src")
    }
  }
});