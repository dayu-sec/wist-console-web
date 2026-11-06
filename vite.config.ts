import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// 开发态把 /api 代理到本机的 `wist-field-api`（BFF），/atlas 代理到本机的 atlas-web。
// 容器里由 nginx 完成同样的反代（见 nginx.conf）。
const apiTarget = process.env.VITE_CONSOLE_API_TARGET ?? 'http://127.0.0.1:19200'
const atlasTarget = process.env.VITE_ATLAS_DEV_URL ?? 'http://127.0.0.1:18080'

export default defineConfig({
  plugins: [react()],
  // 版本号来自 Dockerfile 的 `ARG APP_VERSION`（`VITE_APP_VERSION`）；本地构建回落 dev。
  define: {
    __APP_VERSION__: JSON.stringify(process.env.VITE_APP_VERSION ?? 'dev'),
  },
  server: {
    port: 5175,
    proxy: {
      '/api': apiTarget,
      // 生产里 atlas 挂在 `/atlas/`（同源反代）；开发态同样透传，避免两套 URL 形状。
      '/atlas': atlasTarget,
    },
  },
})
