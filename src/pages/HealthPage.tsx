import { useCallback, useEffect, useState } from 'react'
import {
  ApiError,
  getAtlasOpenApi,
  type ConsoleHealth,
  type InterfaceState,
  type OpenApiDocument,
  type OpenApiOperation,
  type OpenApiSchema,
} from '../api'
import { Badge, Block, Card, Empty, ErrorBanner, InfoBanner, PageShell, type BadgeTone } from '../components/ui'
import { formatRelativeTime } from '../format'

/** 方法顺序固定：同一路径上的多个方法按 HTTP 语义排，而不是字母序。 */
const METHODS = ['get', 'post', 'put', 'patch', 'delete'] as const

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

/** `$ref` 只显名字；数组 / 组合类型就地展开。 */
function typeName(schema: OpenApiSchema | undefined): string {
  if (!schema) return '—'
  if (schema.$ref) return schema.$ref.split('/').pop() ?? schema.$ref
  if (schema.type === 'array') return `array<${typeName(schema.items)}>`
  if (schema.oneOf?.length) return schema.oneOf.map(typeName).join(' | ')
  if (schema.anyOf?.length) return schema.anyOf.map(typeName).join(' | ')
  if (schema.enum?.length) return `enum(${schema.enum.map(String).join(' | ')})`
  const types = Array.isArray(schema.type) ? schema.type : schema.type ? [schema.type] : []
  if (types.length === 0) return 'object'
  return schema.format ? `${types.join(' | ')}(${schema.format})` : types.join(' | ')
}

/**
 * 一个接口的 curl 示例。
 *
 * base 是**数据场**的入口（`/api/atlas/*` 会经 BFF 转给 atlas），所以这里用的令牌是
 * 数据场的 `wcr_…` —— atlas 自己的令牌由 BFF 带上，页面/用户不需要知道。
 * 路径参数写成 `<id>`：看得出是占位符，不会被当成能直接跑。
 */
function curlFor(path: string, method: string): string {
  const origin = window.location.origin
  const target = path.replace(/^\/api/, '/api/atlas').replace(/\{([^}]+)\}/g, (_, name) => `<${name}>`)
  const insecure = window.location.protocol === 'https:' ? '-k ' : ''
  return `curl ${insecure}-s -X ${method.toUpperCase()} '${origin}${target}' \\\n  -H 'authorization: Bearer <数据场令牌>'`
}

/** 可复制的命令块。 */
function CurlExample({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <div className="api-op__curl">
      <pre>
        <code>{text}</code>
      </pre>
      <button
        type="button"
        className="button button--ghost button--sm"
        onClick={() => {
          void navigator.clipboard?.writeText(text)
          setCopied(true)
          window.setTimeout(() => setCopied(false), 1500)
        }}
      >
        {copied ? '已复制' : '复制'}
      </button>
    </div>
  )
}

/**
 * 一个接口：一行摘要，展开看参数与响应。
 *
 * 内容全部来自 atlas 自己输出的 spec（编译期生成），页面不维护第二份接口清单。
 * `secured` 来自 spec 的 `security`（文档级，operation 通常不重复）。
 */
