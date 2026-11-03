# Chatbot tư vấn tuyển sinh ĐHTX UTT – chạy server Node (trang chat + trang admin + API) trên cổng 8088.
# Không đóng gói bí mật: truyền GEMINI_API_KEY, ADMIN_PASSWORD bằng -e hoặc --env-file khi chạy.
FROM node:22-alpine

WORKDIR /app
ENV NODE_ENV=production PORT=8088 UPLOADS_FILE=/app/uploads/uploads.json

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY index.html admin.html bot.js rag.js store.js vectors.js server.js ./
COPY data/knowledge.json data/knowledge.json

# Dữ liệu upload từ trang admin -> /app/uploads; gắn volume vào đây để không mất khi tạo lại container.
RUN mkdir -p /app/uploads && chown node:node /app/uploads
VOLUME /app/uploads
USER node

EXPOSE 8088
CMD ["node", "server.js"]
