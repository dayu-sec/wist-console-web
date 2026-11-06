// 未接入凭据中心时的唯一页面。
//
// BFF（`wist-console`）在拿到 cred 材料之前对 `/api/*` 一律回
// `503 peer_not_initialized` —— 这是有意的：否则操作者会对着一个
// 「页面能开、接口永远 401」的半可用现场猜。这里把原因与下一步写清楚，
// 并把初始化页（`/__init`，由同源的 BFF 提供）直接给出来。

interface Props {
  onRetry: () => void
  retrying: boolean
  detail?: string | null
}

export function InitGate({ onRetry, retrying, detail }: Props) {
  return (
    <div className="gate">
      <div className="gate__card card">
        <div>
          <h1 className="card__title">数据场还没接入凭据中心</h1>
          <p className="card__subtitle">
            这台 console 还没有自己的 cred 材料，所以业务接口现在全部返回{' '}
            <code>503 peer_not_initialized</code>。先完成自注册，界面随后自动可用
            （材料落盘后收数监听会自己起来，<strong>首次接入不需要重启</strong>）。
          </p>
        </div>

        <ol className="card__steps">
          <li>
            在 <code>wist-cred</code> 页面建认证系统 <code>wist-console</code>（角色至少{' '}
            <code>read</code>），并签发一张接入券（<code>wot_…</code>）；
          </li>
          <li>
            取部署生成的 <strong>setup code</strong>（栈的 <code>sec-value.yml</code>）；
          </li>
          <li>打开初始化页，两样都填，提交。</li>
        </ol>

        <a className="button button--primary" href="/__init">
          打开初始化页
        </a>

        <p className="card__subtitle">
          已经提交过了？材料可能还在写盘（最多几秒）：
        </p>
        <button className="button" type="button" onClick={onRetry} disabled={retrying}>
          {retrying ? '检查中…' : '重新检查'}
        </button>

        {detail ? <p className="gate__error">{detail}</p> : null}
      </div>
    </div>
  )
}
