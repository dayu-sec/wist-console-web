import { defineConfig, type ProxyOptions } from 'vite'
import react from '@vitejs/plugin-react'

// 开发态把 /api 代理到 BFF、/atlas 代理到 atlas-web；容器里由 nginx 做同样的反代（见 nginx.conf）。
//
// 三种用法（`dev/dev-web.sh` 封装了前两种）：
//   1. 纯源码：`VITE_CONSOLE_API_TARGET` 指本机 `wist-field-api`（默认 127.0.0.1:19200）；
//   2. 站点栈：目标指站点入口 `https://<WEB_DOMAIN>:<WEB_HOST_PORT>` —— 证书是自签的，
//      所以 `secure` 跟着 target 前缀走（照抄 wist-cred-web 的做法）；
//   3. 令牌：`VITE_CONSOLE_DEV_TOKEN` 只在页面**没带** `Authorization` 时补，
//      所以令牌输入框 / 401 这些路径在 dev 里仍然是真的。
const apiTarget = process.env.VITE_CONSOLE_API_TARGET ?? 'http://127.0.0.1:19200'
const atlasTarget = process.env.VITE_ATLAS_DEV_URL ?? 'http://127.0.0.1:18080'
const devToken = process.env.VITE_CONSOLE_DEV_TOKEN ?? ''
const port = Number(process.env.VITE_CONSOLE_DEV_PORT ?? 5175)

/** 代理一条前缀；目标是站点入口（https + 自签证书）时不校验证书。 */
const proxy = (target: string): ProxyOptions => ({
  target,
  changeOrigin: true,
  secure: !target.startsWith('https://'),
  // 只在请求没带 Authorization 时补 dev 令牌：令牌输入框 / 401 这些路径在 dev 里仍然是真的。
  configure: (server) => {
    server.on('proxyReq', (outgoing, incoming) => {
      if (!devToken || incoming.headers.authorization) return
      outgoing.setHeader('authorization', `Bearer ${devToken}`)
    })
  },
})

export default defineConfig({
  plugins: [react()],
  // 版本号来自 Dockerfile 的 `ARG APP_VERSION`（`VITE_APP_VERSION`）；本地构建回落 dev。
  define: {
    __APP_VERSION__: JSON.stringify(process.env.VITE_APP_VERSION ?? 'dev'),
  },
  server: {
    port,
    proxy: {
      '/api': proxy(apiTarget),
      // 生产里 atlas 挂在 `/atlas/`（同源反代）；开发态同样透传，避免两套 URL 形状。
      '/atlas': proxy(atlasTarget),
    },
  },
})
