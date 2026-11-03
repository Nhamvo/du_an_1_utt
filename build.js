// Đóng gói thành 1 file dist/index.html (nhúng bot.js + knowledge.json) để host tĩnh hoặc mở trực tiếp.
// Chạy: node build.js
const fs = require("fs");
const kb = JSON.parse(fs.readFileSync(__dirname + "/data/knowledge.json", "utf8"));
const safe = (s) => s.replace(/<\/script/gi, "<\\/script");
const html = fs.readFileSync(__dirname + "/index.html", "utf8").replace(
  '<script src="bot.js"></script>',
  () => `<script>window.KB = ${JSON.stringify(kb).replace(/</g, "\\u003c")};</script>\n` +
    `<script>${safe(fs.readFileSync(__dirname + "/bot.js", "utf8"))}</script>`);
if (!html.includes("window.KB =")) throw new Error("Không tìm thấy thẻ <script src=\"bot.js\"> trong index.html");
fs.mkdirSync(__dirname + "/dist", { recursive: true });
fs.writeFileSync(__dirname + "/dist/index.html", html);
fs.copyFileSync(__dirname + "/admin.html", __dirname + "/dist/admin.html");
console.log("Đã tạo dist/index.html", (html.length / 1024).toFixed(1) + " KB", "+ dist/admin.html");
