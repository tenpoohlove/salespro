# p3 SalesPro — GCP Compute Engine VM 用（FR-SYS-001 / SDD §4）
FROM node:20-slim

# better-sqlite3 ビルド用
RUN apt-get update && apt-get install -y python3 make g++ && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build

# 永続データ（GCP VMの永続ディスクにマウント想定）
ENV DB_PATH=/var/p3/data.db
ENV AUDIO_DIR=/var/p3/audio
ENV PORT=3000
# 声クローンは既定off（検証後に有効化）
ENV FEATURE_VOICE_CLONE=false
# ※ APIキーは .env に書かない（全てBYOK）

EXPOSE 3000
CMD ["node", "dist/server.js"]
