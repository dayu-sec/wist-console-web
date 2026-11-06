// 访问令牌入口：数据场没有「匠名打开」这一档。
//
// 操作员的 token 由 `wist-cred` 签发（`wcr_…`），BFF 用摘要表验；
// 浏览器只负责把它带在 `Authorization: Bearer` 上。

import { useState } from 'react'
import { ApiError, authenticate } from '../api'
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
    try {
      // 先在**不存**令牌的情况下问一次“这串是谁”——`POST /api/login`。
      // 存了才验的话，登录失败的瞬间其它页面已经开始拿它发请求了。
      // 拿不到身份不一定是错：老 console / ingress 模式没这个端点，
      // `authenticate` 会回退到“发个真请求试试”（见 api.ts）。
      await authenticate(token)
      setToken(token)
      onAuthenticated()
    } catch (err) {
      clearToken()
      if (err instanceof ApiError) {
        // 403 = 令牌有效但角色不够；401 = 不认识 / 过期 / 撤销。
        setError(
          err.status === 403
            ? `这把令牌有效，但没有数据场的访问角色（${err.code}）`
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
          <h1 className="card__title">数据场</h1>
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
