import { useEffect, useState, type ReactNode } from 'react'
import { formatRelativeTime } from '../format'
import { toggleAppTheme, useAppTheme } from '../theme'

export type Tab = 'overview' | 'evidence' | 'topology' | 'metrics' | 'devices'

const TAB_LABELS: Record<Tab, string> = {
  overview: '概览',
  evidence: '证据',
  topology: '资产拓扑',
  metrics: '运行指标',
  devices: '安全设备',
}

const TAB_GROUPS: { label: string; items: { tab: Tab; icon: ReactNode }[] }[] = [
  {
    label: '取证',
    items: [
      { tab: 'overview', icon: <IconOverview /> },
      { tab: 'evidence', icon: <IconEvidence /> },
    ],
  },
  {
    label: '资产',
    items: [{ tab: 'topology', icon: <IconTopology /> }],
  },
  {
    label: '运行',
    items: [
      { tab: 'metrics', icon: <IconMetrics /> },
      { tab: 'devices', icon: <IconDevice /> },
    ],
  },
]

function IconOverview() {
  return (
    <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true">
      <rect x="1.6" y="1.6" width="5.2" height="5.2" rx="1.4" fill="none" stroke="currentColor" strokeWidth="1.4" />
      <rect x="9.2" y="1.6" width="5.2" height="5.2" rx="1.4" fill="none" stroke="currentColor" strokeWidth="1.4" />
      <rect x="1.6" y="9.2" width="5.2" height="5.2" rx="1.4" fill="none" stroke="currentColor" strokeWidth="1.4" />
      <rect x="9.2" y="9.2" width="5.2" height="5.2" rx="1.4" fill="none" stroke="currentColor" strokeWidth="1.4" />
    </svg>
  )
}

function IconEvidence() {
  return (
    <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true">
      <path d="M4.2 1.8h5.1l2.5 2.5v9.9H4.2Z" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
      <path d="M9.2 1.9v2.5h2.5M6.2 8h3.6M6.2 10.4h3.6" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  )
}

function IconTopology() {
  return (
    <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true">
      <circle cx="8" cy="2.6" r="1.8" fill="none" stroke="currentColor" strokeWidth="1.4" />
      <circle cx="3" cy="12.4" r="1.8" fill="none" stroke="currentColor" strokeWidth="1.4" />
      <circle cx="13" cy="12.4" r="1.8" fill="none" stroke="currentColor" strokeWidth="1.4" />
      <path d="M7.2 4.2 3.6 10.9M8.8 4.2l3.6 6.7M4.8 12.4h6.4" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  )
}

function IconMetrics() {
  return (
    <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true">
      <path d="M2.2 13.4h11.6" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
      <rect x="3.2" y="8.4" width="2.6" height="5" rx="0.6" fill="none" stroke="currentColor" strokeWidth="1.4" />
      <rect x="6.9" y="5.4" width="2.6" height="8" rx="0.6" fill="none" stroke="currentColor" strokeWidth="1.4" />
      <rect x="10.6" y="2.6" width="2.6" height="10.8" rx="0.6" fill="none" stroke="currentColor" strokeWidth="1.4" />
    </svg>
  )
}

