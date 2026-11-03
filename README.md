# Chatbot tư vấn tuyển sinh Đại học từ xa – UTT

Đồ án 1 – Ngành Công nghệ thông tin, Trường Đại học Công nghệ Giao thông vận tải (UTT).

Dự án gồm 2 phần dùng chung một backend:

1. **Chatbot tư vấn (v2 – LLM + RAG):** trả lời câu hỏi tuyển sinh hệ đại học từ xa, kết hợp mô hình học máy tự huấn luyện với Gemini.
2. **Trang admin:** kéo thả file Excel, Word, PDF, PowerPoint… để cập nhật dữ liệu cho chatbot mà không cần sửa code.

| | Đường dẫn |
|---|---|
| Chatbot | https://graceful-arithmetic-f81fbb.netlify.app |
| Trang admin | https://graceful-arithmetic-f81fbb.netlify.app/admin |

> Sản phẩm sinh viên, không phải kênh tư vấn chính thức của trường. Dữ liệu gốc lấy từ *Thông báo tuyển sinh đào tạo từ xa trình độ đại học năm 2026* trên utt.edu.vn.

---

## 1. Chatbot tư vấn (LLM + RAG)

### Tính năng
- Chào và giới thiệu tuyển sinh ngay khi mở trang; câu hỏi gợi ý.
- Trả lời về ngành đào tạo, điều kiện và phương thức xét tuyển, hồ sơ, hạn nộp, học phí, thời gian đào tạo, văn bằng, hình thức học từ xa…
- **Hiểu như người thật**: trò chuyện tự nhiên với câu chào, câu cảm xúc ("hihi", "ok"), câu mơ hồ ("quan tâm" → hỏi lại), câu nói tiếp ý trước ("thế học mất bao lâu").
- **Chỉ tư vấn trong phạm vi tuyển sinh**: chặn cứng câu nhạy cảm (chính trị, bạo lực, mua bằng giả…), lịch sự từ chối câu lạc đề (thời tiết, viết code…).
- Mỗi câu trả lời ghi rõ **nguồn**, nhãn *AI + RAG* hoặc *Học máy*, độ khớp ý định.
- Thanh bên: đếm ngược hạn nộp hồ sơ, 4 đợt xét tuyển, 9 ngành kèm chỉ tiêu, số điện thoại 3 cơ sở (bấm để sao chép), liên kết hữu ích.
- Nhập bằng giọng nói, đọc to câu trả lời, sao chép, đánh giá 👍/👎, lưu lịch sử, tải hội thoại `.txt`, giao diện sáng/tối, dùng tốt trên điện thoại.

### Cách hoạt động

```
Câu hỏi
  │
  ├─ 1. Chặn an toàn: có từ nhạy cảm → từ chối ngay (không gửi lên AI)
  ├─ 2. Retrieval: mô hình học máy (TF-IDF + KNN) tìm các ý định khớp nhất + 4 đoạn tài liệu gần nhất
  ├─ 3. Augmentation: ghép tài liệu + lịch sử hội thoại vào prompt (cấm bịa số liệu)
  └─ 4. Generation: Gemini hiểu ý người dùng và quyết định
         ├─ câu tuyển sinh  → trả lời từ tài liệu, kèm nguồn
         ├─ chào hỏi, cảm xúc, câu mơ hồ → trò chuyện tự nhiên, hỏi lại, gợi ý chủ đề
         └─ câu lạc đề      → lịch sự từ chối, mời hỏi về tuyển sinh
     Gemini lỗi / quá thời gian → mô hình học máy trả lời (câu lạc đề thì từ chối)
```

