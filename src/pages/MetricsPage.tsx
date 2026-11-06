import { useCallback, useEffect, useState } from 'react'
import {
  ApiError,
  getMetrics,
  getMetricsHistory,
  type MetricsAgent,
  type MetricsAgentHistory,
  type MetricsCatalogEntry,
  type MetricsHistorySeries,
  type MetricsOverview,
} from '../api'
import { formatBytes, formatRelativeTime } from '../format'
import {
  Badge,
  Block,
  Card,
  Empty,
  ErrorBanner,
  InfoBanner,
  PageShell,
  type BadgeTone,
} from '../components/ui'

/** 趋势窗口：只给三档 —— 页面是「现在有没有在跳」，不是长期容量分析。 */
const WINDOWS = [
  { seconds: 900, label: '15 分钟' },
  { seconds: 3_600, label: '1 小时' },
  { seconds: 21_600, label: '6 小时' },
]

const REFRESH_MS = 30_000

function errorText(err: unknown): string {
  return err instanceof ApiError ? `${err.message}（${err.code}）` : String(err)
}

function formatValue(value: number | null, unit: string): string {
  if (value === null || !Number.isFinite(value)) return '—'
  switch (unit) {
    case 'percent':
      return `${value.toFixed(2)}%`
    case 'bytes':
      return formatBytes(value)
    case 'milliseconds':
      return `${value.toFixed(1)} ms`
    default:
      return Number.isInteger(value) ? String(value) : value.toFixed(2)
  }
}

/** 采集是否在跳：窗口内一个样本都没有 = 静默（不是「值为 0」）。 */
function reportingState(agent: MetricsAgent): { tone: BadgeTone; label: string } {
  if (agent.samples > 0) return { tone: 'green', label: '在报' }
  // 有序列但窗口内没有新样本：典型是 agent 停了 / 链路断了，老序列还在存储里。
  if (agent.series > 0) return { tone: 'amber', label: '静默' }
  return { tone: 'gray', label: '无序列' }
}

/**
 * 一条指标的趋势图。
 *
 * 手写 SVG 而不是引图表库：这里只要「有没有断、大概什么形状」，
 * 一个 `polyline` 足够，省下一个几百 KB 的依赖。
 */
function Chart({ item, windowSeconds }: { item: MetricsHistorySeries; windowSeconds: number }) {
  const values = item.points.map((point) => point[1])
  if (values.length === 0) {
    return (
      <div className="chart">
        <div className="chart__head">
          <span className="chart__title">{item.title}</span>
        </div>
        <Empty title="窗口内没有样本" hint="这台 agent 在这段时间没有上报这条指标。" />
      </div>
    )
  }

  const width = 240
  const height = 64
  const pad = 3
  const latest = values[values.length - 1]
  const min = Math.min(...values)
  const max = Math.max(...values)
  const span = max - min || 1
  const step = values.length > 1 ? width / (values.length - 1) : width
  const y = (value: number) => height - pad - ((value - min) / span) * (height - 2 * pad)
  const line = values
    .map((value, index) => `${index === 0 ? 'M' : 'L'}${(index * step).toFixed(1)},${y(value).toFixed(1)}`)
    .join(' ')
  // 收尾到基线，做成面积图：单线条在小尺寸下很难看清「有没有断」。
  const area = `${line} L${((values.length - 1) * step).toFixed(1)},${height} L0,${height} Z`

  return (
    <div className="chart">
      <div className="chart__head">
        <span className="chart__title">{item.title}</span>
        <span className="chart__value">{formatValue(latest, item.unit)}</span>
      </div>
      <svg
        className="chart__svg"
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="none"
        role="img"
        aria-label={`${item.title}：窗口 ${windowSeconds} 秒，最低 ${formatValue(min, item.unit)}，最高 ${formatValue(max, item.unit)}`}
      >
        <path className="chart__area" d={area} />
        <path className="chart__line" d={line} />
      </svg>
      <div className="chart__foot">
        <span>低 {formatValue(min, item.unit)}</span>
        <span>高 {formatValue(max, item.unit)}</span>
        <span>{values.length} 点</span>
      </div>
    </div>
  )
}

function LabelChips({ labels }: { labels: Record<string, string> }) {
  const entries = Object.entries(labels).sort(([left], [right]) => left.localeCompare(right))
  if (entries.length === 0) return null
  return (
    <div className="chips">
      {entries.map(([key, value]) => (
        <span key={key} className="chip">
          {key}=<strong>{value}</strong>
        </span>
      ))}
    </div>
  )
}

