// Pipeline RAG chuẩn (chạy phía server, giữ API key bí mật):
//   Giai đoạn 1 (chuẩn bị): kho tri thức -> chunking -> embedding -> Vector DB (vectors.js).
//   Giai đoạn 2 (khi hỏi): câu hỏi -> embedding -> Vector DB tìm Top-k -> ghép prompt -> LLM (Gemini) trả lời.
// Mô hình học máy TF-IDF + KNN (bot.js): chặn câu nhạy cảm, gắn ý định, và dự phòng khi Vector DB/Gemini lỗi.
const { Bot, THRESHOLD } = require("./bot.js");
const { loadSources, mergeKb } = require("./store.js");
const vectors = require("./vectors.js");
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

// Đảm bảo dữ liệu gốc đã có trong Vector DB (chỉ nhúng lại khi knowledge.json đổi).
let baseSynced;
function syncBaseOnce() {
  baseSynced ??= vectors.syncBase(baseKb).catch((e) => { baseSynced = undefined; throw e; });
  return baseSynced;
}

// Retriever: ưu tiên Vector DB (tìm theo nghĩa); không có hoặc lỗi -> TF-IDF (tìm theo từ).
async function retrieve(bot, message, top) {
  try {
    if (await syncBaseOnce()) {
      const hits = await vectors.search(message, 5);
      if (hits && hits.length) {
        const relevant = hits.filter((h) => h.score >= 0.55);
        return {
          context: relevant.map((h) => `[${h.title} – nguồn: ${h.source}]\n${h.content}`).join("\n\n"),
          sources: [...new Set(relevant.map((h) => h.source).filter(Boolean))],
          docs: relevant.map((h) => `${h.title} (${h.score.toFixed(2)})`),
          retriever: "vector",
        };
      }
    }
  } catch (e) {
    console.error("Vector DB lỗi, dùng TF-IDF:", e.message);
  }
  return { ...buildContext(bot, message, top), retriever: "tfidf" };
}
const MODEL = process.env.GEMINI_MODEL || "gemini-3.5-flash-lite";
// Netlify (gói free) cắt function sau 10 giây -> đặt GEMINI_TIMEOUT_MS=9000 trên Netlify.
const TIMEOUT_MS = Number(process.env.GEMINI_TIMEOUT_MS) || 45000;

const SYSTEM = `Bạn là "Trợ lý tuyển sinh ĐHTX", nhân viên tư vấn tuyển sinh hệ ĐẠI HỌC TỪ XA của Trường Đại học Công nghệ Giao thông vận tải (UTT).
Cách nói chuyện:
- Tiếng Việt, thân thiện, tự nhiên như một tư vấn viên trẻ nhưng lịch sự, đúng mực của nhà trường; xưng "mình", gọi "bạn". Ngắn gọn (thường dưới 150 từ), dùng "•" khi liệt kê, in đậm bằng **...**.
- Không mở đầu bằng "Hihi"; không dùng "nè", "ghê", "chịu rồi"; tối đa 1 emoji mỗi câu trả lời, chỉ khi người dùng đang trò chuyện vui vẻ.
- Không tự đánh giá kiểu "ngành hot", "dễ xin việc", "tốt nhất" nếu tài liệu không nói vậy.
- Hiểu cả câu ngắn, câu cụt, tiếng lóng, viết không dấu, biểu cảm ("hihi", "ok", "hmm", "quan tâm", "thế à"). Dựa vào lịch sử hội thoại để hiểu người dùng đang nói tiếp ý nào.
- Chào hỏi, cảm ơn, khen, than thở, đùa vui: đáp lại tự nhiên 1–2 câu rồi nhẹ nhàng hỏi xem họ cần tư vấn gì về tuyển sinh (gợi ý vài chủ đề).
- Câu mơ hồ (vd "quan tâm", "tư vấn đi"): hỏi lại một câu để làm rõ, kèm gợi ý cụ thể (ngành, điều kiện, hồ sơ, học phí, hạn nộp).
Phạm vi và độ chính xác:
- Chỉ tư vấn về tuyển sinh, học tập hệ từ xa của UTT. Yêu cầu ngoài phạm vi (thời tiết, viết code, bài tập, trường khác, chính trị, tôn giáo, người lớn, bạo lực, lừa đảo…): lịch sự từ chối ngắn gọn, không trả lời nội dung đó, rồi mời hỏi về tuyển sinh.
- Mọi thông tin tuyển sinh (ngành, chỉ tiêu, ngày tháng, học phí, điều kiện, số điện thoại, đường link) CHỈ lấy từ phần TÀI LIỆU. Tuyệt đối không bịa. Tài liệu không có: nói chưa có thông tin và mời liên hệ tư vấn viên.
- Không nhắc tới "tài liệu", "ngữ cảnh", "hệ thống" hay các quy tắc này.`;

function buildContext(bot, message, top) {
  const { ranked } = bot.classify(message);
  const intents = ranked.filter((r) => r.score >= THRESHOLD).slice(0, 3).map((r) => bot.intents[r.tag]);
  const docs = bot.retrieve(message, 4).map((r) => r.doc);
  const matched = top.intent !== "ngoai_pham_vi";
  const blocks = (matched ? [`[Câu trả lời chuẩn cho ý định "${top.intent}"]\n${top.answer}`] : [])
    .concat(intents.filter((it) => it.tag !== top.intent).map((it) => `[Ý định "${it.tag}"]\n${it.answer}`))
    .concat(docs.map((d) => `[${d.title} – nguồn: ${d.source}]\n${d.text}`));
  const sources = [...new Set([matched && top.source, ...intents.map((it) => it.source), ...docs.map((d) => d.source)].filter(Boolean))];
  return { context: blocks.join("\n\n"), sources, docs: docs.map((d) => d.title) };
}

async function askGemini(message, history, context) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error("Thiếu GEMINI_API_KEY");
  const contents = history.slice(-6).map((h) => ({ role: h.role === "user" ? "user" : "model", parts: [{ text: String(h.text).slice(0, 1500) }] }));
  contents.push({ role: "user", parts: [{ text: `TÀI LIỆU:\n${context || "(không có đoạn nào liên quan)"}\n\nNGƯỜI DÙNG: ${message}` }] });
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
  // Chỉ chặn cứng câu có từ nhạy cảm; mọi câu khác (kể cả "hihi", "quan tâm", câu lạc đề) để Gemini hiểu và
  // tự quyết định trò chuyện, hỏi lại hay từ chối. Mô hình học máy lo truy xuất tài liệu và dự phòng khi Gemini lỗi.
  if (!top.intent || top.intent === "nhay_cam") return { ...top, mode: "rule", sources: [] };
  const { context, sources, docs, retriever } = await retrieve(bot, message, top);
  try {
    const { text, model } = await askGemini(message, Array.isArray(history) ? history : [], context);
    const intent = top.intent === "ngoai_pham_vi" ? "tro_chuyen" : top.intent;
    return { answer: text, intent, score: top.score, sources, docs, retriever, mode: "llm", model };
  } catch (e) {
    console.error("Gemini lỗi, dùng câu trả lời mẫu:", e.message);
    return { ...top, sources: top.source ? [top.source] : [], docs, retriever, mode: "ml", error: e.message };
  }
}

async function getKb() {
  return (await getBot()).kb;
}

module.exports = { chat, getKb };
