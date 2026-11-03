# Chatbot tư vấn tuyển sinh Đại học từ xa – UTT

Đồ án 1 – Ngành Công nghệ thông tin, Trường Đại học Công nghệ Giao thông vận tải (UTT).

Dự án gồm 2 phần dùng chung một backend:

1. **Chatbot tư vấn (RAG chuẩn: LLM + Embedding + Vector Database):** trả lời câu hỏi tuyển sinh hệ đại học từ xa. Tài liệu được nhúng thành vector (Gemini Embedding), lưu trong PostgreSQL + pgvector, tìm Top-k đoạn gần nghĩa nhất rồi để Gemini viết câu trả lời.
2. **Trang admin:** kéo thả file Excel, Word, PDF, PowerPoint… để cập nhật dữ liệu cho chatbot mà không cần sửa code.

| | Đường dẫn |
|---|---|
| Chatbot | https://graceful-arithmetic-f81fbb.netlify.app |
| Trang admin | https://graceful-arithmetic-f81fbb.netlify.app/admin |

> Sản phẩm sinh viên, không phải kênh tư vấn chính thức của trường. Dữ liệu gốc lấy từ *Thông báo tuyển sinh đào tạo từ xa trình độ đại học năm 2026* trên utt.edu.vn.

---

## 1. Chatbot tư vấn (RAG: LLM + Embedding + Vector DB)

### Tính năng
- Chào và giới thiệu tuyển sinh ngay khi mở trang; câu hỏi gợi ý.
- Trả lời về ngành đào tạo, điều kiện và phương thức xét tuyển, hồ sơ, hạn nộp, học phí, thời gian đào tạo, văn bằng, hình thức học từ xa…
- **Hiểu như người thật**: trò chuyện tự nhiên với câu chào, câu cảm xúc ("hihi", "ok"), câu mơ hồ ("quan tâm" → hỏi lại), câu nói tiếp ý trước ("thế học mất bao lâu").
- **Chỉ tư vấn trong phạm vi tuyển sinh**: chặn cứng câu nhạy cảm (chính trị, bạo lực, mua bằng giả…), lịch sự từ chối câu lạc đề (thời tiết, viết code…).
- Mỗi câu trả lời ghi rõ **nguồn**, nhãn *AI + RAG* hoặc *Học máy*, độ khớp ý định.
- Thanh bên: đếm ngược hạn nộp hồ sơ, 4 đợt xét tuyển, 9 ngành kèm chỉ tiêu, số điện thoại 3 cơ sở (bấm để sao chép), liên kết hữu ích.
- Nhập bằng giọng nói, đọc to câu trả lời, sao chép, đánh giá 👍/👎, lưu lịch sử, tải hội thoại `.txt`, giao diện sáng/tối, dùng tốt trên điện thoại.

### Cách hoạt động (RAG theo 2 giai đoạn)

```
Kho tri thức ──► Chunking ──► Embedding ──► Vector DB ──► Retriever ──► LLM
PDF·Word·Excel    chia đoạn    văn bản→vector  lưu & tìm gần   lấy Top-k     trả lời
```

**Giai đoạn 1 – Chuẩn bị trước:** nạp tài liệu (`data/knowledge.json` + file upload ở trang admin) → chia đoạn → **Gemini Embedding** (`gemini-embedding-001`, 768 chiều) → lưu vào **Vector DB** (PostgreSQL + **pgvector** trên Netlify Database, bảng `chunks`, chỉ mục HNSW cosine). Dữ liệu gốc tự nhúng lại khi `knowledge.json` thay đổi; file upload được nhúng ngay khi lưu.

**Giai đoạn 2 – Khi người dùng hỏi:**

```
Câu hỏi
  ├─ 0. Chặn an toàn: có từ nhạy cảm → từ chối ngay (không gửi lên AI)
  ├─ 1. Embedding câu hỏi → vector
  ├─ 2. Retriever: pgvector tìm Top-5 đoạn gần nghĩa nhất (khoảng cách cosine)
  ├─ 3. Ghép các đoạn + lịch sử hội thoại vào prompt (cấm bịa số liệu)
  └─ 4. LLM (Gemini) trả lời, kèm nguồn
         ├─ câu tuyển sinh → trả lời từ tài liệu
         ├─ chào hỏi, câu mơ hồ → trò chuyện tự nhiên, hỏi lại
         └─ câu lạc đề → lịch sự từ chối
Dự phòng: Vector DB lỗi → tìm bằng TF-IDF; Gemini lỗi → mô hình học máy trả lời câu soạn sẵn.
```

Ví dụ tìm theo nghĩa: "tiền học mỗi kỳ" → đoạn "học phí" (độ giống 0,73); "bao giờ đóng cổng nhận hồ sơ" → "hạn nộp hồ sơ" (0,75), dù không trùng từ khóa.

