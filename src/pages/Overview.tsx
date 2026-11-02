import type { ConsoleHealth } from '../api'
import type { Tab } from '../components/Shell'
import { Badge, Card, ErrorBanner, PageShell, type BadgeTone } from '../components/ui'

const SOURCES: { key: string; tab: Tab; label: string; hint: string }[] = [
  {
    key: 'evidence',
    tab: 'evidence',
    label: '证据',
    hint: 'wist-evidence：索引在 PG，正文在 COS；BFF 只代签 60s URL',
  },
  {
    key: 'atlas',
    tab: 'topology',
    label: '资产拓扑',
    hint: 'wist-atlas：主机 / 服务 / 进程关系（同源嵌入 /atlas/）',
  },
  {
    key: 'pipeline',
    tab: 'pipeline',
    label: '采集量',
    hint: '各网关栈的 VictoriaMetrics；平台侧还没有聚合，这条未接入',
  },
  {
    key: 'devices',
    tab: 'devices',
    label: '安全设备',
    hint: 'containment_capabilities 尚未上报；先定「设备状态」的数据模型',
  },
]

function toneFor(status: string): BadgeTone {
  switch (status) {
    case 'ok':
      return 'green'
    case 'unavailable':
      return 'red'
    case 'not_configured':
      return 'gray'
    default:
      return 'amber'
  }
}

function labelFor(status: string): string {
  switch (status) {
    case 'ok':
      return '可用'
    case 'unavailable':
      return '不可用'
    case 'not_configured':
      return '未接入'
    default:
      return status
  }
}

export function OverviewPage({
  health,
  error,
  onNavigate,
}: {
  health: ConsoleHealth | null
  error: string | null
  onNavigate: (tab: Tab) => void
}) {
  return (
    <PageShell
      title="概览"
      summary="计算区运维台：证据、资产、采集量、设备状态。每块都标了「数据从哪来、接没接上」。"
    >
      {error ? <ErrorBanner>{error}</ErrorBanner> : null}

      <div className="grid">
        {SOURCES.map((source) => {
          const state = health?.sources?.[source.key]
          const status = state?.status ?? (health ? 'unavailable' : 'unknown')
          return (
            <Card
              key={source.key}
              title={source.label}
              subtitle={source.hint}
              aside={<Badge tone={toneFor(status)}>{labelFor(status)}</Badge>}
            >
              {state?.detail ? <p className="muted">{state.detail}</p> : null}
              <button
                type="button"
                className="button button--ghost button--sm"
                onClick={() => onNavigate(source.tab)}
              >
                打开
              </button>
            </Card>
          )
        })}
      </div>

      <Card
        title="这个台子不做什么"
        subtitle="边界写在 design/console/console-architecture.md；这三条守不住就会退化成第二个 center"
      >
        <ul className="bullets">
          <li>不落库证据正文 —— 正文只经 BFF 转发签名 URL 或流式读取，不在计算区之外落盘。</li>
          <li>不代替证据服务做判断 —— 租户、敏感度、保留期由证据服务裁决，BFF 只透传。</li>
          <li>不成为新的账号体系 —— 身份来自入口（VPN / 堡垒机）与 mTLS，不在本台另建用户。</li>
        </ul>
      </Card>
    </PageShell>
  )
}
