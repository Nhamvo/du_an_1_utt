// Embedding + Vector database cho RAG.
//   Embedding: Gemini gemini-embedding-001 (768 chiều) biến văn bản thành vector theo NGHĨA.
//   Vector DB: PostgreSQL + pgvector (Netlify Database) lưu vector, tìm Top-k đoạn gần nghĩa nhất (cosine).
// Không có database (vd chạy local chưa cấu hình) -> các hàm trả null, rag.js quay về tìm bằng TF-IDF.
const crypto = require("crypto");

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

async function indexChunks(chunks) {
  const db = getPool();
  if (!db || !chunks.length) return 0;
  await ensureSchema(db);
  const vectors = await embed(chunks.map((c) => `${c.title}\n${c.content}`), "RETRIEVAL_DOCUMENT");
  for (let i = 0; i < chunks.length; i++) {
    const c = chunks[i];
    await db.query(
      `INSERT INTO chunks (id, source_id, kind, title, source, content, embedding) VALUES ($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT (id) DO UPDATE SET title = EXCLUDED.title, source = EXCLUDED.source, content = EXCLUDED.content, embedding = EXCLUDED.embedding`,
      [c.id, c.sourceId, c.kind, c.title, c.source, c.content, toSql(vectors[i])]);
  }
  return chunks.length;
}

async function deleteSource(sourceId) {
  const db = getPool();
  if (!db) return;
  await ensureSchema(db);
  await db.query("DELETE FROM chunks WHERE source_id = $1", [sourceId]);
}

// Dữ liệu gốc (knowledge.json): chỉ nhúng lại khi nội dung thay đổi (so mã băm).
async function syncBase(kb) {
  const db = getPool();
  if (!db) return false;
  await ensureSchema(db);
  const chunks = toChunks("base", kb.documents, kb.intents);
  const hash = crypto.createHash("sha256").update(JSON.stringify([EMBED_MODEL, DIMS, chunks])).digest("hex");
  const { rows } = await db.query("SELECT value FROM meta WHERE key = 'base_hash'");
  if (rows[0]?.value === hash) return true;
  await db.query("DELETE FROM chunks WHERE source_id = 'base'");
  await indexChunks(chunks);
  await db.query("INSERT INTO meta (key, value) VALUES ('base_hash', $1) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value", [hash]);
  return true;
}

// Retrieval: nhúng câu hỏi rồi để pgvector tìm Top-k đoạn gần nghĩa nhất (<=> = khoảng cách cosine).
async function search(query, k = 5) {
  const db = getPool();
  if (!db) return null;
  await ensureSchema(db);
  const [v] = await embed([query], "RETRIEVAL_QUERY");
  const { rows } = await db.query(
    `SELECT id, kind, title, source, content, 1 - (embedding <=> $1) AS score FROM chunks ORDER BY embedding <=> $1 LIMIT $2`,
    [toSql(v), k]);
  return rows.map((r) => ({ ...r, score: Number(r.score) }));
}

async function stats() {
  const db = getPool();
  if (!db) return { enabled: false, model: EMBED_MODEL, dims: DIMS, reason: poolError };
  await ensureSchema(db);
  const { rows } = await db.query("SELECT kind, count(*)::int AS n FROM chunks GROUP BY kind");
  return { enabled: true, model: EMBED_MODEL, dims: DIMS, database: "PostgreSQL + pgvector (Netlify Database)",
    vectors: rows.reduce((a, r) => a + Number(r.n), 0), byKind: Object.fromEntries(rows.map((r) => [r.kind, Number(r.n)])) };
}

module.exports = { embed, toChunks, indexChunks, deleteSource, syncBase, search, stats };
