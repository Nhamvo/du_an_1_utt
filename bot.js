// Lõi chatbot: tiền xử lý tiếng Việt, huấn luyện TF-IDF, phân loại ý định bằng KNN (cosine).
// Chạy được cả trong trình duyệt (window.TuyenSinhBot) lẫn Node (require) để test.
(function (root) {
  // Dưới ngưỡng này coi là câu hỏi ngoài phạm vi tuyển sinh -> từ chối.
  const THRESHOLD = 0.3;
  // Phải có hơn tỉ lệ này số từ trong câu hỏi thuộc từ vựng tuyển sinh đã học (chặn câu lạc đề).
  const MIN_COVERAGE = 0.5;
  // Câu hỏi không khớp ý định nào nhưng khớp đoạn tài liệu (vd tài liệu admin upload) từ mức này -> trả lời theo tài liệu.
  const DOC_THRESHOLD = 0.3;

  const STOPWORDS = new Set(`a ạ à ơi nhé nha nhỉ thì là mà và với của cho có không ko k được đc bị
toi tôi mình minh em anh chị chi bạn ban ad admin gì gi nào nao thế the vậy vay sao
cái cai này nay đó do kia những nhung các cac một mot ở o ra vào vao lên len xin hỏi hoi
muốn muon cần can biết biet ai đi di rồi roi đã da sẽ se đang dang thôi`.split(/\s+/));

  const WORD = /[\p{L}\p{N}_]+/gu;
  const stripAccents = (s) => s.replace(/đ/g, "d").replace(/Đ/g, "D").normalize("NFD").replace(/\p{M}/gu, "");
  const hasAccents = (s) => stripAccents(s) !== s;
  const PLAIN_STOP = new Set([...STOPWORDS].map(stripAccents));
  const wordRe = (kw) => new RegExp("(?<![\\p{L}\\p{N}_])" + kw.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "(?![\\p{L}\\p{N}_])", "u");

  // plain=true: bỏ dấu cho người gõ không dấu ("hoc phi" ~ "học phí"); mặc định giữ dấu
  // để không nhầm từ khác nghĩa ("thục"/"thức", "từ từ"/"tự tử").
  function tokenize(text, plain) {
    let t = text.toLowerCase().normalize("NFC");
    let stop = STOPWORDS;
    if (plain) { t = stripAccents(t); stop = PLAIN_STOP; }
    const words = (t.match(WORD) || []).filter((w) => !stop.has(w));
    return words.concat(words.slice(1).map((w, i) => words[i] + "_" + w));
  }

  function tfidf(tokens, idf) {
    const vec = {};
    for (const t of tokens) if (t in idf) vec[t] = (vec[t] || 0) + idf[t];
    const norm = Math.sqrt(Object.values(vec).reduce((a, v) => a + v * v, 0)) || 1;
    for (const t in vec) vec[t] /= norm;
    return vec;
  }

  // Huấn luyện: mỗi câu mẫu -> vector TF-IDF, cho 2 "góc nhìn" có dấu và không dấu.
  function train(kb) {
    const model = {};
    for (const [view, plain] of [["acc", false], ["plain", true]]) {
      const docs = kb.intents.flatMap((it) => it.patterns.map((p) => [it.tag, tokenize(p, plain)]));
      const df = {};
      for (const [, toks] of docs) for (const t of new Set(toks)) df[t] = (df[t] || 0) + 1;
      const idf = {};
      for (const t in df) idf[t] = Math.log((1 + docs.length) / (1 + df[t])) + 1;
      model[view] = { idf, samples: docs.map(([tag, toks]) => ({ tag, vec: tfidf(toks, idf) })) };

      // Chỉ mục RAG: mỗi đoạn tài liệu -> vector TF-IDF (IDF riêng của kho tài liệu).
      const chunks = (kb.documents || []).map((d) => tokenize(d.title + " " + d.text, plain));
      const cdf = {};
      for (const toks of chunks) for (const t of new Set(toks)) cdf[t] = (cdf[t] || 0) + 1;
      const cidf = {};
      for (const t in cdf) cidf[t] = Math.log((1 + chunks.length) / (1 + cdf[t])) + 1;
      model[view].docIdf = cidf;
      model[view].docVecs = chunks.map((toks) => tfidf(toks, cidf));
    }
    model.stats = { intents: kb.intents.length, samples: model.acc.samples.length,
      features: Object.keys(model.acc.idf).length, documents: (kb.documents || []).length };
    return model;
  }

  class Bot {
    constructor(kb) {
      this.kb = kb;
      this.model = train(kb);
      this.intents = Object.fromEntries(kb.intents.map((it) => [it.tag, it]));
    }

    // Truy xuất (Retrieval của RAG): k đoạn tài liệu gần câu hỏi nhất theo cosine.
    retrieve(text, k = 4) {
      const plain = !hasAccents(text);
      const m = this.model[plain ? "plain" : "acc"];
      const q = tfidf(tokenize(text, plain), m.docIdf);
      return m.docVecs
        .map((v, i) => ({ doc: this.kb.documents[i], score: Object.keys(q).reduce((a, t) => a + q[t] * (v[t] || 0), 0) }))
        .filter((r) => r.score > 0.05)
        .sort((a, b) => b.score - a.score)
        .slice(0, k);
    }

    // KNN: điểm cosine cao nhất của mỗi ý định; kèm tỉ lệ từ của câu hỏi có trong từ vựng.
    classify(text) {
      const plain = !hasAccents(text);
      const m = this.model[plain ? "plain" : "acc"];
      const toks = tokenize(text, plain);
      // Độ phủ = trung bình tỉ lệ từ đơn và tỉ lệ cặp từ có trong từ vựng; cặp từ giúp chặn
      // các câu ghép từ quen thành nghĩa lạ ("tổng" + "thống" -> "tổng thống").
      const share = (arr) => arr.filter((w) => w in m.idf || w in m.docIdf).length / arr.length;
      const words = toks.filter((t) => !t.includes("_"));
      const pairs = toks.filter((t) => t.includes("_"));
      const coverage = !words.length ? 0 : pairs.length ? (share(words) + share(pairs)) / 2 : share(words);
      const q = tfidf(toks, m.idf);
      const best = {};
      for (const s of m.samples) {
        let score = 0;
        for (const t in q) score += q[t] * (s.vec[t] || 0);
        best[s.tag] = Math.max(best[s.tag] || 0, score);
      }
      const ranked = Object.entries(best).map(([tag, score]) => ({ tag, score })).sort((a, b) => b.score - a.score);
      return { ranked, coverage };
    }

    isSensitive(text) {
      const low = text.toLowerCase().normalize("NFC");
      const plain = stripAccents(low);
      return this.kb.sensitive_keywords.some((kw) =>
        wordRe(kw).test(low) ||
        // Bản không dấu chỉ dùng khi người dùng gõ không dấu, và chỉ với cụm nhiều từ
        // (tránh "súng" ~ "sung", "tự tử" ~ "từ từ").
        (!hasAccents(text) && kw.includes(" ") && wordRe(stripAccents(kw)).test(plain)));
    }

    suggestMajor(text, intent) {
      const plain = stripAccents(text.toLowerCase().normalize("NFC"));
      const found = (intent.suggest || [])
        .filter((s) => s.keywords.some((k) => wordRe(stripAccents(k)).test(plain)))
        .map((s) => s.major);
      if (!found.length) return intent.answer;
      return "Dựa trên thông tin bạn chia sẻ, mình gợi ý ngành:\n• " + found.join("\n• ") +
        "\n\nBạn muốn biết thêm về điều kiện xét tuyển hoặc thời gian học của ngành này không?";
    }

    reply(text) {
      text = (text || "").trim();
      if (!text) return { answer: "Bạn hãy nhập câu hỏi nhé!", intent: null, score: 0, source: "" };
      if (this.isSensitive(text)) return { answer: this.kb.refuse_sensitive, intent: "nhay_cam", score: 0, source: "" };
      const { ranked, coverage } = this.classify(text);
      const { tag, score } = ranked[0];
      if (score < THRESHOLD || coverage <= MIN_COVERAGE) {
        const hit = coverage > MIN_COVERAGE && this.retrieve(text, 1)[0];
        if (hit && hit.score >= DOC_THRESHOLD) {
          const t = hit.doc.text;
          return { answer: `Theo **${hit.doc.title}**:\n${t.length > 700 ? t.slice(0, 700) + "…" : t}`,
            intent: "tai_lieu", score: +hit.score.toFixed(3), source: hit.doc.source };
        }
        return { answer: this.kb.refuse_out_of_scope, intent: "ngoai_pham_vi", score: +score.toFixed(3), source: "" };
      }
      const intent = this.intents[tag];
      const answer = tag === "goi_y_nganh" ? this.suggestMajor(text, intent) : intent.answer;
      return { answer, intent: tag, score: +score.toFixed(3), source: intent.source || "" };
    }
  }

  const api = { Bot, train, tokenize, stripAccents, THRESHOLD, MIN_COVERAGE };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.TuyenSinhBot = api;
})(this);