| Thành phần | Công nghệ | File |
|---|---|---|
| LLM | Google Gemini `gemini-3.5-flash-lite` | `rag.js` |
| Embedding | Gemini `gemini-embedding-001` (768 chiều, chuẩn hóa) | `vectors.js` |
| Vector Database | PostgreSQL + pgvector (Netlify Database, Neon) | `vectors.js` |
| Học máy (dự phòng, chặn nhạy cảm, gắn ý định) | TF-IDF + KNN tự viết | `bot.js` |

- **Dữ liệu** (`data/knowledge.json`): 29 ý định, 383 câu mẫu huấn luyện, 14 đoạn tài liệu → 43 vector trong Vector DB.
- **Dữ liệu đã nhúng sẵn có trong Git**:
  - `data/vectors.json`: 43 vector 768 chiều. Chạy local không có database thì server dùng luôn file này làm vector store (vẫn tìm theo nghĩa). Có database thì nạp thẳng vào Vector DB, không phải gọi Gemini nhúng lại.
  - `data/vectors.sql`: dump PostgreSQL + pgvector (tạo bảng + 43 dòng vector), nạp vào database bất kỳ bằng `psql "<chuỗi kết nối>" -f data/vectors.sql`.
  - Sửa `knowledge.json` thì chạy `npm run vectors` để tạo lại 2 file này.
- API key Gemini và kết nối database chỉ nằm phía server, không lộ ra trình duyệt.

---

## 2. Trang admin cập nhật dữ liệu

Mở `/admin`, đăng nhập bằng mật khẩu quản trị (`ADMIN_PASSWORD`), rồi **kéo thả file**. Không cần theo template.

| Loại file | Chatbot dùng như thế nào |
|---|---|
| Word `.docx`, PDF có lớp chữ, PowerPoint `.pptx`, `.txt`, `.md` | Lấy chữ, cắt thành đoạn ~900 ký tự để tra cứu (RAG) |
| Excel/CSV thường | Mỗi dòng thành một đoạn dạng `Tên cột: giá trị; …` |
| Excel/CSV có cột hỏi + cột trả lời (`Câu hỏi/Trả lời`, `Hỏi/Đáp`, `Q/A`…) | Mỗi dòng thành một **ý định mới**, bot được huấn luyện lại ngay. Cột `Cách hỏi khác` (ngăn cách bằng `;`) là tùy chọn |

Mỗi đoạn / cặp hỏi–đáp vừa lưu được **nhúng vector và ghi vào Vector DB ngay**; xóa tài liệu thì xóa luôn vector. Trang admin hiển thị số vector đang có.

- Dòng tiêu đề Excel được dò trong 10 dòng đầu (bỏ qua dòng tên trường, tên bảng).
- Mặc định **tự lưu** sau khi đọc; bỏ chọn để xem trước rồi mới lưu.
- Xem thống kê tri thức, danh sách tài liệu đã upload (xóa được), ô "Thử hỏi chatbot".
- File được đọc ngay trên trình duyệt (SheetJS, mammoth, pdf.js, JSZip); server chỉ nhận phần chữ và làm sạch lại trước khi lưu.
- Chưa hỗ trợ: Word `.doc` đời cũ, PDF scan dạng ảnh, file ảnh.

---

## Công nghệ

| Phần | Công nghệ |
|---|---|
| Frontend | HTML, CSS, JavaScript thuần (không framework) |
| Backend | Node.js, Netlify Functions (serverless) |
| LLM | Google Gemini `gemini-3.5-flash-lite` |
| Embedding | Google Gemini `gemini-embedding-001` |
| Vector Database | PostgreSQL + pgvector (Netlify Database) |
| Lưu file upload | Netlify Blobs (key–value); chạy local thì lưu `data/uploads.json` |
| Đọc file (trang admin) | SheetJS, mammoth, pdf.js, JSZip (tải từ CDN) |

## Cấu trúc thư mục

```
├── index.html                 Giao diện chatbot
├── admin.html                 Trang admin upload dữ liệu
├── bot.js                     Mô hình học máy: tiền xử lý, huấn luyện, phân loại, truy xuất (dùng cả FE và BE)
├── rag.js                     Pipeline RAG: retriever (Vector DB, dự phòng TF-IDF) + LLM Gemini
├── vectors.js                 Embedding (Gemini) + Vector DB (PostgreSQL + pgvector)
├── store.js                   Lưu/đọc dữ liệu upload, API quản trị, kiểm tra mật khẩu
├── server.js                  Server chạy local (port 8088)
├── netlify/functions/
│   ├── chat.mjs               POST /api/chat
│   ├── kb.mjs                 GET  /api/kb   (tri thức hiện tại)
│   └── admin.mjs              GET/POST/DELETE /api/admin
├── data/knowledge.json        Dữ liệu huấn luyện gốc + tài liệu RAG
├── data/vectors.json          43 vector đã nhúng sẵn (vector store dạng file)
├── data/vectors.sql           Dump PostgreSQL + pgvector của Vector DB
├── scripts/build-vectors.js   npm run vectors: nhúng lại dữ liệu gốc, xuất 2 file trên
├── test.js                    Kiểm thử
├── build.js                   Đóng gói dist/ để deploy
├── Dockerfile                 Đóng gói Docker image
├── netlify.toml               Cấu hình Netlify
└── .env.example               Mẫu biến môi trường
```

