import { useEffect, useState } from 'react'
import { ApiError, getIntegration, type IntegrationInfo } from '../api'
import { ErrorBanner, InfoBanner, PageShell, Mono } from '../components/ui'

/** 代码块 + 复制按钮。内网台不需要花哨的编辑器，能一键拷走就够。 */
function CodeBlock({ title, code }: { title: string; code: string }) {
  const [copied, setCopied] = useState(false)
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1500)
    } catch {
      setCopied(false)
    }
  }
  return (
    <section className="block block--narrow">
      <div className="page-header__row">
        <h2 className="card__title">{title}</h2>
        <button type="button" className="button button--ghost button--sm" onClick={() => void copy()}>
          {copied ? '已复制' : '复制'}
        </button>
      </div>
      <pre className="codeblock">
        <code>{code}</code>
      </pre>
    </section>
  )
}

export function IngestPage() {
  const [info, setInfo] = useState<IntegrationInfo | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    getIntegration()
      .then((value) => {
        if (!cancelled) setInfo(value)
      })
      .catch((err) => {
        if (cancelled) return
        setError(err instanceof ApiError ? `${err.message}（${err.code}）` : String(err))
      })
    return () => {
      cancelled = true
    }
  }, [])

  return (
    <PageShell
      title="数据面接入"
      summary="把报告写进证据库的接口与配置。拷走两份 TOML、配两个环境变量即可；这里不显示站点 token。"
    >
      {error ? <ErrorBanner>{error}</ErrorBanner> : null}

      {info ? (
        <>
          <section className="block block--narrow">
            <div className="kv">
              <span className="field__label">写端点</span>
              <div className="field__value">
                <Mono>{info.evidence.write_url}</Mono>
              </div>
              <span className="field__label">认证</span>
              <div className="field__value">
                Basic，<Mono>username</Mono> = 站点 token（<Mono>password</Mono> 留空）；也支持{' '}
                <Mono>Bearer &lt;token&gt;</Mono>
              </div>
              <span className="field__label">租户</span>
              <div className="field__value">
                <Mono>{info.evidence.tenant}</Mono>
              </div>
              <span className="field__label">允许的 kind</span>
              <div className="field__value">
                {info.evidence.allowed_kinds.map((kind) => (
                  <span key={kind} className="badge badge--gray">
                    {kind}
                  </span>
                ))}
              </div>
              <span className="field__label">帧标记</span>
              <div className="field__value">
                <Mono>{info.evidence.frame_marker}</Mono>（其它标记一律 400）
              </div>
            </div>
          </section>

          <InfoBanner>
            前提：平台侧 ingest 必须加载 <Mono>agent_uplink_ivsrep</Mono> 的 WPL/OML；连接器**没有 TLS**，
            所以写端口只在同一内网开放。
          </InfoBanner>

          <CodeBlock title="连接器：connectors/sink.d/30-evidence_sink.toml" code={info.warp_parse.connector} />
          <CodeBlock
            title="sink 分组：topology/sinks/business.d/agent_ivsrep_evidence.toml"
            code={info.warp_parse.sink_group}
          />
          <CodeBlock
            title="环境变量（数据面进程可见）"
            code={Object.entries(info.warp_parse.env)
              .map(([key, value]) => `${key}=${value}`)
              .join('\n')}
          />

          <section className="block block--narrow">
            <h2 className="card__title">失败与重试</h2>
            <ul className="bullets">
              <li>非 2xx 会被连接器重试 3 次，仍失败落 rescue 文件（可见、可人工重放）。</li>
              <li>重复投递是安全的：同 command_id 同内容回 200 + 同一个 artifact_id。</li>
              <li>400/401/403/413/422 是配置或数据问题，重试不会变好。</li>
            </ul>
          </section>
        </>
      ) : null}
    </PageShell>
  )
}
