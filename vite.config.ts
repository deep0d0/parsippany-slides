import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

/**
 * pptx-browser 4.1.5 has two canvas-renderer text bugs: it reads `defRPr`
 * before its const declaration, and it passes an already-CSS run colour back
 * through colorToCss, which leaves the previous fillStyle in place. Both skip
 * or hide text in rasterized slides. Keep the fixes local until the package
 * ships them upstream.
 */
const fixPptxBrowserDefRPr = {
  name: "fix-pptx-browser-defrpr",
  enforce: "pre" as const,
  transform(code: string, id: string) {
    if (!id.replace(/\\/g, "/").includes("node_modules/pptx-browser/src/render.js")) return null;
    const fixes: [string, string][] = [
      [
        "const bullet = pPr ? parseBullet(pPr, defRPr, themeColors, themeData) : null;",
        "const bullet = pPr ? parseBullet(pPr, g1(pPr, 'defRPr'), themeColors, themeData) : null;",
      ],
      ["ctx.fillStyle = c ? colorToCss(c) : '#000000';", "ctx.fillStyle = c || '#000000';"],
    ];
    let fixed = code;
    for (const [broken, replacement] of fixes) fixed = fixed.replace(broken, replacement);
    if (fixed === code) return null;
    return {
      code: fixed,
      map: null,
    };
  },
};

// The client is built here and served by the Node server in ./server.
// During development Vite proxies /api (including the WebSocket) to that server.
const api = process.env.API_ORIGIN ?? "http://127.0.0.1:8080";

export default defineConfig({
  plugins: [fixPptxBrowserDefRPr, react()],
  optimizeDeps: {
    exclude: ["pptx-browser"],
  },
  server: {
    proxy: {
      "/api": { target: api, ws: true },
    },
  },
});
