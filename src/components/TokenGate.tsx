// 访问令牌入口：星象台没有「匿名打开」这一档。
//
// 操作员的 token 由 `wist-cred` 签发（`wcr_…`），BFF 用摘要表验；
// 浏览器只负责把它带在 `Authorization: Bearer` 上。

import { useState } from 'react'
import { ApiError, getHealth } from '../api'
import { clearToken, setToken } from '../auth'

interface Props {
  onAuthenticated: () => void
}

export function TokenGate({ onAuthenticated }: Props) {
  const [value, setValue] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [checking, setChecking] = useState(false)

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    const token = value.trim()
    if (!token) {
      setError('请粘贴访问令牌')
      return
    }
    setChecking(true)
    setError(null)
    setToken(token)
    try {
      // 用一次真请求确认这把 token 能进这个 console（而不是先放行再满屏 401）。
      await getHealth()
      onAuthenticated()
    } catch (err) {
      clearToken()
      if (err instanceof ApiError) {
        // 403 = token 有效但角色不够；401 = 不认识 / 过期 / 撤销。
        setError(
          err.status === 403
            ? `这把令牌有效，但没有星象台的访问角色（${err.code}）`
            : `令牌不可用（${err.code}）：${err.message}`,
        )
      } else {
        setError(String(err))
      }
    } finally {
      setChecking(false)
    }
  }

  return (
    <div className="gate">
      <form className="gate__card card" onSubmit={submit}>
        <div>
          <h1 className="card__title">星象台</h1>
          <p className="card__subtitle">
            这个界面只对持有 <code>wist-cred</code> 访问令牌的人开放。令牌由管理员在凭据中心签发
            （<code>wcr_…</code>），只存在本标签页里，关掉即失效。
          </p>
        </div>
        <label className="gate__label" htmlFor="token">
          访问令牌
        </label>
        <input
          id="token"
          className="gate__input"
          type="password"
          autoComplete="off"
          spellCheck={false}
          placeholder="wcr_..."
          value={value}
          onChange={(event) => setValue(event.target.value)}
          disabled={checking}
        />
        {error ? <p className="gate__error">{error}</p> : null}
        <button className="button button--primary" type="submit" disabled={checking}>
          {checking ? '校验中…' : '进入'}
        </button>
      </form>
    </div>
  )
}
