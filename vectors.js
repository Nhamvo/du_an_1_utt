// Embedding + Vector database cho RAG.
//   Embedding: Gemini gemini-embedding-001 (768 chiều) biến văn bản thành vector theo NGHĨA.
//   Vector DB: PostgreSQL + pgvector (Netlify Database) lưu vector, tìm Top-k đoạn gần nghĩa nhất (cosine).
// Dữ liệu đã nhúng sẵn được lưu trong Git (data/vectors.json, data/vectors.sql, tạo bằng `npm run vectors`):
//   - Có database: nạp thẳng vector từ file vào Vector DB, không phải gọi Gemini nhúng lại.
//   - Không có database (chạy local): dùng chính file đó làm vector store trong bộ nhớ.
// Không có cả hai -> các hàm trả null, rag.js quay về tìm bằng TF-IDF.
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const EMBED_MODEL = process.env.EMBED_MODEL || "gemini-embedding-001";
const DIMS = 768;
const BATCH = 100; // giới hạn số đoạn mỗi lần gọi batchEmbedContents

// Kết nối Netlify Database (PostgreSQL do Neon cung cấp) qua HTTP: gửi câu SQL tới endpoint /sql của Neon
// (cách driver @neondatabase/serverless làm), chỉ cần fetch nên không phải đóng gói thêm thư viện.
// Chuỗi kết nối NETLIFY_DB_URL do Netlify cấp lúc chạy (có thể đổi định kỳ nên đọc lại mỗi lần).
const dbUrl = () => globalThis.Netlify?.env?.get("NETLIFY_DB_URL") || process.env.NETLIFY_DB_URL || process.env.DATABASE_URL;
let poolError = "";
let schemaReady;

