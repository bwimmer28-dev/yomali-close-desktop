import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";

/**
 * Vite config for Electron renderer (web/).
 *
 * Key points:
 * - base: "./"  → ensures assets resolve when loaded via file:// in packaged Electron apps
 * - server.proxy → allows calling /api/* in dev, forwarding to FastAPI on :8000
 * - define/global shims → helps avoid "process is not defined" / "global is not defined"
 *   when dependencies reference Node-ish globals in the browser renderer bundle.
 */
export default defineConfig(({ mode }) => ({
  plugins: [react()],

  // IMPORTANT for Electron packaged builds (file://)
  base: "./",

  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },

  // Helpful shims for some deps that assume Node-style globals.
  define: {
    "process.env.NODE_ENV": JSON.stringify(mode),
    global: "globalThis",
  },

  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      "/api": {
        target: "http://127.0.0.1:8000",
        changeOrigin: true,
      },
    },
  },

  build: {
    outDir: "dist",
    emptyOutDir: true,

    // Turn this on while you're diagnosing the "blank window" issue.
    // You can set back to false later if you prefer smaller artifacts.
    sourcemap: true,
  },
}));
