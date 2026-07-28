const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");

const fixturePath = process.argv[2];
const port = Number(process.argv[3] || 4173);
if (!fixturePath) throw new Error("usage: preview-server.cjs <snapshot.json> [port]");

const root = path.resolve(__dirname, "..");
const mime = { ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".json": "application/json; charset=utf-8" };

http.createServer((request, response) => {
  const pathname = new URL(request.url, "http://localhost").pathname;
  if (pathname === "/__fixture") {
    response.writeHead(200, { "Content-Type": mime[".json"], "Cache-Control": "no-store" });
    fs.createReadStream(fixturePath).pipe(response);
    return;
  }
  const relative = pathname === "/" ? "dashboard.html" : decodeURIComponent(pathname).replace(/^\/+/, "");
  const filename = path.resolve(root, relative);
  if (!filename.startsWith(`${root}${path.sep}`) || !fs.existsSync(filename) || !fs.statSync(filename).isFile()) {
    response.writeHead(404).end("not found");
    return;
  }
  response.writeHead(200, { "Content-Type": mime[path.extname(filename)] || "application/octet-stream", "Cache-Control": "no-store" });
  fs.createReadStream(filename).pipe(response);
}).listen(port, "127.0.0.1", () => console.log(`preview server: http://127.0.0.1:${port}`));
