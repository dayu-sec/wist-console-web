import { useEffect, useState } from 'react'
import { ApiError, getEvidence, presignEvidence, type EvidenceArtifact, type PresignResult } from '../api'
import { formatBytes, formatCountdown, formatDateTime } from '../format'
import { Badge, ErrorBanner, Field, InfoBanner, Mono, PageShell } from '../components/ui'
import { verdictTone } from './EvidencePage'

export function EvidenceDetailPage({ artifactId, onBack }: { artifactId: string; onBack: () => void }) {
  const [artifact, setArtifact] = useState<EvidenceArtifact | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [signed, setSigned] = useState<PresignResult | null>(null)
  const [signError, setSignError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    let cancelled = false
    setArtifact(null)
    setError(null)
    setSigned(null)
    setSignError(null)
    getEvidence(artifactId)
      .then((value) => {
        if (!cancelled) setArtifact(value)
      })
      .catch((err) => {
        if (cancelled) return
        setError(err instanceof ApiError ? `${err.message}（${err.code}）` : String(err))
      })
    return () => {
      cancelled = true
    }
  }, [artifactId])

  useEffect(() => {
    if (!signed) return
    const timer = window.setInterval(() => setNow(Date.now()), 1_000)
    return () => window.clearInterval(timer)
  }, [signed])

  const openBody = async () => {
    setBusy(true)
    setSignError(null)
    try {
      const result = await presignEvidence(artifactId)
      setSigned(result)
      setNow(Date.now())
      window.open(result.url, '_blank', 'noopener,noreferrer')
    } catch (err) {
      setSignError(err instanceof ApiError ? `${err.message}（${err.code}）` : String(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <PageShell
      title="证据详情"
      summary="元数据来自索引；正文只经 60s 单对象签名打开，BFF 不解密也不落盘。"
      actions={
        <div className="page-actions">
          <button type="button" className="button button--ghost" onClick={onBack}>
            返回列表
          </button>
          <button
            type="button"
            className="button button--primary"
            onClick={() => void openBody()}
            disabled={!artifact || busy}
          >
            {busy ? '签发中…' : '打开正文（60s）'}
          </button>
        </div>
      }
    >
      {error ? <ErrorBanner>{error}</ErrorBanner> : null}
      {signError ? <ErrorBanner>{signError}</ErrorBanner> : null}

      {signed ? (
        <InfoBanner>
          已签发，{formatCountdown(signed.expires_at, now)} 内有效（单对象）。再次打开请重新点按钮。
        </InfoBanner>
      ) : null}

      {artifact ? (
        <>
          <section className="block block--narrow">
            <div className="kv">
              <Field label="结论">
                <Badge tone={verdictTone(artifact.verdict)}>{artifact.verdict}</Badge>
              </Field>
              <Field label="类型">
                {artifact.kind}
                {artifact.subtype ? <span className="muted"> / {artifact.subtype}</span> : null}
              </Field>
              <Field label="主体">
                <Mono>{artifact.subject_id}</Mono>
                {artifact.gateway_id ? <span className="muted"> · 网关 {artifact.gateway_id}</span> : null}
              </Field>
              <Field label="命令">
                {artifact.command_id ? <Mono>{artifact.command_id}</Mono> : <span className="muted">—</span>}
              </Field>
              <Field label="契约">
                <Mono>{artifact.schema_id}</Mono>
              </Field>
              <Field label="标记">
                {artifact.marker_ids.length > 0 ? (
                  <span>
                    {artifact.marker_ids.map((marker) => (
                      <span key={marker} className="badge badge--gray">
                        {marker}
                      </span>
                    ))}
                  </span>
                ) : (
                  <span className="muted">—</span>
                )}
              </Field>
            </div>
          </section>

          <section className="block block--narrow">
            <div className="kv">
              <Field label="产物 id">
                <Mono>{artifact.artifact_id}</Mono>
              </Field>
              <Field label="租户 / 客户">
                <Mono>{artifact.tenant_id}</Mono> <span className="muted">/</span>{' '}
                <Mono>{artifact.customer_id}</Mono>
              </Field>
              <Field label="敏感度 / 保留档">
                {artifact.sensitivity} <span className="muted">/</span> {artifact.retention_class}
              </Field>
              <Field label="观测 / 入库">
                {formatDateTime(artifact.reported_at)} <span className="muted">/</span>{' '}
                {formatDateTime(artifact.stored_at)}
              </Field>
              <Field label="保留至">
                {formatDateTime(artifact.retention_until)}
                {artifact.legal_hold ? <Badge tone="amber">legal hold</Badge> : null}
              </Field>
              <Field label="大小 / 兜底">
                {formatBytes(artifact.size_bytes)} <span className="muted">/</span> {artifact.durability}
              </Field>
              <Field label="状态">{artifact.state}</Field>
              <Field label="sha256">
                <Mono title={artifact.sha256}>{artifact.sha256.slice(0, 16)}…</Mono>
              </Field>
              <Field label="对象键">
                <Mono title={artifact.object_key}>{artifact.object_key}</Mono>
              </Field>
            </div>
          </section>

          <section className="block block--narrow">
            <InfoBanner tone="warn">
              正文是 zstd 压缩的 JSON：浏览器直接打开会**下载**而不是展开。BFF 的流式解压视图
              （<code className="mono">/api/evidence/{'{id}'}/content</code>）在 P1 接入。
            </InfoBanner>
          </section>
        </>
      ) : null}
    </PageShell>
  )
}
