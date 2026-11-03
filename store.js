// Dữ liệu upload từ trang admin: lưu ở Netlify Blobs khi chạy trên Netlify, file data/uploads.json khi chạy local.
// Mỗi "nguồn" (1 file upload) gồm các đoạn tài liệu (RAG) và/hoặc các cặp hỏi–đáp (dữ liệu huấn luyện).
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const vectors = require("./vectors.js");

const LOCAL = process.env.UPLOADS_FILE || path.join(__dirname, "data", "uploads.json");
const KEY = "sources";
const LIMITS = { name: 200, title: 200, text: 4000, pattern: 300, patterns: 20, answer: 4000, items: 3000 };

async function blobStore() {
  try {
    const { getStore } = await import("@netlify/blobs");
    return getStore({ name: "tuyensinh", consistency: "strong" });
  } catch {
    return null; // không chạy trên Netlify -> dùng file local
  }
}

async function loadSources() {
  const store = await blobStore();
  if (store) return (await store.get(KEY, { type: "json" })) || [];
  try { return JSON.parse(fs.readFileSync(LOCAL, "utf8")); } catch { return []; }
}

async function saveSources(list) {
  const store = await blobStore();
  if (store) return store.setJSON(KEY, list);
  fs.writeFileSync(LOCAL, JSON.stringify(list, null, 2));
}

function mergeKb(base, sources) {
  return {
    ...base,
    intents: base.intents.concat(sources.flatMap((s) => s.intents)),
    documents: (base.documents || []).concat(sources.flatMap((s) => s.documents)),
  };
}

const str = (v, max) => (typeof v === "string" ? v.trim().slice(0, max) : "");

// Làm sạch dữ liệu từ trình duyệt gửi lên trước khi lưu (không tin dữ liệu phía client).
function sanitize(input) {
  const id = Date.now().toString(36) + crypto.randomBytes(3).toString("hex");
  const name = str(input && input.name, LIMITS.name) || "Tài liệu không tên";
  const source = `Tài liệu upload: ${name}`;
  const documents = (Array.isArray(input && input.documents) ? input.documents : []).slice(0, LIMITS.items)
    .map((d, i) => ({ id: `${id}-${i}`, title: str(d && d.title, LIMITS.title) || name, source, text: str(d && d.text, LIMITS.text) }))
    .filter((d) => d.text);
  const intents = (Array.isArray(input && input.intents) ? input.intents : []).slice(0, LIMITS.items)
    .map((it, i) => ({
      tag: `up_${id}_${i}`,
      patterns: (Array.isArray(it && it.patterns) ? it.patterns : []).map((p) => str(p, LIMITS.pattern)).filter(Boolean).slice(0, LIMITS.patterns),
      answer: str(it && it.answer, LIMITS.answer),
      source,
    }))
    .filter((it) => it.patterns.length && it.answer);
  return { id, name, type: str(input && input.type, 20), addedAt: new Date().toISOString(), documents, intents };
}

const summary = (s) => ({ id: s.id, name: s.name, type: s.type, addedAt: s.addedAt, documents: s.documents.length, intents: s.intents.length });

function samePassword(a, b) {
  const h = (s) => crypto.createHash("sha256").update(String(s)).digest();
  return crypto.timingSafeEqual(h(a), h(b));
}

// API quản trị dùng chung cho server local và Netlify Function.
async function adminApi(method, body, id, password) {
  const expected = process.env.ADMIN_PASSWORD;
  if (!expected) return { status: 503, json: { error: "Server chưa cấu hình ADMIN_PASSWORD" } };
  if (!samePassword(password || "", expected)) return { status: 401, json: { error: "Sai mật khẩu quản trị" } };
  const list = await loadSources();
  // GET ?id=stats: thống kê Vector DB cho trang admin (id thật là chuỗi ngẫu nhiên nên không trùng).
  if (method === "GET" && id === "stats") return { status: 200, json: await vectors.stats().catch((e) => ({ enabled: false, error: e.message })) };
  if (method === "GET") return { status: 200, json: list.map(summary) };
  if (method === "POST") {
    let input;
    try { input = JSON.parse(body); } catch { return { status: 400, json: { error: "Dữ liệu gửi lên không hợp lệ" } }; }
    const src = sanitize(input);
    if (!src.documents.length && !src.intents.length) return { status: 400, json: { error: "File không có nội dung dùng được" } };
    list.push(src);
    await saveSources(list);
    // Giai đoạn 1 của RAG: chunk -> embedding -> lưu Vector DB. Lỗi thì vẫn giữ tài liệu (bot tra bằng TF-IDF).
    try {
      const n = await vectors.indexChunks(vectors.toChunks(src.id, src.documents, src.intents));
      return { status: 200, json: { ...summary(src), vectors: n } };
    } catch (e) {
      console.error("Không nhúng được vector:", e.message);
      return { status: 200, json: { ...summary(src), vectors: 0, warning: "Đã lưu tài liệu nhưng chưa tạo được vector: " + e.message } };
    }
  }
  if (method === "DELETE") {
    const next = list.filter((s) => s.id !== id);
    if (next.length === list.length) return { status: 404, json: { error: "Không tìm thấy tài liệu" } };
    await saveSources(next);
    await vectors.deleteSource(id).catch((e) => console.error("Không xóa được vector:", e.message));
    return { status: 200, json: { ok: true } };
  }
  return { status: 405, json: { error: "Phương thức không hỗ trợ" } };
}

module.exports = { loadSources, saveSources, mergeKb, sanitize, adminApi };
