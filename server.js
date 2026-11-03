// Chạy local: node --env-file=.env server.js  ->  http://localhost:8088  (trang admin: /admin)
const http = require("http");
const fs = require("fs");
const path = require("path");
const { chat, getKb } = require("./rag.js");
const { adminApi } = require("./store.js");

const PORT = Number(process.env.PORT) || 8088;
const STATIC = { "/": "index.html", "/index.html": "index.html", "/admin": "admin.html", "/admin.html": "admin.html",
  "/bot.js": "bot.js", "/data/knowledge.json": "data/knowledge.json" };
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".json": "application/json; charset=utf-8" };
const MAX_BODY = 3 * 1024 * 1024;

const sendJson = (res, status, data) => res.writeHead(status, { "Content-Type": TYPES[".json"], "Cache-Control": "no-store" }).end(JSON.stringify(data));

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.setEncoding("utf8");
    req.on("data", (c) => { body += c; if (body.length > MAX_BODY) { reject(new Error("Dữ liệu quá lớn")); req.destroy(); } });
    req.on("end", () => resolve(body));
  });
}

http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost");
  try {
    if (url.pathname === "/api/chat" && req.method === "POST") {
      let input;
      try { input = JSON.parse(await readBody(req)); } catch { return sendJson(res, 400, { error: "JSON không hợp lệ" }); }
      return sendJson(res, 200, await chat(input.message, input.history));
    }
    if (url.pathname === "/api/kb") return sendJson(res, 200, await getKb());
    if (url.pathname === "/api/admin") {
      const body = req.method === "POST" ? await readBody(req) : "";
      const r = await adminApi(req.method, body, url.searchParams.get("id"), req.headers["x-admin-password"]);
      return sendJson(res, r.status, r.json);
    }
  } catch (e) {
    console.error(e);
    return sendJson(res, 500, { error: e.message });
  }
  const file = STATIC[url.pathname];
  if (!file) { res.writeHead(404).end("Không tìm thấy"); return; }
  res.writeHead(200, { "Content-Type": TYPES[path.extname(file)] });
  fs.createReadStream(path.join(__dirname, file)).pipe(res);
}).listen(PORT, () => console.log(`Chatbot v2 (LLM + RAG): http://localhost:${PORT}  admin: /admin  key: ${process.env.GEMINI_API_KEY ? "có" : "THIẾU"}  mật khẩu admin: ${process.env.ADMIN_PASSWORD ? "có" : "THIẾU"}`));