function ApiOperation({
  path,
  method,
  operation,
  secured,
}: {
  path: string
  method: string
  operation: OpenApiOperation
  secured: boolean
}) {
  const parameters = operation.parameters ?? []
  // 参数可能在 path item 级共享；这里只列 operations 上的（atlas 目前都在这一层）。
  const responses = Object.entries(operation.responses ?? {})
  return (
    <details className="api-op">
      <summary>
        <span className="api-op__method">{method.toUpperCase()}</span>
        <code className="mono api-op__path">{path}</code>
        {operation.summary ? <span className="api-op__summary">{operation.summary}</span> : null}
        {secured ? (
          <span className="api-op__lock" title="需要 Authorization: Bearer <令牌>">
            需要令牌
          </span>
        ) : null}
      </summary>
      <div className="api-op__body">
        <div className="api-op__label">调用示例</div>
        <CurlExample text={curlFor(path, method)} />
        {parameters.length > 0 ? (
          <div className="table__meta">
            查询参数：{parameters.map((parameter) => parameter.name).join(' / ')}（类型与说明见下表）
          </div>
        ) : null}
        {parameters.length === 0 ? (
          <div className="table__meta">没有参数</div>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>参数</th>
                  <th>位置</th>
                  <th>类型</th>
                  <th>必填</th>
                  <th>说明</th>
                </tr>
              </thead>
              <tbody>
                {parameters.map((parameter) => (
                  <tr key={`${parameter.in}:${parameter.name}`}>
                    <td>
                      <code className="mono">{parameter.name}</code>
                    </td>
                    <td>{parameter.in}</td>
                    <td>{typeName(parameter.schema)}</td>
                    <td>{parameter.required ? '是' : '否'}</td>
                    <td className="table__meta">{parameter.description ?? ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div className="table__meta">
          响应：
          {responses.map(([status, response], index) => (
            <span key={status}>
              {index > 0 ? ' · ' : ''}
              {status} {typeName(response.content?.['application/json']?.schema)}
            </span>
          ))}
        </div>
      </div>
    </details>
  )
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
  const [atlasApi, setAtlasApi] = useState<OpenApiDocument | null>(null)
  const [atlasApiError, setAtlasApiError] = useState<string | null>(null)
  const [atlasApiLoading, setAtlasApiLoading] = useState(false)

  // 资产拓扑的接口清单：atlas 自己输出的 OpenAPI，经 BFF 拉（带令牌）。
  // 失败不是故障：老版本 atlas 没有 `/api/openapi.json`，页面降级成一句说明。
  const loadAtlasApi = useCallback(async () => {
    setAtlasApiLoading(true)
    try {
      setAtlasApi(await getAtlasOpenApi())
      setAtlasApiError(null)
    } catch (err) {
      setAtlasApi(null)
      setAtlasApiError(err instanceof ApiError ? `${err.message}（${err.code}）` : String(err))
    } finally {
      setAtlasApiLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadAtlasApi()
  }, [loadAtlasApi])

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

  const atlasOperations = Object.entries(atlasApi?.paths ?? {})
    .sort(([left], [right]) => left.localeCompare(right))
    .flatMap(([path, item]) =>
      METHODS.filter((method) => item[method]).map((method) => ({
        path,
        method,
        operation: item[method],
      })),
    )

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
              hint="点右上角「立即检查」；如果一直为空，先确认页面本身能连上计算区 BFF。"
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

        <Card
          title="资产拓扑 API"
          subtitle={
            atlasApi
              ? `接口清单由 atlas 自己输出（OpenAPI ${atlasApi.openapi}，v${atlasApi.info.version}）：路径与字段跟着代码走，页面不维护第二份。atlas 侧要 Bearer 令牌，本页经 BFF 调用、令牌由 BFF 带上，不需要你输入。`
              : '读接口清单来自 atlas 自己输出的 /api/openapi.json；拿不到时这里只展示上一张表的探活结果。'
          }
          aside={
            <>
              <Badge tone={atlasOperations.length > 0 ? 'blue' : 'gray'}>
                {atlasOperations.length > 0 ? `${atlasOperations.length} 个接口` : '无清单'}
              </Badge>
              <button
                type="button"
                className="button button--ghost button--sm"
                onClick={() => void loadAtlasApi()}
                disabled={atlasApiLoading}
              >
                {atlasApiLoading ? '读取中…' : '重新读取'}
              </button>
            </>
          }
        >
          {atlasOperations.length > 0 ? (
            <div className="api-ops">
              {atlasOperations.map(({ path, method, operation }) => (
                <ApiOperation
                  key={`${method}:${path}`}
                  path={path}
                  method={method}
                  operation={operation}
                  secured={(operation.security ?? atlasApi?.security ?? []).length > 0}
                />
              ))}
            </div>
          ) : (
            <Empty
              title="这个 atlas 版本还没提供接口清单"
              hint={
                atlasApiError
                  ? `${atlasApiError} —— 升级到带 /api/openapi.json 的 atlas（0.3.4 起）后，这里会直接变成接口列表。`
                  : 'atlas 没有输出 /api/openapi.json（0.3.4 之前）。升级后这里会直接变成接口列表。'
              }
            />
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
