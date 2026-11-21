// Minimal dependency-free static file server for web/.
// Serves web/ on PORT (default 8080); the Makefile / run-tests.sh manage
// its lifecycle during test runs.

import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../web/", import.meta.url));
const port = Number(process.env.PORT ?? 8080);

const contentTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
};

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? "/", "http://localhost");
    let pathname = decodeURIComponent(url.pathname);
    if (pathname === "/") pathname = "/index.html";

    const file = normalize(join(root, pathname));
    if (!file.startsWith(root)) {
      res.writeHead(403, { "content-type": "text/plain" });
      res.end("forbidden");
      return;
    }

    const data = await readFile(file);
    res.writeHead(200, {
      "content-type": contentTypes[extname(file)] ?? "application/octet-stream",
    });
    res.end(data);
  } catch {
    // Real 404: the spec's noHttpErrorCodes property would catch any
    // unexpected request the app causes.
    res.writeHead(404, { "content-type": "text/plain" });
    res.end("not found");
  }
});

server.listen(port, () => {
  console.log(`serving web/ at http://localhost:${port}`);
});
