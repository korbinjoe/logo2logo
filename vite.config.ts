import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";
export default defineConfig({
  plugins: [react()],
  build: {
    outDir: "dist",
    rollupOptions: {
      input: {
        main: resolve("index.html"),
        checkout: resolve("checkout.html"),
        admin: resolve("admin.html"),
      },
    },
  },
  server: { host: "127.0.0.1", fs: { strict: true } },
});
