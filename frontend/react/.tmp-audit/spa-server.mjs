import http from "node:http";
import { readFile, stat } from "node:fs/promises";
import { join, extname } from "node:path";

const ROOT = "C:/Users/D/fantasygrinder/frontend/react/dist";
const TYPES = { ".html":"text/html", ".js":"text/javascript", ".css":"text/css", ".json":"application/json",
  ".png":"image/png", ".jpg":"image/jpeg", ".svg":"image/svg+xml", ".ico":"image/x-icon", ".woff2":"font/woff2" };

http.createServer(async (req, res) => {
  let p = decodeURIComponent(req.url.split("?")[0]);
  let file = join(ROOT, p);
  try {
    const s = await stat(file);
    if (s.isDirectory()) file = join(file, "index.html");
  } catch {
    file = join(ROOT, "index.html");
  }
  try {
    const buf = await readFile(file);
    res.writeHead(200, { "Content-Type": TYPES[extname(file)] ?? "application/octet-stream" });
    res.end(buf);
  } catch {
    res.writeHead(404); res.end("not found");
  }
}).listen(4181, () => console.log("spa server on 4181"));