async function runSql(url, query, params) {
  const host = new URL(url).hostname.replace(/^[^.]+\./, "api.");
  const res = await fetch(`https://${host}/sql`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Neon-Connection-String": url, "Neon-Raw-Text-Output": "true", "Neon-Array-Mode": "true" },
    body: JSON.stringify({ query, params }),
    signal: AbortSignal.timeout(20000),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error("Database lỗi: " + (data.message || "HTTP " + res.status));
  const names = (data.fields || []).map((f) => f.name);
  return (data.rows || []).map((r) => Object.fromEntries(names.map((n, i) => [n, r[i]])));
}

function getPool() {
  const url = dbUrl();
  if (!url) { poolError = "Chưa có NETLIFY_DB_URL (Netlify Database chưa bật)"; return null; }
  return { query: async (text, params = []) => ({ rows: await runSql(url, text, params) }) };
}

async function ensureSchema(db) {
  schemaReady ??= (async () => {
    await db.query("CREATE EXTENSION IF NOT EXISTS vector");
    await db.query(`CREATE TABLE IF NOT EXISTS chunks (
      id TEXT PRIMARY KEY,
      source_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      title TEXT NOT NULL,
      source TEXT NOT NULL,
      content TEXT NOT NULL,
      embedding vector(${DIMS}) NOT NULL)`);
    await db.query("CREATE INDEX IF NOT EXISTS chunks_embedding_idx ON chunks USING hnsw (embedding vector_cosine_ops)");
    await db.query("CREATE INDEX IF NOT EXISTS chunks_source_idx ON chunks (source_id)");
    await db.query("CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)");
  })().catch((e) => { schemaReady = undefined; throw e; });
  return schemaReady;
}

// Gemini trả vector đã cắt còn 768 chiều -> chuẩn hóa độ dài về 1 để so cosine chính xác.
const normalize = (v) => { const n = Math.hypot(...v) || 1; return v.map((x) => x / n); };
const toSql = (v) => `[${v.join(",")}]`;

async function embed(texts, taskType) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error("Thiếu GEMINI_API_KEY");
  const out = [];
  for (let i = 0; i < texts.length; i += BATCH) {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${EMBED_MODEL}:batchEmbedContents`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": key },
      body: JSON.stringify({ requests: texts.slice(i, i + BATCH).map((text) => ({
        model: `models/${EMBED_MODEL}`, content: { parts: [{ text }] }, taskType, outputDimensionality: DIMS })) }),
      signal: AbortSignal.timeout(30000),
    });
    const data = await res.json();
    if (!res.ok) throw new Error("Embedding lỗi: " + (data.error?.message || res.status));
    out.push(...data.embeddings.map((e) => normalize(e.values)));
  }
  return out;
}

// Đổi dữ liệu tri thức (đoạn tài liệu + cặp hỏi–đáp) thành các "chunk" để nhúng vector.
function toChunks(sourceId, documents = [], intents = []) {
  return [
    ...documents.map((d, i) => ({ id: `${sourceId}:d:${d.id || i}`, sourceId, kind: "doc", title: d.title, source: d.source, content: d.text })),
    ...intents.map((it) => ({ id: `${sourceId}:i:${it.tag}`, sourceId, kind: "qa", title: it.patterns[0], source: it.source || "",
      content: `Câu hỏi: ${it.patterns.join(" / ")}\nTrả lời: ${it.answer}` })),
  ];
}

// Mã băm của dữ liệu gốc: đổi knowledge.json hoặc model embedding thì phải nhúng lại.
const baseChunks = (kb) => toChunks("base", kb.documents, kb.intents);
const hashChunks = (chunks) => crypto.createHash("sha256").update(JSON.stringify([EMBED_MODEL, DIMS, chunks])).digest("hex");

// ---------- Vector store dạng file (dùng khi không có database) ----------
const PREBUILT_FILE = path.join(__dirname, "data", "vectors.json");
const LOCAL_UPLOADS_FILE = process.env.UPLOADS_VECTORS_FILE || path.join(__dirname, "data", "uploads-vectors.json");
const readJson = (f) => { try { return JSON.parse(fs.readFileSync(f, "utf8")); } catch { return null; } };
let prebuilt; // undefined = chưa đọc
const loadPrebuilt = () => (prebuilt === undefined ? (prebuilt = readJson(PREBUILT_FILE)) : prebuilt);

function localItems(kb) {
  const pre = loadPrebuilt();
  // File vector cũ hơn knowledge.json thì bỏ qua (kết quả sẽ sai), chờ chạy lại `npm run vectors`.
  const base = pre && kb && pre.model === EMBED_MODEL && pre.hash === hashChunks(baseChunks(kb)) ? pre.items : [];
  return base.concat(readJson(LOCAL_UPLOADS_FILE) || []);
}

async function upsertRows(db, chunks, vectors) {
  for (let i = 0; i < chunks.length; i++) {
    const c = chunks[i];
    await db.query(
      `INSERT INTO chunks (id, source_id, kind, title, source, content, embedding) VALUES ($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT (id) DO UPDATE SET title = EXCLUDED.title, source = EXCLUDED.source, content = EXCLUDED.content, embedding = EXCLUDED.embedding`,
      [c.id, c.sourceId, c.kind, c.title, c.source, c.content, toSql(vectors[i])]);
  }
}

async function indexChunks(chunks) {
  if (!chunks.length) return 0;
  const db = getPool();
  const vectors = await embed(chunks.map((c) => `${c.title}\n${c.content}`), "RETRIEVAL_DOCUMENT");
  if (db) {
    await ensureSchema(db);
    await upsertRows(db, chunks, vectors);
  } else {
    const list = (readJson(LOCAL_UPLOADS_FILE) || []).filter((it) => !chunks.some((c) => c.id === it.id));
    fs.writeFileSync(LOCAL_UPLOADS_FILE, JSON.stringify(list.concat(chunks.map((c, i) => ({ ...c, embedding: vectors[i] })))));
  }
  return chunks.length;
}

async function deleteSource(sourceId) {
  const db = getPool();
  if (!db) {
    const list = readJson(LOCAL_UPLOADS_FILE);
    if (list) fs.writeFileSync(LOCAL_UPLOADS_FILE, JSON.stringify(list.filter((it) => it.sourceId !== sourceId)));
    return;
  }
  await ensureSchema(db);
  await db.query("DELETE FROM chunks WHERE source_id = $1", [sourceId]);
}

// Dữ liệu gốc (knowledge.json) trong Vector DB: chỉ nạp lại khi nội dung thay đổi (so mã băm).
// Ưu tiên vector đã nhúng sẵn trong data/vectors.json; file cũ thì gọi Gemini nhúng lại.
async function syncBase(kb) {
  const db = getPool();
  if (!db) return localItems(kb).length > 0;
  await ensureSchema(db);
  const chunks = baseChunks(kb);
  const hash = hashChunks(chunks);
  const { rows } = await db.query("SELECT value FROM meta WHERE key = 'base_hash'");
  if (rows[0]?.value === hash) return true;
  await db.query("DELETE FROM chunks WHERE source_id = 'base'");
  const pre = loadPrebuilt();
  if (pre && pre.model === EMBED_MODEL && pre.hash === hash) await upsertRows(db, chunks, pre.items.map((it) => it.embedding));
  else await indexChunks(chunks);
  await db.query("INSERT INTO meta (key, value) VALUES ('base_hash', $1) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value", [hash]);
  return true;
}

// Retrieval: nhúng câu hỏi rồi tìm Top-k đoạn gần nghĩa nhất (cosine).
// Có database: pgvector làm (<=> = khoảng cách cosine). Không có: tính trên vector trong file.
async function search(query, k = 5, kb) {
  const db = getPool();
  if (!db) {
    const items = localItems(kb);
    if (!items.length) return null;
    const [v] = await embed([query], "RETRIEVAL_QUERY");
    return items
      .map(({ embedding, ...it }) => ({ ...it, score: embedding.reduce((a, x, i) => a + x * v[i], 0) }))
      .sort((a, b) => b.score - a.score)
      .slice(0, k);
  }
  await ensureSchema(db);
  const [v] = await embed([query], "RETRIEVAL_QUERY");
  const { rows } = await db.query(
    `SELECT id, kind, title, source, content, 1 - (embedding <=> $1) AS score FROM chunks ORDER BY embedding <=> $1 LIMIT $2`,
    [toSql(v), k]);
  return rows.map((r) => ({ ...r, score: Number(r.score) }));
}

async function stats(kb) {
  const db = getPool();
  const count = (items) => ({ vectors: items.length, byKind: items.reduce((a, it) => ({ ...a, [it.kind]: (a[it.kind] || 0) + 1 }), {}) });
  if (!db) {
    const items = localItems(kb);
    return items.length
      ? { enabled: true, model: EMBED_MODEL, dims: DIMS, database: "File vector cục bộ (data/vectors.json)", ...count(items) }
      : { enabled: false, model: EMBED_MODEL, dims: DIMS, reason: poolError };
  }
  await ensureSchema(db);
  const { rows } = await db.query("SELECT kind, count(*)::int AS n FROM chunks GROUP BY kind");
  return { enabled: true, model: EMBED_MODEL, dims: DIMS, database: "PostgreSQL + pgvector (Netlify Database)",
    vectors: rows.reduce((a, r) => a + Number(r.n), 0), byKind: Object.fromEntries(rows.map((r) => [r.kind, Number(r.n)])) };
}

module.exports = { EMBED_MODEL, DIMS, embed, toChunks, baseChunks, hashChunks, indexChunks, deleteSource, syncBase, search, stats };
