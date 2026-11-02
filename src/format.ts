/** 字节数 → 可读大小。 */
export function formatBytes(size: number | null | undefined): string {
  if (size === null || size === undefined) return '—'
  if (size < 1024) return `${size} B`
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KiB`
  return `${(size / (1024 * 1024)).toFixed(1)} MiB`
}

/** 绝对时刻（本地时区，24h）。 */
export function formatDateTime(value: string | null | undefined): string {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(date)
}

/** 相对时间："x 秒前 / x 分钟前 / x 小时前 / x 天前"。 */
export function formatRelativeTime(value: string | number | null | undefined, now = Date.now()): string {
  if (value === null || value === undefined) return '—'
  const then = typeof value === 'number' ? value : new Date(value).getTime()
  if (Number.isNaN(then)) return '—'
  const diff = now - then
  if (diff < 0) return '刚刚'
  const seconds = Math.floor(diff / 1000)
  if (seconds < 10) return '刚刚'
  if (seconds < 60) return `${seconds} 秒前`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes} 分钟前`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} 小时前`
  return `${Math.floor(hours / 24)} 天前`
}

/** 剩余时长（券到期）：`mm:ss` / `x 分 y 秒`；已过期返回「已过期」。 */
export function formatCountdown(expiresAt: string | null | undefined, now = Date.now()): string {
  if (!expiresAt) return '—'
  const target = new Date(expiresAt).getTime()
  if (Number.isNaN(target)) return '—'
  const left = Math.floor((target - now) / 1000)
  if (left <= 0) return '已过期'
  if (left < 60) return `${left} 秒`
  const minutes = Math.floor(left / 60)
  const seconds = left % 60
  if (minutes < 60) return `${minutes} 分 ${seconds} 秒`
  const hours = Math.floor(minutes / 60)
  return `${hours} 小时 ${minutes % 60} 分`
}
