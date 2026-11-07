import { useCallback, useEffect, useState } from 'react'
import {
  ApiError,
  getMetrics,
  getMetricsHistory,
  type MetricsAgent,
  type MetricsAgentHistory,
  type MetricsBusiness,
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

/** 中间件层的指标名前缀：有契约（见 `wist-metrics` 的 spec 表），等 agentd 开 provider。 */
const MIDDLEWARE_GROUPS = ['container', 'kafka']

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

/** 运行时长：`3 天 4 小时` / `4 小时 12 分` / `12 分`。 */
function formatUptime(seconds: number | null): string {
  if (seconds === null || !Number.isFinite(seconds)) return '—'
  const total = Math.floor(seconds)
  const days = Math.floor(total / 86_400)
  const hours = Math.floor((total % 86_400) / 3_600)
  const minutes = Math.floor((total % 3_600) / 60)
  if (days > 0) return `${days} 天 ${hours} 小时`
  if (hours > 0) return `${hours} 小时 ${minutes} 分`
  return `${minutes} 分`
}

/**
 * 把若干台的同一个字段加起来。
 *
 * `null` 与 `0` 是两回事：一台都没报这个维度时保持 `null`（页面显示「—」），
 * 而不是伪装成「合计为 0」。
 */
function sumDefined(
  agents: MetricsAgent[],
  pick: (agent: MetricsAgent) => number | null,
): number | null {
  let total: number | null = null
  for (const agent of agents) {
    const value = pick(agent)
    if (value === null || !Number.isFinite(value)) continue
    total = (total ?? 0) + value
  }
  return total
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

/** 服务层的一行：按 `app`（用途）分组后的一组实例。 */
interface ServiceRow {
  app: string
  hosts: number
  reporting: number
  processes: number | null
  cpuPercent: number | null
  memoryBytes: number | null
  series: number
}

/** 服务层：`app` 表达用途，同一用途可能落在多台主机上。 */
function serviceRows(agents: MetricsAgent[]): ServiceRow[] {
  const groups = new Map<string, MetricsAgent[]>()
  for (const agent of agents) {
    const app = agent.labels.app ?? ''
    const bucket = groups.get(app) ?? []
    bucket.push(agent)
    groups.set(app, bucket)
  }
  return [...groups.entries()]
    .map(([app, members]) => ({
      app,
      hosts: members.length,
      reporting: members.filter((agent) => agent.samples > 0).length,
      processes: sumDefined(members, (agent) => agent.host.processes),
      cpuPercent: sumDefined(members, (agent) => agent.cpu_percent),
      memoryBytes: sumDefined(members, (agent) => agent.memory_bytes),
      series: members.reduce((total, agent) => total + agent.series, 0),
    }))
    .sort((left, right) => right.hosts - left.hosts || left.app.localeCompare(right.app))
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

  const business = overview?.business ?? []
  const unassigned = overview?.unassigned_agents ?? []
  const services = serviceRows(agents)
  const middleware = (overview?.catalog ?? []).filter((entry) =>
    MIDDLEWARE_GROUPS.includes(entry.group),
  )
  const hostsWithFacts = agents.filter((agent) => agent.host.hostname || agent.host.load_1m !== null)

  return (
    <PageShell
      title="运行指标"
      summary="四层看这一片的「强度」：业务 → 服务 → 中间件 → 计算资源。数据面把指标镜像进计算区 VictoriaMetrics（CONSOLE_VM_ENDPOINT），本页只读这一份；引擎/管道统计只写网关栈，所以这里的序列数少于控制面那份。"
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
                —— 确认计算区的 <code className="mono">metrics</code> 起着，且数据面把
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

          {overview ? (
            <Card
              title="1 · 业务层"
              subtitle={
                <>
                  一个「命名的逻辑单元」。归属关系来自 <code className="mono">field-api.toml</code> 的{' '}
                  <code className="mono">[[business.units]]</code>，不是指标 label —— 改归属不用重启数据面。
                  内存 / 进程求和，负载与磁盘取峰值（它们本来就是单机口径）。
                </>
              }
              aside={<Badge tone="blue">{business.length} 个业务</Badge>}
            >
              {business.length === 0 ? (
                <Empty
                  title="还没有配置业务单元"
                  hint="在 field-api.toml 里加 [[business.units]]，把 agent 主机集合归到一个业务；一台主机只能属于一个业务，否则投入会重复计账。"
                />
              ) : (
                <div className="table-wrap">
                  <table className="table">
                    <thead>
                      <tr>
                        <th>业务</th>
                        <th>主机</th>
                        <th>负载 1m 峰值</th>
                        <th>内存</th>
                        <th>磁盘峰值</th>
                        <th>进程</th>
                        <th>采集目标</th>
                        <th>序列</th>
                      </tr>
                    </thead>
                    <tbody>
                      {business.map((unit) => (
                        <BusinessRowView key={unit.id} unit={unit} />
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              {unassigned.length > 0 ? (
                <div className="chips">
                  <span className="chip">
                    未归类 <strong>{unassigned.length}</strong> 台
                  </span>
                  {unassigned.map((agentId) => (
                    <span key={agentId} className="chip">
                      <code className="mono">{agentId}</code>
                    </span>
                  ))}
                </div>
              ) : null}
            </Card>
          ) : null}

          {agents.length > 0 ? (
            <Card
              title="2 · 服务层"
              subtitle="按 `app`（用途）分组：一条服务落在几台主机、占多少 CPU / 内存、多少进程。点下面的主机看趋势。"
              aside={<Badge tone="blue">{services.length} 条服务</Badge>}
            >
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th>服务（app）</th>
                      <th>主机</th>
                      <th>在报</th>
                      <th>CPU</th>
                      <th>内存</th>
                      <th>进程</th>
                      <th>序列</th>
                    </tr>
                  </thead>
                  <tbody>
                    {services.map((service) => (
                      <tr key={service.app || '(未标注)'}>
                        <td>
                          {service.app ? (
                            <code className="mono">{service.app}</code>
                          ) : (
                            <span className="muted">未标注 app</span>
                          )}
                        </td>
                        <td>{service.hosts}</td>
                        <td>
                          <Badge tone={service.reporting > 0 ? 'green' : 'amber'}>
                            {service.reporting}/{service.hosts}
                          </Badge>
                        </td>
                        <td>{formatValue(service.cpuPercent, 'percent')}</td>
                        <td>{formatValue(service.memoryBytes, 'bytes')}</td>
                        <td>{service.processes === null ? '—' : Math.round(service.processes)}</td>
                        <td>{service.series}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          ) : null}

          {agents.length > 0 ? (
            <Card
              title="采集服务（agent 自观测）"
              subtitle="服务层里「采集」这一侧自己的开销：CPU 是单核比例换算的百分比（1.0 = 占满一个核）。点一行看趋势。"
              aside={<Badge tone="gray">{agents.length} 个 agent</Badge>}
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

          {agents.length > 0 ? (
            <Card
              title="3 · 中间件层"
              subtitle="数据库 / 消息队列这类「服务之间的那一层」。指标名前缀 container_* / kafka_* 已有契约（wist-metrics 的 spec 表），等 agentd 开对应 provider。"
              aside={<Badge tone="gray">{middleware.length} 个指标</Badge>}
            >
              {middleware.length === 0 ? (
                <Empty
                  title="中间件层还没有数据"
                  hint="契约在、采集没开：需要 agentd 打开 DB / Kafka provider。在这一层出现之前，中间件的开销会混在计算资源层里看不出来。"
                />
              ) : (
                <div className="table-wrap">
                  <table className="table">
                    <thead>
                      <tr>
                        <th>指标</th>
                        <th>分组</th>
                        <th>序列</th>
                      </tr>
                    </thead>
                    <tbody>
                      {middleware.map((entry) => (
                        <tr key={entry.name}>
                          <td>
                            <code className="mono">{entry.name}</code>
                          </td>
                          <td>
                            <Badge tone="gray">{entry.group}</Badge>
                          </td>
                          <td>{entry.series}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Card>
          ) : null}

          {hostsWithFacts.length > 0 ? (
            <Card
              title="4 · 计算资源层"
              subtitle="宿主侧（system_* / process_*）：负载、内存、磁盘与最紧张的挂载点。业务层的负载 / 磁盘峰值就取自这里。点行同样看趋势。"
              aside={<Badge tone="blue">{agents.length} 台</Badge>}
            >
              <div className="table-wrap">
                <table className="table table--clickable">
                  <thead>
                    <tr>
                      <th>主机</th>
                      <th>负载 1m / 5m / 15m</th>
                      <th>内存</th>
                      <th>磁盘（系统盘）</th>
                      <th>最紧张挂载点</th>
                      <th>运行时长</th>
                      <th>进程</th>
                    </tr>
                  </thead>
                  <tbody>
                    {agents.map((agent) => {
                      const host = agent.host
                      const load = (value: number | null) => (value === null ? '—' : value.toFixed(2))
                      return (
                        <tr
                          key={agent.agent_id}
                          className={
                            agent.agent_id === activeAgentId ? 'table__row--selected' : undefined
                          }
                          onClick={() => setSelected(agent.agent_id)}
                        >
                          <td>
                            <strong>{host.hostname ?? <span className="muted">—</span>}</strong>
                            <div className="table__meta">
                              {host.ip_addresses.length > 0 ? host.ip_addresses.join(', ') : agent.agent_id}
                            </div>
                            {host.os ? (
                              <div className="table__meta">
                                {host.os}
                                {host.arch ? ` / ${host.arch}` : ''}
                              </div>
                            ) : null}
                          </td>
                          <td>
                            {load(host.load_1m)} / {load(host.load_5m)} / {load(host.load_15m)}
                          </td>
                          <td>
                            {formatValue(host.memory_usage_percent, 'percent')}
                            {host.memory_total_bytes !== null ? (
                              <div className="table__meta">
                                可用 {formatBytes(host.memory_available_bytes)} / 共{' '}
                                {formatBytes(host.memory_total_bytes)}
                              </div>
                            ) : null}
                          </td>
                          <td>
                            {formatValue(host.disk_usage_percent, 'percent')}
                            {host.disk_total_bytes !== null ? (
                              <div className="table__meta">共 {formatBytes(host.disk_total_bytes)}</div>
                            ) : null}
                          </td>
                          <td>
                            {host.filesystem_usage_percent === null ? (
                              '—'
                            ) : (
                              <>
                                {formatValue(host.filesystem_usage_percent, 'percent')}
                                <div className="table__meta">
                                  <code className="mono">{host.filesystem_mount ?? '—'}</code>
                                </div>
                              </>
                            )}
                          </td>
                          <td>{formatUptime(host.uptime_seconds)}</td>
                          <td>{host.processes === null ? '—' : Math.round(host.processes)}</td>
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

/** 业务层的一行。`agents_missing` 是有话要说的：配置里有、存储里没有。 */
function BusinessRowView({ unit }: { unit: MetricsBusiness }) {
  return (
    <tr>
      <td>
        <strong>{unit.name}</strong>
        {unit.name !== unit.id ? <div className="table__meta">{unit.id}</div> : null}
      </td>
      <td>
        {unit.agents_present}
        {unit.agents.length > 0 ? <span className="muted">/{unit.agents.length}</span> : null}
        {unit.agents_reporting !== unit.agents_present ? (
          <div className="table__meta">在报 {unit.agents_reporting}</div>
        ) : null}
        {unit.agents_missing.length > 0 ? (
          <div className="table__meta">
            缺 <code className="mono">{unit.agents_missing.join(', ')}</code>
          </div>
        ) : null}
      </td>
      <td>{unit.load_1m_max === null ? '—' : unit.load_1m_max.toFixed(2)}</td>
      <td>
        {formatValue(unit.memory_used_bytes, 'bytes')}
        {unit.memory_total_bytes !== null ? (
          <div className="table__meta">共 {formatBytes(unit.memory_total_bytes)}</div>
        ) : null}
      </td>
      <td>{formatValue(unit.disk_usage_max, 'percent')}</td>
      <td>{unit.processes === null ? '—' : Math.round(unit.processes)}</td>
      <td>
        {unit.collect_targets === null ? '—' : Math.round(unit.collect_targets)}
        {unit.collect_dropped ? (
          <div className="table__meta">丢弃 {Math.round(unit.collect_dropped)}</div>
        ) : null}
      </td>
      <td>{unit.series}</td>
    </tr>
  )
}
