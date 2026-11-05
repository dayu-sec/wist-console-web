import { useEffect, useState } from 'react'
import type { ConsoleHealth, InterfaceState } from '../api'
import { Badge, Block, Card, Empty, ErrorBanner, InfoBanner, PageShell, type BadgeTone } from '../components/ui'
import { formatRelativeTime } from '../format'

/** 一次检查的样本，只在本次会话里有（刷新页面就重来，不做持久化）。 */
interface Sample {
  at: number
  ok: boolean
  latencyMs: number | null
}

const HISTORY_LIMIT = 30

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

/**
 * 接口的**完整地址**。
 *
 * `health.interfaces[].url` 是 BFF 实际打的**探活地址**（写端点打 `/healthz`、
 * 指标存储打 `/health`），不等于接口本身 —— 只看到 `/healthz` 等于没看到地址。
 * 这里按各接口的契约路径补回真实地址，探活地址在下面单独一行展示。
 */
function interfaceAddress(item: InterfaceState): string | null {
  if (!item.url) return null
  switch (item.id) {
    case 'evidence_read':
      // 探活多带一个 `?limit=1`，接口地址是去掉查询的那一段。
      return item.url.split('?')[0]
    case 'evidence_write':
      // 探活打 `/healthz`；真正的写接口是 `/internal/evidence`。
      return item.url.replace(/\/healthz$/, '/internal/evidence')
    case 'atlas':
      // 探活打 `/healthz`；atlas 的读接口都在 `/api/*` 下（写端点是 `/internal/atlas`）。
      return item.url.replace(/\/healthz$/, '/api')
    case 'metrics':
      // 探活打 `/health`；接口地址就是 VictoriaMetrics 的查询基址。
      return item.url.replace(/\/health$/, '')
    default:
      return item.url
  }
}

function averageLatency(samples: Sample[]): number | null {
  const values = samples.map((sample) => sample.latencyMs).filter((value): value is number => value !== null)
  if (values.length === 0) return null
  return Math.round(values.reduce((sum, value) => sum + value, 0) / values.length)
}

function Uptime({ samples }: { samples: Sample[] }) {
  if (samples.length === 0) return <span className="text-muted">—</span>
  const ok = samples.filter((sample) => sample.ok).length
  const average = averageLatency(samples)
  return (
    <div className="uptime">
      <div className="uptime__bar" aria-hidden="true">
        {samples.map((sample, index) => (
          <span
            key={`${sample.at}-${index}`}
            className={`uptime__tick uptime__tick--${sample.ok ? 'ok' : 'bad'}`}
            title={`${new Date(sample.at).toLocaleTimeString('zh-CN', { hour12: false })} · ${
              sample.ok ? '可用' : '不可用'
            }${sample.latencyMs === null ? '' : ` · ${sample.latencyMs} ms`}`}
          />
        ))}
      </div>
      <span className="uptime__text">
        {ok}/{samples.length} 次可用
        {average === null ? '' : ` · 均值 ${average} ms`}
      </span>
    </div>
  )
}

export function HealthPage({
  health,
  error,
  syncing,
  lastSyncedAt,
  onRefresh,
}: {
  health: ConsoleHealth | null
  error: string | null
  syncing: boolean
  lastSyncedAt: number | null
  onRefresh: () => void
}) {
  const [history, setHistory] = useState<Record<string, Sample[]>>({})

  // 每次拿到新的检查结果就追加一条；`not_configured` 不算检查，不进历史。
  useEffect(() => {
    if (!health?.interfaces) return
    const at = Date.now()
    setHistory((previous) => {
      const next: Record<string, Sample[]> = { ...previous }
      for (const item of health.interfaces ?? []) {
        if (item.status === 'not_configured') continue
        const samples = next[item.id] ?? []
        next[item.id] = [
          ...samples,
          { at, ok: item.status === 'ok', latencyMs: item.latency_ms ?? null },
        ].slice(-HISTORY_LIMIT)
      }
      return next
    })
  }, [health])

  const interfaces = health?.interfaces ?? []
  const checked = interfaces.filter((item) => item.status !== 'not_configured')
  const available = checked.filter((item) => item.status === 'ok').length
  const overall: BadgeTone = !health ? 'gray' : available === checked.length ? 'green' : 'red'

  return (
    <PageShell
      title="接口可用性"
      summary="从计算区这边逐条打过去，看每条接口此刻通不通。每 30 秒自动检查一次，也可以手动立即检查。"
      actions={
        <button type="button" className="button button--ghost button--sm" onClick={onRefresh} disabled={syncing}>
          {syncing ? '检查中…' : '立即检查'}
        </button>
      }
    >
      <Block wide>
        {error ? <ErrorBanner>{error}</ErrorBanner> : null}

        <Card
          title="本轮结果"
          subtitle={
            lastSyncedAt
              ? `最近一次检查：${new Date(lastSyncedAt).toLocaleTimeString('zh-CN', { hour12: false })}`
              : '还没有检查过'
          }
          aside={
            <Badge tone={overall}>
              {health ? `${available}/${checked.length} 可用` : '未连上 BFF'}
            </Badge>
          }
        >
          {interfaces.length === 0 ? (
            <Empty
              title="还没有检查结果"
              hint="点右上角「立即检查」；如果一直为空，先确认页面本身能连上 console BFF。"
            />
          ) : (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>接口</th>
                    <th>状态</th>
                    <th>延迟</th>
                    <th>本次会话</th>
                    <th>最近检查</th>
                  </tr>
                </thead>
                <tbody>
                  {interfaces.map((item: InterfaceState) => {
                    const address = interfaceAddress(item)
                    return (
                      <tr key={item.id}>
                        <td>
                          <strong>{item.label}</strong>
                          {address ? (
                            <div className="table__address" title={address}>
                              {address}
                            </div>
                          ) : null}
                          {item.url && item.url !== address ? (
                            <div className="table__meta">探活 {item.url}</div>
                          ) : null}
                          {item.covers ? <div className="table__meta">{item.covers}</div> : null}
                        </td>
                        <td>
                          <Badge tone={toneFor(item.status)}>{labelFor(item.status)}</Badge>
                          {item.detail ? <div className="table__error">{item.detail}</div> : null}
                        </td>
                        <td>{item.latency_ms === undefined ? '—' : `${item.latency_ms} ms`}</td>
                        <td>
                          <Uptime samples={history[item.id] ?? []} />
                        </td>
                        <td>{formatRelativeTime(item.checked_at_ms)}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        <InfoBanner tone="info">
          「本次会话」的可用率只统计这个页面打开之后的检查（最多 30 次），刷新页面会重来 ——
          这里是现场自查，不是长期趋势；历史趋势要等运行指标接了平台侧聚合。
        </InfoBanner>
      </Block>
    </PageShell>
  )
}
