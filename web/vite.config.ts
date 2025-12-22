import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  base: "./", // <-- CRITICAL for Electron (relative asset paths)
  server: {
    port: 5173,
  },
});