/** 名字前缀分组：目录里 `system_*` 会占掉大半，分组后一眼能看出「哪几类在写」。 */
function CatalogGroup({ group, entries }: { group: string; entries: MetricsCatalogEntry[] }) {
  const series = entries.reduce((total, entry) => total + entry.series, 0)
  return (
    <details className="catalog-group" open={group === 'agent'}>
      <summary>
        <span className="catalog-group__name">{group}_*</span>
        <span className="catalog-group__meta">
          {entries.length} 个指标 · {series} 条序列
        </span>
      </summary>
      <ul className="catalog-list">
        {entries.map((entry) => (
          <li key={entry.name}>
            <code className="mono">{entry.name}</code>
            <span className="catalog-list__series">{entry.series}</span>
          </li>
        ))}
      </ul>
    </details>
  )
}

export function MetricsPage() {
  const [overview, setOverview] = useState<MetricsOverview | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [windowSeconds, setWindowSeconds] = useState(3_600)
  const [selected, setSelected] = useState<string | null>(null)
  const [history, setHistory] = useState<MetricsAgentHistory | null>(null)
  const [historyError, setHistoryError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const value = await getMetrics()
      setOverview(value)
      setError(null)
    } catch (err) {
      setOverview(null)
      setError(errorText(err))
    } finally {
      setLoading(false)
    }
  }, [])

  // 概览 30 秒一轮：这一页看的是「现在」，手动刷新只是不想等。
  useEffect(() => {
    void load()
    const timer = window.setInterval(() => void load(), REFRESH_MS)
    return () => window.clearInterval(timer)
  }, [load])

  const agents = overview?.agents ?? []
  // 选中的 agent 可能已经从存储里消失（换了环境 / 改名）：回落第一台，不留下空页。
  const activeAgentId =
    selected && agents.some((agent) => agent.agent_id === selected)
      ? selected
      : (agents[0]?.agent_id ?? null)

  const loadHistory = useCallback(async () => {
    if (!activeAgentId) {
      setHistory(null)
      setHistoryError(null)
      return
    }
    try {
      setHistory(await getMetricsHistory(activeAgentId, windowSeconds))
      setHistoryError(null)
    } catch (err) {
      setHistory(null)
      setHistoryError(errorText(err))
    }
  }, [activeAgentId, windowSeconds])

  useEffect(() => {
    void loadHistory()
    const timer = window.setInterval(() => void loadHistory(), REFRESH_MS)
    return () => window.clearInterval(timer)
  }, [loadHistory])

  const catalogGroups = new Map<string, MetricsCatalogEntry[]>()
  for (const entry of overview?.catalog ?? []) {
    const bucket = catalogGroups.get(entry.group) ?? []
    bucket.push(entry)
    catalogGroups.set(entry.group, bucket)
  }

  const activeAgent = agents.find((agent) => agent.agent_id === activeAgentId) ?? null
  // 请求回来之前，旧数据可能属于上一台 agent / 上一个窗口：不拿它凑数。
  const activeHistory =
    history &&
    history.agent_id === activeAgentId &&
    history.window_seconds === windowSeconds
      ? history
      : null

  return (
    <PageShell
      title="运行指标"
      summary="数据场里「强度」那一维：数据面把 agent 采集指标镜像进计算区 VictoriaMetrics（CONSOLE_VM_ENDPOINT），本页只读这一份。引擎/管道统计只写网关栈，不在这一页。"
      actions={
        <>
          <select
            aria-label="趋势窗口"
            value={windowSeconds}
            onChange={(event) => setWindowSeconds(Number(event.target.value))}
          >
            {WINDOWS.map((option) => (
              <option key={option.seconds} value={option.seconds}>
                近 {option.label}
              </option>
            ))}
          </select>
          <button
            type="button"
            className="button button--ghost"
            onClick={() => {
              void load()
              void loadHistory()
            }}
            disabled={loading}
          >
            {loading ? '加载中…' : '刷新'}
          </button>
        </>
      }
    >
      <Block wide>
        <div className="stack">
          {error ? (
            <ErrorBanner>
              {error}
              <span className="muted">
                {' '}
                —— 确认 console 栈的 <code className="mono">metrics</code> 起着，且数据面把
                <code className="mono">CONSOLE_VM_ENDPOINT</code> 指到了它。
              </span>
            </ErrorBanner>
          ) : null}

          <div className="metrics">
            <div className="metric">
              <span className="metric__label">指标名</span>
              <span className="metric__value">{overview?.totals.names ?? '—'}</span>
              <span className="metric__hint">存储里出现过的名字总数</span>
            </div>
            <div className="metric">
              <span className="metric__label">序列</span>
              <span className="metric__value">{overview?.totals.series ?? '—'}</span>
              <span className="metric__hint">
                本栈 VM 的全部序列；比网关栈少的那部分是只写那边的引擎统计
              </span>
            </div>
            <div className="metric">
              <span className="metric__label">在报 agent</span>
              <span className="metric__value">{overview?.totals.agents ?? '—'}</span>
              <span className="metric__hint">
                {overview
                  ? `最近一次刷新 ${formatRelativeTime(overview.generated_at_ms)}`
                  : '还没拿到数据'}
              </span>
            </div>
            <div className="metric">
              <span className="metric__label">采集窗口</span>
              <span className="metric__value">
                {overview ? overview.window_seconds / 60 : '—'}
                <span className="metric__unit">分钟</span>
              </span>
              <span className="metric__hint">窗口内没有样本 = 场缺一块，不是「值为 0」</span>
            </div>
          </div>

          {overview && agents.length === 0 ? (
            <Card title="Agent 自观测">
              <Empty
                title="还没有 agent 指标"
                hint="场是由采样重建的：数据面的 wparse 要把 `agent-metrics` 分组镜像到 `CONSOLE_VM_ENDPOINT`；只写网关栈那份时，这里会一直是空的。"
              />
            </Card>
          ) : null}

          {agents.length > 0 ? (
            <Card
              title="Agent 自观测"
              subtitle="点一行看趋势。CPU 是单核比例换算的百分比（1.0 = 占满一个核）。"
              aside={<Badge tone="blue">{agents.length} 台</Badge>}
            >
              <div className="table-wrap">
                <table className="table table--clickable">
                  <thead>
                    <tr>
                      <th>Agent</th>
                      <th>环境</th>
                      <th>CPU</th>
                      <th>内存</th>
                      <th>核数</th>
                      <th>管理面时延</th>
                      <th>采集</th>
                      <th>序列</th>
                      <th>状态</th>
                    </tr>
                  </thead>
                  <tbody>
                    {agents.map((agent) => {
                      const state = reportingState(agent)
                      return (
                        <tr
                          key={agent.agent_id}
                          className={
                            agent.agent_id === activeAgentId ? 'table__row--selected' : undefined
                          }
                          onClick={() => setSelected(agent.agent_id)}
                        >
                          <td>
                            <code className="mono">{agent.agent_id}</code>
                          </td>
                          <td>
                            {agent.labels.env ? (
                              <Badge tone="gray">{agent.labels.env}</Badge>
                            ) : (
                              <span className="muted">—</span>
                            )}
                          </td>
                          <td>{formatValue(agent.cpu_percent, 'percent')}</td>
                          <td>{formatValue(agent.memory_bytes, 'bytes')}</td>
                          <td>{agent.cpu_cores ?? '—'}</td>
                          <td>{formatValue(agent.admin_latency_ms, 'milliseconds')}</td>
                          <td>
                            {agent.samples}
                            <span className="muted"> 样本</span>
                          </td>
                          <td>{agent.series}</td>
                          <td>
                            <Badge tone={state.tone}>{state.label}</Badge>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </Card>
          ) : null}

          {activeAgent ? (
            <Card
              title="趋势"
              subtitle={
                <>
                  <code className="mono">{activeAgent.agent_id}</code> · 近{' '}
                  {WINDOWS.find((option) => option.seconds === windowSeconds)?.label ?? `${windowSeconds} 秒`}
                  {history
                    ? ` · 步长 ${history.step_seconds}s`
                    : ''}
                </>
              }
              aside={<LabelChips labels={activeAgent.labels} />}
            >
              {historyError ? <ErrorBanner>{historyError}</ErrorBanner> : null}
              {!activeHistory && !historyError ? <Empty title="正在取趋势…" /> : null}
              {activeHistory && activeHistory.series.length === 0 ? (
                <Empty
                  title="窗口内没有趋势数据"
                  hint="曲线要至少两个采样点；刚接入或采集静默时这里会是空的。"
                />
              ) : null}
              {activeHistory && activeHistory.series.length > 0 ? (
                <div className="charts">
                  {activeHistory.series.map((item) => (
                    <Chart key={item.metric} item={item} windowSeconds={windowSeconds} />
                  ))}
                </div>
              ) : null}
            </Card>
          ) : null}

          {overview && overview.catalog.length > 0 ? (
            <Card
              title="指标目录"
              subtitle="存储里实际存在的名字与序列数（按前缀分组）。用来确认「写进来了什么」，不做趋势。"
              aside={<Badge tone="gray">{overview.totals.series} 序列</Badge>}
            >
              <div className="catalog">
                {[...catalogGroups.entries()].map(([group, entries]) => (
                  <CatalogGroup key={group} group={group} entries={entries} />
                ))}
              </div>
            </Card>
          ) : null}

          <InfoBanner tone="info">
            两份 VictoriaMetrics 互不聚合：网关栈那份给控制面观测页（含引擎 / 管道统计
            <code className="mono"> wparse_*</code>），这一份只收数据面临摹的 agent 采集指标。
            所以这里的序列数少于网关栈是正常的，缺的正是引擎统计。
          </InfoBanner>
        </div>
      </Block>
    </PageShell>
  )
}