- **Mô hình học máy** (`bot.js`): tách từ tiếng Việt (có dấu và không dấu), vector hóa TF-IDF từ đơn + cặp từ, phân loại ý định bằng KNN (cosine). Dùng để truy xuất tài liệu cho Gemini và trả lời dự phòng; ở chế độ dự phòng, câu hỏi bị coi là ngoài phạm vi khi độ khớp < 0,3 hoặc độ phủ từ vựng ≤ 50%.
- **Dữ liệu huấn luyện** (`data/knowledge.json`): 29 ý định, 383 câu mẫu, 14 đoạn tài liệu RAG.
- **LLM**: Google Gemini (`gemini-3.5-flash-lite`), gọi phía server nên API key không lộ ra trình duyệt.

---

## 2. Trang admin cập nhật dữ liệu

Mở `/admin`, đăng nhập bằng mật khẩu quản trị (`ADMIN_PASSWORD`), rồi **kéo thả file**. Không cần theo template.

| Loại file | Chatbot dùng như thế nào |
|---|---|
| Word `.docx`, PDF có lớp chữ, PowerPoint `.pptx`, `.txt`, `.md` | Lấy chữ, cắt thành đoạn ~900 ký tự để tra cứu (RAG) |
| Excel/CSV thường | Mỗi dòng thành một đoạn dạng `Tên cột: giá trị; …` |
| Excel/CSV có cột hỏi + cột trả lời (`Câu hỏi/Trả lời`, `Hỏi/Đáp`, `Q/A`…) | Mỗi dòng thành một **ý định mới**, bot được huấn luyện lại ngay. Cột `Cách hỏi khác` (ngăn cách bằng `;`) là tùy chọn |

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
| Lưu dữ liệu upload | Netlify Blobs (key–value); chạy local thì lưu `data/uploads.json` |
| LLM | Google Gemini API |
| Đọc file (trang admin) | SheetJS, mammoth, pdf.js, JSZip (tải từ CDN) |

## Cấu trúc thư mục

```
├── index.html                 Giao diện chatbot
├── admin.html                 Trang admin upload dữ liệu
├── bot.js                     Mô hình học máy: tiền xử lý, huấn luyện, phân loại, truy xuất (dùng cả FE và BE)
├── rag.js                     Pipeline LLM + RAG gọi Gemini
├── store.js                   Lưu/đọc dữ liệu upload, API quản trị, kiểm tra mật khẩu
├── server.js                  Server chạy local (port 8088)
├── netlify/functions/
│   ├── chat.mjs               POST /api/chat
│   ├── kb.mjs                 GET  /api/kb   (tri thức hiện tại)
│   └── admin.mjs              GET/POST/DELETE /api/admin
├── data/knowledge.json        Dữ liệu huấn luyện gốc + tài liệu RAG
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

Không có `GEMINI_API_KEY` thì chatbot vẫn chạy, trả lời bằng mô hình học máy.

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

Kéo thả thư mục lên Netlify Drop **không** chạy được Functions, nên phần AI và trang admin sẽ không hoạt động; cần deploy bằng CLI hoặc kết nối repo GitHub.

## Biến môi trường

| Biến | Bắt buộc | Ý nghĩa |
|---|---|---|
| `GEMINI_API_KEY` | Không (thiếu thì chỉ dùng học máy) | API key Google AI Studio |
| `GEMINI_MODEL` | Không | Mặc định `gemini-3.5-flash-lite` |
| `GEMINI_TIMEOUT_MS` | Không | Thời gian chờ Gemini, mặc định 45000 |
| `ADMIN_PASSWORD` | Có (cho trang admin) | Mật khẩu trang quản trị |

## Kiểm thử

`npm test` chạy 37 câu hỏi mẫu (đúng ý định, từ chối câu lạc đề và nhạy cảm, gõ không dấu), kiểm tra dữ liệu upload được huấn luyện/tra cứu và chặn sai mật khẩu admin.

## Hướng phát triển
- Thay TF-IDF bằng embedding + Vector DB để hiểu nghĩa tốt hơn.
- GraphRAG cho câu hỏi cần liên kết nhiều thông tin.
- Đọc PDF scan bằng OCR; kết nối Zalo/Messenger.
