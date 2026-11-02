import { useSyncExternalStore } from 'react'

/**
 * 浅色 / 深色主题 —— 与 wist-center-web 同一套写法：模块持有唯一状态，组件用
 * `useAppTheme()` 订阅；颜色全在 `src/styles.css` 的两套 token 里。
 *
 * 落点是 `<html data-theme="light">`（深色是默认，不写属性），选择存 localStorage；
 * 首次进入跟随系统，用户点过之后就以用户选择为准。
 */
export type AppTheme = 'light' | 'dark'

const STORAGE_KEY = 'wistConsoleWeb.theme'
const LIGHT_QUERY = '(prefers-color-scheme: light)'

let current: AppTheme = 'dark'
let initialized = false
const listeners = new Set<() => void>()

function systemTheme(): AppTheme {
  if (typeof window === 'undefined' || !window.matchMedia) return 'dark'
  return window.matchMedia(LIGHT_QUERY).matches ? 'light' : 'dark'
}

function readStored(): AppTheme | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    return raw === 'light' || raw === 'dark' ? raw : null
  } catch {
    return null
  }
}

function apply(theme: AppTheme, notify: boolean): void {
  current = theme
  if (typeof document !== 'undefined') {
    const root = document.documentElement
    if (theme === 'light') {
      root.dataset.theme = 'light'
    } else {
      delete root.dataset.theme
    }
    const meta = document.querySelector('meta[name="theme-color"]')
    if (meta) {
      meta.setAttribute('content', theme === 'light' ? '#f7f8fa' : '#0a1220')
    }
  }
  if (notify) {
    for (const listener of listeners) listener()
  }
}

/** 启动时调用一次（早于渲染），避免先按深色画一帧再跳浅色。 */
export function initTheme(): void {
  if (initialized || typeof window === 'undefined') return
  initialized = true
  const stored = readStored()
  apply(stored ?? systemTheme(), false)

  if (!stored && window.matchMedia) {
    const query = window.matchMedia(LIGHT_QUERY)
    query.addEventListener?.('change', () => {
      if (readStored() === null) apply(systemTheme(), true)
    })
  }
}

export function toggleAppTheme(): void {
  const next: AppTheme = current === 'light' ? 'dark' : 'light'
  try {
    window.localStorage.setItem(STORAGE_KEY, next)
  } catch {
    // 存不下也要在当前会话生效。
  }
  apply(next, true)
}

export function useAppTheme(): AppTheme {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    () => current,
    () => current,
  )
}
