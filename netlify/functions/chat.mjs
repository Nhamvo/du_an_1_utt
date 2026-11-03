// POST /api/chat -> pipeline LLM + RAG (key lấy từ biến môi trường của Netlify).
import rag from "../../rag.js";

export default async (req) => {
  if (req.method !== "POST") return Response.json({ error: "Chỉ hỗ trợ POST" }, { status: 405 });
  let input;
  try { input = await req.json(); } catch { return Response.json({ error: "JSON không hợp lệ" }, { status: 400 }); }
  return Response.json(await rag.chat(input.message, input.history));
};

export const config = { path: "/api/chat" };
