import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
    port: 5173,
    proxy: {
      "/api": {
        target: "http://localhost:4000",
        changeOrigin: true,
      },
    },
  },
  /** If you `vite preview` locally without `VITE_API_URL`, proxy `/api` to the dev server. */
  preview: {
    host: "0.0.0.0",
    port: (() => {
      const n = Number.parseInt(process.env.PORT ?? "4173", 10);
      return Number.isFinite(n) && n > 0 ? n : 4173;
    })(),
    strictPort: true,
    proxy: {
      "/api": {
        target: "http://localhost:4000",
        changeOrigin: true,
      },
    },
  },
});
