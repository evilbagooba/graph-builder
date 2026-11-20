import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// A static app: no server of its own. Projects come from the tako hub
// (http://localhost:4100) when it's running, or from a file when it isn't.
// base "./" so the built page works from any static host or subpath.
export default defineConfig({
  root: "client",
  base: "./",
  publicDir: "../public",
  plugins: [react(), tailwindcss()],
  server: { fs: { allow: [".."] } },
  build: { outDir: "dist", emptyOutDir: true },
});
