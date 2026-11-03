// /api/admin: GET danh sách, POST thêm tài liệu, DELETE ?id= xóa. Cần header x-admin-password.
import store from "../../store.js";

export default async (req) => {
  const body = req.method === "POST" ? await req.text() : "";
  const id = new URL(req.url).searchParams.get("id");
  const r = await store.adminApi(req.method, body, id, req.headers.get("x-admin-password"));
  return Response.json(r.json, { status: r.status });
};

export const config = { path: "/api/admin" };
