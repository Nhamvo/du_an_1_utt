// GET /api/kb -> tri thức hiện tại (file gốc + dữ liệu admin upload) cho mô hình chạy trên trình duyệt.
import rag from "../../rag.js";

export default async () => Response.json(await rag.getKb(), { headers: { "Cache-Control": "no-store" } });

export const config = { path: "/api/kb" };
