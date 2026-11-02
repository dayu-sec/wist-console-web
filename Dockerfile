# ===========================================================================
# wist-console-web — 计算区运维台（证据 / 资产拓扑 / 采集量 / 设备状态）
#
# 1. node 构建阶段：npm ci + npm run build → dist/
# 2. nginx 运行阶段：静态托管 + 同源反代（/api → console BFF，/atlas/ → atlas-web）
#
# 与 `wist-ingest-web` 同构：nginx.conf 打进镜像，栈只挂配置与证书。
# ===========================================================================

# ── 构建阶段 ──
FROM node:24-alpine AS builder
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
ARG APP_VERSION=dev
ENV VITE_APP_VERSION=${APP_VERSION}
RUN npm run build

# ── 运行阶段 ──
FROM nginx:alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=builder /app/dist /usr/share/nginx/html
EXPOSE 80
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -q -O /dev/null http://127.0.0.1/healthz || exit 1
