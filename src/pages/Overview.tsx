import type { ConsoleHealth } from '../api'
import type { Tab } from '../components/Shell'
import { Badge, Block, ErrorBanner, PageShell, type BadgeTone } from '../components/ui'
import { formatRelativeTime } from '../format'

/**
 * 概览只放两件事：四个域**接没接上**，以及一条接口可用性汇总。
 * 逐条探活（延迟 / 会话可用率 / 验到哪一层）在「接口可用性」页，
 * 这里不再复制一份表格 —— 同一份信息出现两次，只会让两边都看不过来。
 */
const SOURCES: { key: string; tab: Tab; label: string; hint: string }[] = [
  { key: 'evidence', tab: 'evidence', label: '证据', hint: 'wist-evidence · 索引与正文' },
  { key: 'atlas', tab: 'topology', label: '资产拓扑', hint: 'wist-atlas · 主机 / 服务 / 进程' },
  { key: 'metrics', tab: 'metrics', label: '运行指标', hint: 'VictoriaMetrics · 计数与采集健康' },
  { key: 'devices', tab: 'devices', label: '安全设备', hint: '封堵能力与生效验证' },
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
  const checked = interfaces.filter((entry) => entry.status !== 'not_configured')
  const available = checked.filter((entry) => entry.status === 'ok').length
  const latestCheck = interfaces.reduce<number | null>((latest, entry) => {
    if (entry.checked_at_ms === undefined) return latest
    return latest === null || entry.checked_at_ms > latest ? entry.checked_at_ms : latest
  }, null)

  return (
    <PageShell title="概览" summary="计算区只读视图：四个域各自接没接上；逐条探活看「接口可用性」。">
      <Block wide>
        <div className="stack">
          {error ? <ErrorBanner>{error}</ErrorBanner> : null}

          <div className="tiles">
            {SOURCES.map((source) => {
              const state = health?.sources?.[source.key]
              const status = state?.status ?? (health ? 'unavailable' : 'unknown')
              return (
                <button
                  key={source.key}
                  type="button"
                  className="tile"
                  onClick={() => onNavigate(source.tab)}
                  title={`打开${source.label}`}
                >
                  <span className="tile__head">
                    <span className="tile__label">{source.label}</span>
                    <Badge tone={toneFor(status)}>{labelFor(status)}</Badge>
                  </span>
                  <span className="tile__detail">{state?.detail ?? source.hint}</span>
                </button>
              )
            })}
          </div>

          <div className="statusline">
            <span className="statusline__label">接口可用性</span>
            <Badge tone={health ? (available === checked.length ? 'green' : 'red') : 'gray'}>
              {health ? `${available}/${checked.length} 可用` : '未连上 BFF'}
            </Badge>
            {latestCheck !== null ? (
              <span className="statusline__note">最近检查 {formatRelativeTime(latestCheck)}</span>
            ) : null}
            <button
              type="button"
              className="button button--ghost button--sm"
              onClick={() => onNavigate('health')}
            >
              查看逐条探活
            </button>
          </div>
        </div>
      </Block>
    </PageShell>
  )
}
