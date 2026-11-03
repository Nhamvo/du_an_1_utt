// Pipeline LLM + RAG (chạy phía server, giữ API key bí mật):
//   1. Mô hình học máy đã huấn luyện (bot.js) chặn câu nhạy cảm / ngoài phạm vi.
//   2. Retrieval: lấy các ý định khớp nhất + các đoạn tài liệu gần nhất.
//   3. Augmentation: ghép tài liệu vào prompt.  4. Generation: Gemini viết câu trả lời.
// Gemini lỗi hoặc quá thời gian -> trả câu trả lời mẫu của mô hình đã huấn luyện.
const { Bot, THRESHOLD } = require("./bot.js");
const { loadSources, mergeKb } = require("./store.js");
const baseKb = require("./data/knowledge.json");

// Tri thức = file gốc + dữ liệu admin upload; chỉ huấn luyện lại khi danh sách upload thay đổi.
let cache = { key: null, kb: null, bot: null };
async function getBot() {
  const sources = await loadSources().catch((e) => { console.error("Không đọc được dữ liệu upload:", e.message); return []; });
  const key = sources.map((s) => s.id).join(",");
  if (key !== cache.key || !cache.bot) {
    const kb = mergeKb(baseKb, sources);
    cache = { key, kb, bot: new Bot(kb) };
  }
  return cache;
}
const MODEL = process.env.GEMINI_MODEL || "gemini-3.5-flash-lite";
// Netlify (gói free) cắt function sau 10 giây -> đặt GEMINI_TIMEOUT_MS=9000 trên Netlify.
const TIMEOUT_MS = Number(process.env.GEMINI_TIMEOUT_MS) || 45000;

const SYSTEM = `Bạn là trợ lý tư vấn tuyển sinh hệ ĐẠI HỌC TỪ XA của Trường Đại học Công nghệ Giao thông vận tải (UTT).
Quy tắc bắt buộc:
- Chỉ trả lời bằng tiếng Việt, thân thiện, ngắn gọn (tối đa khoảng 180 từ), dùng gạch đầu dòng "•" khi liệt kê, in đậm bằng **...**.
- CHỈ dùng thông tin trong phần TÀI LIỆU. Tuyệt đối không bịa số liệu, ngày tháng, học phí, số điện thoại, đường link.
- Nếu TÀI LIỆU không có thông tin cần thiết: nói rõ là chưa có thông tin và đề nghị liên hệ tư vấn viên của cơ sở gần nhất.
- Chỉ tư vấn về tuyển sinh hệ từ xa của UTT. Câu hỏi về trường khác, chủ đề khác hoặc nhạy cảm: lịch sự từ chối và mời hỏi về tuyển sinh.
- Không nhắc tới "tài liệu", "ngữ cảnh" hay quy tắc này trong câu trả lời.`;

function buildContext(bot, message, top) {
  const { ranked } = bot.classify(message);
  const intents = ranked.filter((r) => r.score >= THRESHOLD).slice(0, 3).map((r) => bot.intents[r.tag]);
  const docs = bot.retrieve(message, 4).map((r) => r.doc);
  const blocks = [`[Câu trả lời chuẩn cho ý định "${top.intent}"]\n${top.answer}`]
    .concat(intents.filter((it) => it.tag !== top.intent).map((it) => `[Ý định "${it.tag}"]\n${it.answer}`))
    .concat(docs.map((d) => `[${d.title} – nguồn: ${d.source}]\n${d.text}`));
  const sources = [...new Set([top.source, ...intents.map((it) => it.source), ...docs.map((d) => d.source)].filter(Boolean))];
  return { context: blocks.join("\n\n"), sources, docs: docs.map((d) => d.title) };
}

async function askGemini(message, history, context) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error("Thiếu GEMINI_API_KEY");
  const contents = history.slice(-6).map((h) => ({ role: h.role === "user" ? "user" : "model", parts: [{ text: String(h.text).slice(0, 1500) }] }));
  contents.push({ role: "user", parts: [{ text: `TÀI LIỆU:\n${context}\n\nCÂU HỎI: ${message}` }] });
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": key },
    // Không đặt maxOutputTokens: Gemini 3.x tính cả token "suy nghĩ" vào đó nên câu trả lời dễ bị cắt.
    body: JSON.stringify({ systemInstruction: { parts: [{ text: SYSTEM }] }, contents, generationConfig: { temperature: 0.3 } }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error?.message || "HTTP " + res.status);
  const cand = data.candidates?.[0];
  const text = cand?.content?.parts?.map((p) => p.text || "").join("").trim();
  if (!text) throw new Error("Gemini không trả về nội dung");
  if (cand.finishReason && cand.finishReason !== "STOP") throw new Error("Câu trả lời bị dừng: " + cand.finishReason);
  return { text, model: data.modelVersion || MODEL };
}

async function chat(message, history = []) {
  message = String(message || "").trim().slice(0, 500);
  const { bot } = await getBot();
  const top = bot.reply(message);
  // Câu nhạy cảm / ngoài phạm vi: từ chối luôn, không gửi lên LLM.
  if (!top.intent || top.intent === "nhay_cam" || top.intent === "ngoai_pham_vi")
    return { ...top, mode: "rule", sources: [] };
  const { context, sources, docs } = buildContext(bot, message, top);
  try {
    const { text, model } = await askGemini(message, Array.isArray(history) ? history : [], context);
    return { answer: text, intent: top.intent, score: top.score, sources, docs, mode: "llm", model };
  } catch (e) {
    console.error("Gemini lỗi, dùng câu trả lời mẫu:", e.message);
    return { ...top, sources: top.source ? [top.source] : [], docs, mode: "ml", error: e.message };
  }
}

async function getKb() {
  return (await getBot()).kb;
}

module.exports = { chat, getKb };
