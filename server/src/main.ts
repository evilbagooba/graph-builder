// Production server: serves the built client from client/dist and the
// actions endpoint. Run `npm run build` first, then `npm start`.

import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { handleActions } from "./http";
import { getDb } from "./db";

const DIST = path.resolve(import.meta.dirname, "../../client/dist");
const PORT = Number(process.env.PORT ?? 3000);

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript",
  ".css": "text/css",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".json": "application/json",
  ".woff2": "font/woff2",
};

getDb(); // open + migrate up front so a bad setup fails at boot

createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", "http://localhost");
  if (url.pathname === "/actions") return handleActions(req, res);

  const rel = path.normalize(decodeURIComponent(url.pathname)).replace(/^([/\\])+/, "");
  let file = path.join(DIST, rel);
  if (!file.startsWith(DIST)) {
    res.statusCode = 403;
    return res.end();
  }
  try {
    let body: Buffer;
    try {
      body = await readFile(file);
    } catch {
      file = path.join(DIST, "index.html");
      body = await readFile(file);
    }
    res.setHeader("content-type", TYPES[path.extname(file)] ?? "application/octet-stream");
    res.end(body);
  } catch {
    res.statusCode = 500;
    res.end("Client not built — run `npm run build` first.");
  }
}).listen(PORT, () => {
  console.log(`Graph Builder running at http://localhost:${PORT}`);
});
