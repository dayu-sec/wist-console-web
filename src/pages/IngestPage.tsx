import { useEffect, useState } from 'react'
import { ApiError, getIntegration, type IntegrationInfo } from '../api'
import { Card, ErrorBanner, Field, InfoBanner, Mono, PageShell } from '../components/ui'

/** 代码块：用设计令牌里现成的 `.codeblock` 结构（header + 可滚动 pre）。 */
function CodeBlock({
  label,
  hint,
  code,
}: {
  label: string
  hint?: string
  code: string
}) {
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
    <div className="codeblock">
      <div className="codeblock__header">
        <div>
          <div className="codeblock__label">{label}</div>
          {hint ? <div className="codeblock__hint">{hint}</div> : null}
        </div>
        <div className="codeblock__actions">
          <button type="button" className="button button--ghost button--sm" onClick={() => void copy()}>
            {copied ? '已复制' : '复制'}
          </button>
        </div>
      </div>
      <pre className="codeblock__code">
        <code>{code}</code>
      </pre>
    </div>
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
          <Card
            title="写端点"
            subtitle="数据面（warp-parse）直投的地址；明文 HTTP，只在同一内网开放"
            aside={<span className="badge badge--blue">POST</span>}
          >
            <div className="kv">
              <Field label="地址">
                <Mono>{info.evidence.write_url}</Mono>
              </Field>
              <Field label="认证">
                Basic：<Mono>username</Mono> = 站点 token（<Mono>password</Mono> 留空）；也支持{' '}
                <Mono>Bearer &lt;token&gt;</Mono>
              </Field>
              <Field label="租户">
                <Mono>{info.evidence.tenant}</Mono>
              </Field>
              <Field label="允许的 kind">
                <span className="stack-inline">
                  {info.evidence.allowed_kinds.map((kind) => (
                    <span key={kind} className="badge badge--gray">
                      {kind}
                    </span>
                  ))}
                </span>
              </Field>
              <Field label="帧标记">
                <Mono>{info.evidence.frame_marker}</Mono>
                <span className="muted">（其它标记一律 400）</span>
              </Field>
            </div>
          </Card>

          <InfoBanner>
            前提：平台侧 ingest 必须加载 <Mono>agent_uplink_ivsrep</Mono> 的 WPL/OML；
            连接器没有 TLS 参数，所以写端口只在内网开放。
          </InfoBanner>

          <div className="stack">
            <CodeBlock
              label="connectors/sink.d/30-evidence_sink.toml"
              hint="连接器：怎么连、怎么认证（Basic，username = 站点 token）"
              code={info.warp_parse.connector}
            />
            <CodeBlock
              label="topology/sinks/business.d/agent_ivsrep_evidence.toml"
              hint="sink 分组：绑定 agent_uplink_ivsrep，batch_size = 1"
              code={info.warp_parse.sink_group}
            />
            <CodeBlock
              label="环境变量（数据面进程可见）"
              hint="EVIDENCE_SINK_TOKEN 必须与证据服务 sec-value.yml 里的值一致"
              code={Object.entries(info.warp_parse.env)
                .map(([key, value]) => `${key}=${value}`)
                .join('\n')}
            />
          </div>

          <Card title="失败与重试" subtitle="别把它当“必达”">
            <ul className="bullets">
              <li>非 2xx 会被连接器重试 3 次，仍失败落 rescue 文件（可见、可人工重放）。</li>
              <li>重复投递是安全的：同 command_id 同内容回 200 + 同一个 artifact_id。</li>
              <li>400 / 401 / 403 / 413 / 422 是配置或数据问题，重试不会变好。</li>
            </ul>
          </Card>
        </>
      ) : null}
    </PageShell>
  )
}
