import path from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig(({ mode }) => ({
  // Tailwind is compiled here now. The page used to pull cdn.tailwindcss.com,
  // which is a dev-only tool: ~400 KB of JIT compiler on every page view,
  // render-blocking, and it prints a production warning in the console.
  plugins: [react(), tailwindcss()],

  build: {
    outDir: "dist",
    emptyOutDir: true,
    manifest: true,
    sourcemap: mode !== "production",
    chunkSizeWarningLimit: 900,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes("node_modules")) return;
          if (id.includes("react-router")) return "vendor-router";
          if (id.includes("react-phone-number-input") || id.includes("libphonenumber")) return "vendor-phone";
          if (id.includes("/react/") || id.includes("/react-dom/")) return "vendor-react";
          return "vendor";
        },
      },
    },
  },

  server: {
    port: 5174,
    host: "127.0.0.1",
    proxy: {
      // the CRM/Next backend in this repo
      "/api": { target: "http://127.0.0.1:3000", changeOrigin: true },
      "/storage": { target: "http://127.0.0.1:3000", changeOrigin: true },
    },
  },

  resolve: { alias: { "@": path.resolve(__dirname, "src") } },
}));
