// Tiny static file server (no dependencies). Used by `npm run dev` and `npm run preview`.
import { createServer } from "node:http";
import { existsSync, readFileSync, statSync } from "node:fs";
import { extname, join, normalize } from "node:path";

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
};

/**
 * @param {string[]} roots directories searched in order
 * @param {Record<string, () => string>} dynamic routes generated per request
 */
export function serve(roots, port = 5173, dynamic = {}) {
  const server = createServer((req, res) => {
    const url = decodeURIComponent((req.url ?? "/").split("?")[0]);
    if (dynamic[url]) {
      try {
        res.writeHead(200, { "content-type": TYPES[".json"], "cache-control": "no-store" });
        res.end(dynamic[url]());
      } catch (e) {
        res.writeHead(500);
        res.end(String(e));
      }
      return;
    }
    const rel = normalize(url === "/" ? "/index.html" : url).replace(/^(\.\.[/\\])+/, "");
    for (const r of roots) {
      const file = join(r, rel);
      if (file.startsWith(r) && existsSync(file) && statSync(file).isFile()) {
        res.writeHead(200, { "content-type": TYPES[extname(file)] ?? "application/octet-stream", "cache-control": "no-store" });
        res.end(readFileSync(file));
        return;
      }
    }
    res.writeHead(404);
    res.end("Not found");
  });
  server.listen(port, () => console.log(`Ash Ledger running at http://localhost:${port}`));
  return server;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const dir = process.argv[2] ?? "dist";
  serve([join(process.cwd(), dir)], Number(process.env.PORT ?? 4173));
}
