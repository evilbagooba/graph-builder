import { fileURLToPath } from "node:url";
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

/** In dev, serve POST /actions from the server code, hot-reloaded by Vite. */
function actionsDevServer(): Plugin {
  return {
    name: "graph-builder-actions",
    configureServer(server) {
      const entry = fileURLToPath(new URL("./server/src/http.ts", import.meta.url));
      server.middlewares.use("/actions", async (req, res) => {
        try {
          const mod = (await server.ssrLoadModule(entry)) as typeof import("./server/src/http");
          await mod.handleActions(req, res);
        } catch (e) {
          // Keep the dev server alive when server code fails to load.
          server.config.logger.error(`[actions] ${e instanceof Error ? e.stack : String(e)}`);
          if (!res.headersSent) {
            res.statusCode = 500;
            res.setHeader("content-type", "application/json");
            res.end(JSON.stringify({ ok: false, error: "Server code failed to load — see the terminal." }));
          }
        }
      });
    },
  };
}

export default defineConfig({
  root: "client",
  publicDir: "../public",
  plugins: [react(), tailwindcss(), actionsDevServer()],
  server: { fs: { allow: [".."] } },
  build: { outDir: "dist", emptyOutDir: true },
});