## Chạy trên máy

Yêu cầu Node.js 20.12 trở lên. Không có `.env` vẫn chạy được: chatbot trả lời bằng học máy, trang admin cần `ADMIN_PASSWORD` mới đăng nhập được.

```bash
npm install
cp .env.example .env      # tùy chọn: điền GEMINI_API_KEY (bật AI) và ADMIN_PASSWORD (bật trang admin)
npm test
npm start                 # http://localhost:8088  –  admin: http://localhost:8088/admin
```

| Có gì trong `.env` | Chatbot chạy thế nào |
|---|---|
| Không có gì | Học máy TF-IDF + KNN trả lời câu soạn sẵn |
| `GEMINI_API_KEY` | **Đủ RAG**: Embedding câu hỏi + tìm theo nghĩa trên 43 vector có sẵn trong `data/vectors.json` + LLM Gemini |
| `GEMINI_API_KEY` + `NETLIFY_DB_URL` | Như trên nhưng Vector DB là PostgreSQL + pgvector (Netlify Database) |

Muốn có Vector DB PostgreSQL riêng trên máy, nạp sẵn dữ liệu:

```bash
docker run -d --name chatbot-pgvector -e POSTGRES_PASSWORD=postgres -p 5432:5432 pgvector/pgvector:pg17
docker exec -i chatbot-pgvector psql -U postgres < data/vectors.sql
```

(Server hiện kết nối database qua HTTP API của Neon/Netlify Database; PostgreSQL chạy bằng Docker dùng để xem, truy vấn và demo dữ liệu vector bằng SQL.)

## Chạy bằng Docker

```bash
docker build -t chatbot-tuyensinh .
docker run -d --name chatbot-tuyensinh -p 8088:8088 \
  -e GEMINI_API_KEY="<key>" -e ADMIN_PASSWORD="<mật khẩu>" \
  -v chatbot-uploads:/app/uploads \
  chatbot-tuyensinh
```

Mở http://localhost:8088 (admin: `/admin`). Bỏ các `-e` thì chatbot vẫn chạy bằng học máy. Volume `/app/uploads` giữ dữ liệu upload từ trang admin khi tạo lại container. Image không chứa bí mật nào.

## Deploy lên Netlify

```bash
npx netlify-cli login
npx netlify-cli link                     # hoặc: npx netlify-cli init để tạo site mới
npx netlify-cli env:set GEMINI_API_KEY "<key>" --secret --context production
npx netlify-cli env:set ADMIN_PASSWORD "<mật khẩu>" --secret --context production
npx netlify-cli env:set GEMINI_MODEL gemini-3.5-flash-lite
npx netlify-cli deploy --prod
```

Lần deploy đầu, Netlify thấy package `@netlify/database` sẽ **tự tạo Vector DB** (PostgreSQL) cho site; câu hỏi đầu tiên tự bật pgvector, tạo bảng và nhúng dữ liệu gốc. Quản lý database tại mục **Database** của project trên Netlify.

Kéo thả thư mục lên Netlify Drop **không** chạy được Functions, nên phần AI và trang admin sẽ không hoạt động; cần deploy bằng CLI hoặc kết nối repo GitHub.

## Biến môi trường

| Biến | Bắt buộc | Ý nghĩa |
|---|---|---|
| `GEMINI_API_KEY` | Không (thiếu thì chỉ dùng học máy) | API key Google AI Studio |
| `GEMINI_MODEL` | Không | Mặc định `gemini-3.5-flash-lite` |
| `GEMINI_TIMEOUT_MS` | Không | Thời gian chờ Gemini, mặc định 45000 |
| `EMBED_MODEL` | Không | Mặc định `gemini-embedding-001` |
| `NETLIFY_DB_URL` | Không | Chuỗi kết nối Vector DB; Netlify tự cấp khi deploy (package `@netlify/database`). Thiếu thì bot tìm tài liệu bằng TF-IDF |
| `ADMIN_PASSWORD` | Có (cho trang admin) | Mật khẩu trang quản trị |

## Kiểm thử

`npm test` chạy 37 câu hỏi mẫu (đúng ý định, từ chối câu lạc đề và nhạy cảm, gõ không dấu), kiểm tra dữ liệu upload được huấn luyện/tra cứu và chặn sai mật khẩu admin.

## Hướng phát triển
- GraphRAG (trích xuất thực thể – quan hệ, knowledge graph) cho câu hỏi cần liên kết nhiều thông tin.
- Kết hợp tìm theo nghĩa (vector) và theo từ khóa (hybrid search), xếp hạng lại kết quả (re-ranking).
- Đọc PDF scan bằng OCR; kết nối Zalo/Messenger.