function IconDevice() {
  return (
    <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true">
      <path d="M8 1.8 13.2 3.8v4.1c0 3.2-2.2 5.5-5.2 6.3-3-.8-5.2-3.1-5.2-6.3V3.8Z" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
      <path d="m5.8 8 1.6 1.6 3-3.2" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function BrandMark() {
  return (
    <span className="brand-mark" aria-hidden="true">
      {/* 与 favicon 同一套几何：一张证据落进索引（只读、可追溯）。 */}
      <svg viewBox="0 0 20 20" width="17" height="17">
        <g fill="none" stroke="#fff" strokeWidth="1.4" strokeLinejoin="round" strokeLinecap="round">
          <path d="M5.2 2.8h6.6l3.4 3.4v11H5.2Z" />
          <path d="M11.6 2.9v3.5h3.4M7.6 9.4h5M7.6 12.1h5" />
        </g>
      </svg>
    </span>
  )
}

interface ShellProps {
  tab: Tab
  onTab: (tab: Tab) => void
  connected: boolean
  syncing: boolean
  lastSyncedAt: number | null
  onRefresh: () => void
  children: ReactNode
}

/** 应用外壳：左侧导航 + 顶部常驻状态条 + 内容区（与 ingest-web / gateway-web 同一套结构）。 */
export function Shell({ tab, onTab, connected, syncing, lastSyncedAt, onRefresh, children }: ShellProps) {
  const theme = useAppTheme()
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 5_000)
    return () => window.clearInterval(timer)
  }, [])

  const statusText = syncing ? '同步中' : connected ? '自动刷新 30s' : 'BFF 不可用'

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">
          <BrandMark />
          <span className="brand-copy">
            <span className="brand-text">星象台</span>
            <span className="brand-sub">证据与观测</span>
          </span>
        </div>

        <nav className="nav" aria-label="主导航">
          {TAB_GROUPS.map((group) => (
            <div className="nav-group" key={group.label}>
              <span className="nav-label">{group.label}</span>
              {group.items.map((item) => (
                <button
                  key={item.tab}
                  type="button"
                  className={`nav-link${tab === item.tab ? ' nav-link--active' : ''}`}
                  onClick={() => onTab(item.tab)}
                  aria-current={tab === item.tab ? 'page' : undefined}
                >
                  <span className="nav-icon">{item.icon}</span>
                  {TAB_LABELS[item.tab]}
                </button>
              ))}
            </div>
          ))}
        </nav>

        <footer className="sidebar-footer">
          <span className="sidebar-version">v{__APP_VERSION__}</span>
          <span className="sidebar-note">wist-console · 计算区</span>
        </footer>
      </aside>

      <div className="body">
        <div className="statusbar">
          <nav className="crumbs" aria-label="面包屑">
            <span className="crumb-root">计算区</span>
            <span className="crumb-sep" aria-hidden="true">
              /
            </span>
            <span className="crumb-current">{TAB_LABELS[tab]}</span>
          </nav>

          <div className="statusbar-right">
            <span
              className={`pill ${connected ? 'pill--live' : 'pill--idle'}`}
              title={
                connected
                  ? `数据来自 console BFF：每 30 秒自动拉取；最近同步 ${
                      lastSyncedAt
                        ? new Date(lastSyncedAt).toLocaleTimeString('zh-CN', { hour12: false })
                        : '—'
                    }`
                  : 'console BFF 不可达：页面上的数据可能为空或过期'
              }
            >
              <span className={syncing ? 'dot dot--syncing' : 'dot'} aria-hidden="true" />
              {statusText}
              {connected && lastSyncedAt ? (
                <>
                  <span className="pill-divider" aria-hidden="true" />
                  <span className="pill-fresh">{formatRelativeTime(lastSyncedAt, now)}</span>
                </>
              ) : null}
            </span>

            <button
              type="button"
              className="icon-button"
              onClick={() => toggleAppTheme()}
              title={theme === 'light' ? '切换到深色主题' : '切换到浅色主题'}
              aria-label={theme === 'light' ? '当前浅色主题，点击切换到深色' : '当前深色主题，点击切换到浅色'}
            >
              {theme === 'light' ? (
                <svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true">
                  <path d="M13.2 9.6A5.6 5.6 0 0 1 6.4 2.8a5.6 5.6 0 1 0 6.8 6.8Z" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              ) : (
                <svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true">
                  <circle cx="8" cy="8" r="3.2" fill="none" stroke="currentColor" strokeWidth="1.4" />
                  <g stroke="currentColor" strokeWidth="1.4" strokeLinecap="round">
                    <path d="M8 1.2v1.6M8 13.2v1.6M1.2 8h1.6M13.2 8h1.6" />
                    <path d="M3.2 3.2l1.1 1.1M11.7 11.7l1.1 1.1M12.8 3.2l-1.1 1.1M4.3 11.7l-1.1 1.1" />
                  </g>
                </svg>
              )}
            </button>

            <button
              type="button"
              className="icon-button"
              onClick={onRefresh}
              title="刷新"
              aria-label="刷新"
            >
              <svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true">
                <path d="M13.5 8a5.5 5.5 0 1 1-1.6-3.9M13.5 1.5V5H10" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          </div>
        </div>

        <main className="main">{children}</main>
      </div>
    </div>
  )
}
