import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, join, resolve, sep } from "node:path";

const root = resolve(process.argv[2] || ".");
const port = Number(process.env.PORT) || 8787;
const mimeTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".txt": "text/plain; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
};

createServer(async (request, response) => {
  const pathname = decodeURIComponent(new URL(request.url, "http://localhost").pathname);
  const requestedPath = resolve(join(root, pathname === "/" ? "index.html" : pathname.slice(1)));
  if (requestedPath !== root && !requestedPath.startsWith(root + sep)) {
    response.writeHead(403).end("Forbidden");
    return;
  }
  try {
    const file = (await stat(requestedPath)).isDirectory() ? join(requestedPath, "index.html") : requestedPath;
    await stat(file);
    response.writeHead(200, {
      "Content-Type": mimeTypes[extname(file)] || "application/octet-stream",
      "Cache-Control": "no-cache",
    });
    createReadStream(file).pipe(response);
  } catch {
    response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" }).end("Not Found");
  }
}).listen(port, "0.0.0.0", () => {
  console.log(`貯金ザウルス: http://localhost:${port} (${root})`);
});
