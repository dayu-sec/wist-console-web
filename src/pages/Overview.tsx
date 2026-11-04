import type { ConsoleHealth } from '../api'
import type { Tab } from '../components/Shell'
import { Badge, Block, Card, Empty, ErrorBanner, PageShell, type BadgeTone } from '../components/ui'
import { formatRelativeTime } from '../format'

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
    key: 'metrics',
    tab: 'metrics',
    label: '运行指标',
    hint: 'wparse 的来源/PARSE/输出计数与主机采集健康；现网 VM 在各网关栈，平台侧还没有聚合',
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
  const interfaces = health?.interfaces ?? []
  const checkedCount = interfaces.filter((entry) => entry.status !== 'not_configured').length
  const availableCount = interfaces.filter((entry) => entry.status === 'ok').length

  return (
    <PageShell
      title="概览"
      summary="星象台（只读）：证据、资产拓扑、运行指标、设备状态。每块都标了「数据从哪来、接没接上」。"
    >
      <Block wide>
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
          title="接口可用性"
          subtitle="逐条探活的一句话摘要；延迟、本次会话可用率、每条检查验了什么，在「接口可用性」页。"
          aside={
            <Badge tone={health ? (availableCount === checkedCount ? 'green' : 'red') : 'gray'}>
              {health ? `${availableCount}/${checkedCount} 可用` : '未连上 BFF'}
            </Badge>
          }
        >
          {interfaces.length === 0 ? (
            <Empty
              title="还没有探活结果"
              hint="等一次健康刷新；如果一直为空，先看页面顶部是不是连不上 console BFF。"
            />
          ) : (
            <div className="table-wrap">
              <table className="table">
                <tbody>
                  {interfaces.map((entry) => (
                    <tr key={entry.id}>
                      <td>
                        <strong>{entry.label}</strong>
                        {entry.detail ? <div className="table__error">{entry.detail}</div> : null}
                      </td>
                      <td>
                        <Badge tone={toneFor(entry.status)}>{labelFor(entry.status)}</Badge>
                      </td>
                      <td>{entry.latency_ms === undefined ? '—' : `${entry.latency_ms} ms`}</td>
                      <td>{formatRelativeTime(entry.checked_at_ms)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <button
            type="button"
            className="button button--ghost button--sm"
            onClick={() => onNavigate('health')}
          >
            打开接口可用性
          </button>
        </Card>

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
      </Block>
    </PageShell>
  )
}
