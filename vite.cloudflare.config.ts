import { cloudflare } from "@cloudflare/vite-plugin";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// Keeps the original Cloudflare Workers deployment available:
//   npm run deploy:cloudflare
export default defineConfig({
  plugins: [cloudflare(), react()],
});
