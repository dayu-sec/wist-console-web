import { useCallback, useEffect, useState } from 'react'
import { ApiError, getHealth, type ConsoleHealth } from './api'
import { UNAUTHORIZED_EVENT, getToken } from './auth'
import { Shell, type Tab } from './components/Shell'
import { InitGate } from './components/InitGate'
import { TokenGate } from './components/TokenGate'
import { EvidenceDetailPage } from './pages/EvidenceDetailPage'
import { EvidencePage } from './pages/EvidencePage'
import { HealthPage } from './pages/HealthPage'
import { OverviewPage } from './pages/Overview'
import { PlaceholderPage } from './pages/PlaceholderPage'
import { IngestPage } from './pages/IngestPage'
import { TopologyPage } from './pages/TopologyPage'

const TABS: Tab[] = ['overview', 'evidence', 'topology', 'metrics', 'health', 'devices', 'ingest']

interface Route {
  tab: Tab
  segments: string[]
  query: URLSearchParams
}

/** hash 路由：`#/evidence?subject_id=agent-1`、`#/evidence/art_xxx`。刷新 / 分享都能回到同一页。 */
function parseHash(hash: string): Route {
  const raw = hash.replace(/^#\/?/, '')
  const [pathPart, queryPart = ''] = raw.split('?')
  const segments = pathPart.split('/').filter(Boolean)
  const head = segments[0] as Tab | undefined
  const tab = head && TABS.includes(head) ? head : 'overview'
  return {
    tab,
    segments: segments.slice(1),
    query: new URLSearchParams(queryPart),
  }
}

function navigate(path: string): void {
  const normalized = path.replace(/^#?\/?/, '')
  window.location.hash = `#/${normalized}`
}

export default function App() {
  const [route, setRoute] = useState<Route>(() => parseHash(window.location.hash))
  const [health, setHealth] = useState<ConsoleHealth | null>(null)
  const [healthError, setHealthError] = useState<string | null>(null)
  const [syncing, setSyncing] = useState(false)
  const [lastSyncedAt, setLastSyncedAt] = useState<number | null>(null)
  // 没有令牌就不进界面：任何 401 都会把这里重置成 true（见 `auth.ts` 的广播）。
  const [needToken, setNeedToken] = useState(() => !getToken())
  // 还没接入凭据中心：BFF 对 `/api/*` 回 503 `peer_not_initialized`。
  // 这一档要排在令牌之前 —— 没材料时拿着令牌也什么都进不去。
  const [initRequired, setInitRequired] = useState(false)
  const [initDetail, setInitDetail] = useState<string | null>(null)

  useEffect(() => {
    const onUnauthorized = () => setNeedToken(true)
    window.addEventListener(UNAUTHORIZED_EVENT, onUnauthorized)
    return () => window.removeEventListener(UNAUTHORIZED_EVENT, onUnauthorized)
  }, [])

  useEffect(() => {
    const onHash = () => setRoute(parseHash(window.location.hash))
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])

  const refresh = useCallback(async () => {
    setSyncing(true)
    try {
      const value = await getHealth()
      setHealth(value)
      setHealthError(null)
      setInitRequired(false)
      setInitDetail(null)
      setLastSyncedAt(Date.now())
    } catch (err) {
      setHealth(null)
      const notInitialized = err instanceof ApiError && err.code === 'peer_not_initialized'
      setInitRequired(notInitialized)
      setInitDetail(notInitialized && err instanceof ApiError ? err.message : null)
      setHealthError(err instanceof ApiError ? `${err.message}（${err.code}）` : String(err))
    } finally {
      setSyncing(false)
    }
  }, [])

  // 健康状态 30 秒拉一次：页面数据本身由各页自己按需拉，不在这里做全量轮询。
  useEffect(() => {
    void refresh()
    const timer = window.setInterval(() => void refresh(), 30_000)
    return () => window.clearInterval(timer)
  }, [refresh])

  const connected = health !== null

  if (initRequired) {
    return (
      <InitGate
        onRetry={() => void refresh()}
        retrying={syncing}
        detail={initDetail}
      />
    )
  }

  if (needToken) {
    return (
      <TokenGate
        onAuthenticated={() => {
          setNeedToken(false)
          void refresh()
        }}
      />
    )
  }

  return (
    <Shell
      tab={route.tab}
      onTab={(tab) => navigate(tab === 'overview' ? '/overview' : `/${tab}`)}
      connected={connected}
      syncing={syncing}
      lastSyncedAt={lastSyncedAt}
      onRefresh={() => void refresh()}
    >
      {route.tab === 'overview' ? (
        <OverviewPage health={health} error={healthError} onNavigate={(tab) => navigate(`/${tab}`)} />
      ) : null}

      {route.tab === 'evidence' && route.segments[0] ? (
        <EvidenceDetailPage
          artifactId={route.segments[0]}
          onBack={() => navigate('/evidence')}
        />
      ) : null}

      {route.tab === 'evidence' && !route.segments[0] ? (
        <EvidencePage
          subjectId={route.query.get('subject_id') ?? ''}
          kind={route.query.get('kind') ?? ''}
          onOpen={(artifactId) => navigate(`/evidence/${artifactId}`)}
          onQuery={({ subjectId, kind }) => {
            const params = new URLSearchParams()
            if (subjectId) params.set('subject_id', subjectId)
            if (kind) params.set('kind', kind)
            const suffix = params.size > 0 ? `?${params.toString()}` : ''
            navigate(`/evidence${suffix}`)
          }}
        />
      ) : null}

      {route.tab === 'topology' ? <TopologyPage /> : null}

      {route.tab === 'health' ? (
        <HealthPage
          health={health}
          error={healthError}
          syncing={syncing}
          lastSyncedAt={lastSyncedAt}
          onRefresh={() => void refresh()}
        />
      ) : null}

      {route.tab === 'metrics' ? (
        <PlaceholderPage
          title="运行指标"
          summary="运行指标：数据面的来源 / PARSE / 输出三层吞吐与静默，以及主机侧的采集健康。"
          missing={[
            '每个网关栈里各有一份 VictoriaMetrics（wparse 写入、gateway-web 的「数据采集」页读），平台侧没有聚合。',
            '计算区到不了客户侧的 VM，必须由网关按周期上报运行摘要，或由平台侧 ingest 数据面自己统计。',
            '口径未定：来源 / PARSE / 输出三层怎么合并、时间窗多长、静默与「真的没流量」怎么区分。',
          ]}
          plan={[
            '先在网关侧生成 5 分钟粒度的计数摘要（pick_stat + sink 计数），体积控制在几 KB。',
            '随既有状态上报通道带回 center（不新开入站面），落一张按网关的时间序表。',
            'BFF 提供 /api/metrics 聚合查询，本页只负责画图，不做跨网关的二次计算。',
          ]}
        />
      ) : null}

      {route.tab === 'ingest' ? <IngestPage /> : null}

      {route.tab === 'devices' ? (
        <PlaceholderPage
          title="安全设备"
          summary="网关暴露的安全能力、当前封堵项与生效验证（readback）结果。"
          missing={[
            'containment_capabilities 能力广告还只在设计稿里（gateway-capability-contract.md），网关不上报。',
            '「设备状态」的数据模型未定：是设备在线 + 能力清单，还是封堵规则的当前生效情况。',
            '中心侧没有设备/封堵状态表，也没有 readback 结果的落点。',
          ]}
          plan={[
            '先落网关能力广告（随 ReportGatewayStatus 加性字段，老网关不报 = 无能力）。',
            '再落 center 的设备状态查询（C2 读），只读，不做下发。',
            '最后接 /api/devices 与页面；写操作（封堵/解封）走 security-containment-actions.md 的六道闸，不在本台直接发。',
          ]}
        />
      ) : null}
    </Shell>
  )
}
