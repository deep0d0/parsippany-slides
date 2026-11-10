import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// The client is built here and served by the Node server in ./server.
// During development Vite proxies /api (including the WebSocket) to that server.
const api = process.env.API_ORIGIN ?? "http://127.0.0.1:8080";

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      "/api": { target: api, ws: true },
    },
  },
});
