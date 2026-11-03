// Kiểm thử: node test.js
const assert = require("assert");
const { Bot } = require("./bot.js");
const bot = new Bot(require("./data/knowledge.json"));

const cases = [
  ["hoc phi bao nhieu", "hoc_phi"],
  ["Học phí hệ từ xa là bao nhiêu vậy ạ", "hoc_phi"],
  ["lệ phí xét tuyển", "hoc_phi"],
  ["cần những giấy tờ gì để nộp", "ho_so"],
  ["bằng từ xa có giá trị không", "van_bang"],
  ["trường có những ngành nào", "nganh_dao_tao"],
  ["có ngành ô tô không", "nganh_o_to"],
  ["tôi thích lập trình", "goi_y_nganh"],
  ["em đang làm kế toán, nên học ngành gì", "goi_y_nganh"],
  ["trường mình ở đâu", "gioi_thieu_truong"],
  ["có phải thi đầu vào không", "dieu_kien_xet_tuyen"],
  ["học mấy năm", "thoi_gian_dao_tao"],
  ["hạn nộp hồ sơ khi nào", "han_nop"],
  ["gặp tư vấn viên", "tu_van_vien"],
  ["đã có bằng cao đẳng thì sao", "lien_thong_vb2"],
  ["học online được không", "hinh_thuc_tu_xa"],
  ["chào", "chao_hoi"],
  // Ngoài phạm vi
  ["thời tiết hôm nay thế nào", "ngoai_pham_vi"],
  ["cho tôi công thức nấu phở", "ngoai_pham_vi"],
  ["ai là tổng thống mỹ", "ngoai_pham_vi"],
  ["viết code python sắp xếp mảng", "ngoai_pham_vi"],
  ["giá vàng hôm nay", "ngoai_pham_vi"],
  ["bóng đá tối nay", "ngoai_pham_vi"],
  ["thủ đô của pháp là gì", "ngoai_pham_vi"],
  ["viết bài thơ về mùa thu", "ngoai_pham_vi"],
  ["so sánh iphone và samsung", "ngoai_pham_vi"],
  // Dữ liệu mở rộng (v2)
  ["tuổi tác có bị giới hạn không", "dieu_kien_xet_tuyen"],
  ["có học bổng không", "hoc_bong_mien_giam"],
  ["quên mật khẩu hoctructuyen", "thiet_bi_hoc"],
  ["ngành công nghệ thông tin", "nganh_cntt"],
  ["chỉ tiêu ngành ô tô", "nganh_o_to"],
  ["từ xa khác vừa làm vừa học thế nào", "so_sanh_he"],
  ["khi nào biết trúng tuyển", "han_nop"],
  // Nhạy cảm
  ["bạn nghĩ gì về bầu cử", "nhay_cam"],
  ["cách hack facebook", "nhay_cam"],
  ["chỗ nào mua bằng giả", "nhay_cam"],
  ["mua bang gia o dau", "nhay_cam"],
];

let fail = 0;
for (const [q, want] of cases) {
  const r = bot.reply(q);
  const ok = r.intent === want;
  if (!ok) fail++;
  console.log(`${ok ? "✓" : "✗"} ${String(r.score).padEnd(5)} ${String(r.intent).padEnd(20)} | ${q}${ok ? "" : "  (mong đợi " + want + ")"}`);
}
// Dữ liệu admin upload: hỏi–đáp mới được huấn luyện, đoạn tài liệu mới được tra cứu.
const { mergeKb, sanitize, adminApi } = require("./store.js");
const up = sanitize({ name: "thong-bao-2027.docx", type: "docx",
  documents: [{ title: "Học phí 2027", text: "Học phí đào tạo từ xa năm 2027 là 450.000 đồng mỗi tín chỉ, đóng theo học kỳ." }],
  intents: [{ patterns: ["có lớp học offline cuối tuần không", "học trực tiếp cuối tuần"], answer: "Có buổi gặp mặt cuối tuần." }] });
assert.strictEqual(up.documents[0].source, "Tài liệu upload: thong-bao-2027.docx");
const bot2 = new Bot(mergeKb(require("./data/knowledge.json"), [up]));
assert.ok(bot2.reply("có lớp học offline cuối tuần không").intent.startsWith("up_"));
assert.ok(bot2.retrieve("học phí năm 2027 mỗi tín chỉ")[0].doc.text.includes("450.000"));
assert.strictEqual(bot2.reply("ai là tổng thống mỹ").intent, "ngoai_pham_vi");
// Không có mật khẩu đúng thì không được ghi dữ liệu
process.env.ADMIN_PASSWORD = "dung";
adminApi("POST", "{}", null, "sai").then((r) => { assert.strictEqual(r.status, 401); console.log("✓ chặn mật khẩu sai (401)"); });

// "từ từ" không được nhầm thành "tự tử"
assert.notStrictEqual(bot.reply("học từ từ có được không").intent, "nhay_cam");
assert.ok(bot.reply("tôi làm sửa xe ô tô").answer.includes("Công nghệ kỹ thuật ô tô"));
console.log(fail ? `\n${fail} ca sai` : "\nTất cả đều đúng", bot.model.stats);
process.exitCode = fail ? 1 : 0;
