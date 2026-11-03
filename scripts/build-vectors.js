// Nhúng dữ liệu gốc (data/knowledge.json) bằng Gemini Embedding và lưu kết quả vào Git:
//   data/vectors.json  – vector store dạng file (server tự dùng khi không có database, hoặc để nạp vào Vector DB)
//   data/vectors.sql   – dump PostgreSQL + pgvector: nạp vào database bất kỳ bằng `psql "<chuỗi kết nối>" -f data/vectors.sql`
// Chạy lại mỗi khi sửa knowledge.json: npm run vectors   (cần GEMINI_API_KEY trong .env)
const fs = require("fs");
const path = require("path");
try { process.loadEnvFile(path.join(__dirname, "..", ".env")); } catch {}
const { EMBED_MODEL, DIMS, embed, baseChunks, hashChunks } = require("../vectors.js");
const kb = require("../data/knowledge.json");

const round = (v) => v.map((x) => Math.round(x * 1e6) / 1e6); // 6 chữ số thập phân: đủ chính xác, file gọn hơn
const sqlStr = (s) => "'" + String(s).replace(/'/g, "''") + "'";

(async () => {
  const chunks = baseChunks(kb);
  const vectors = (await embed(chunks.map((c) => `${c.title}\n${c.content}`), "RETRIEVAL_DOCUMENT")).map(round);
  const hash = hashChunks(chunks);
  const items = chunks.map((c, i) => ({ ...c, embedding: vectors[i] }));
  const dataDir = path.join(__dirname, "..", "data");

  fs.writeFileSync(path.join(dataDir, "vectors.json"),
    JSON.stringify({ model: EMBED_MODEL, dims: DIMS, hash, createdAt: new Date().toISOString(), count: items.length, items }) + "\n");

  const sql = [
    `-- Vector DB của chatbot tuyển sinh ĐHTX UTT: ${items.length} vector ${DIMS} chiều (${EMBED_MODEL}).`,
    "-- Nạp vào PostgreSQL có pgvector: psql \"<chuỗi kết nối>\" -f data/vectors.sql",
    "CREATE EXTENSION IF NOT EXISTS vector;",
    `CREATE TABLE IF NOT EXISTS chunks (id TEXT PRIMARY KEY, source_id TEXT NOT NULL, kind TEXT NOT NULL, title TEXT NOT NULL, source TEXT NOT NULL, content TEXT NOT NULL, embedding vector(${DIMS}) NOT NULL);`,
    "CREATE INDEX IF NOT EXISTS chunks_embedding_idx ON chunks USING hnsw (embedding vector_cosine_ops);",
    "CREATE INDEX IF NOT EXISTS chunks_source_idx ON chunks (source_id);",
    "CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);",
    "DELETE FROM chunks WHERE source_id = 'base';",
    ...items.map((it) => `INSERT INTO chunks VALUES (${[it.id, it.sourceId, it.kind, it.title, it.source, it.content].map(sqlStr).join(", ")}, '[${it.embedding.join(",")}]');`),
    `INSERT INTO meta (key, value) VALUES ('base_hash', ${sqlStr(hash)}) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;`,
  ].join("\n") + "\n";
  fs.writeFileSync(path.join(dataDir, "vectors.sql"), sql);

  console.log(`Đã nhúng ${items.length} đoạn (${EMBED_MODEL}, ${DIMS} chiều) -> data/vectors.json, data/vectors.sql`);
})().catch((e) => { console.error(e.message); process.exit(1); });
