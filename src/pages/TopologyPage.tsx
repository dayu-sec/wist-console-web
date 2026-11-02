import { InfoBanner, PageShell } from '../components/ui'

/**
 * 资产拓扑：**不重写** atlas 的画布，直接同源嵌入 `/atlas/`。
 *
 * 前提（见 README「atlas 嵌入」）：
 * - `wist-atlas-web` 需要用 `base: '/atlas/'` 构建（否则它的 `/assets/*` 会打到本域名根）；
 * - 两侧同一入口（VPN / 堡垒机）与同一套 mTLS 身份，不做跨域 iframe。
 */
export function TopologyPage() {
  return (
    <PageShell
      title="资产拓扑"
      summary="主机 / 服务 / 进程关系由 wist-atlas 提供；这里只做同源嵌入与深链，不复制它的交互。"
    >
      <InfoBanner>
        `wist-atlas-web` 需以 <code className="mono">base=&quot;/atlas/&quot;</code> 构建，并由本容器
        反代（nginx <code className="mono">location /atlas/</code>）。未接入时下面的 frame 会是 404 —— 那是
        配置问题，不是页面坏了。
      </InfoBanner>
      <iframe
        className="console-frame"
        src="/atlas/"
        title="wist-atlas 资产拓扑"
        referrerPolicy="no-referrer"
      />
    </PageShell>
  )
}
