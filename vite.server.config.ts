import { defineConfig } from "vite";

// Bundles server/index.ts and its TypeScript imports into dist-server/index.mjs.
export default defineConfig({
  publicDir: false,
  build: {
    ssr: "server/index.ts",
    outDir: "dist-server",
    emptyOutDir: true,
    target: "node20",
    rollupOptions: {
      output: { format: "esm", entryFileNames: "index.mjs" },
    },
  },
});
