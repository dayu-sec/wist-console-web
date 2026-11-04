// BFF（`wist-console`）的客户端。
//
// 浏览器**只跟 BFF 说话**：证据的 mTLS、租户/敏感度闸、预签名代签都在 BFF 里完成；
// 这个文件不持有任何凭据，也不直连 COS / atlas / center。

/** 每个数据源的可用状态。`not_configured` 不是错误 —— 是「这个域还没接」。 */
export type SourceStateName = 'ok' | 'unavailable' | 'not_configured'

export interface SourceState {
  status: SourceStateName
  detail?: string
}

export interface ConsoleHealth {
  status: string
  version?: string
  sources: Record<string, SourceState>
  /** 逐条接口探活：BFF 自己看到的那一面。 */
  interfaces?: InterfaceState[]
}

/**
 * 单条接口的可用性。`not_configured` 表示这个地址还没配（不是故障）；
 * `not_configured` 时没有 `url` / 延迟 / 检查时间。
 */
export interface InterfaceState {
  id: string
  label: string
  url?: string
  status: SourceStateName
  detail?: string
  latency_ms?: number
  checked_at_ms?: number
}

/** 与 `wist-evidence` 的索引行一致（见 evidence-service.md §5.1）。 */
export interface EvidenceArtifact {
  artifact_id: string
  tenant_id: string
  customer_id: string
  kind: string
  subtype: string | null
  subject_type: string
  subject_id: string
  gateway_id: string | null
  agent_id: string | null
  command_id: string | null
  dedupe_key: string
  schema_id: string
  sensitivity: string
  retention_class: string
  bucket: string
  object_key: string
  size_bytes: number
  sha256: string
  verdict: string
  marker_ids: string[]
  source_ref: string | null
  source_sha256: string | null
  durability: string
  reported_at: string
  stored_at: string
  retention_until: string
  legal_hold: boolean
  state: string
}

export interface EvidenceListPage {
  artifacts: EvidenceArtifact[]
  next_cursor: string | null
}

export interface PresignResult {
  artifact_id: string
  url: string
  expires_in_seconds: number
  expires_at: string
}

export class ApiError extends Error {
  readonly code: string
  readonly status: number

  constructor(status: number, code: string, message: string) {
    super(message)
    this.name = 'ApiError'
    this.code = code
    this.status = status
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response
  try {
    response = await fetch(path, {
      ...init,
      headers: { Accept: 'application/json', ...(init?.headers ?? {}) },
      credentials: 'same-origin',
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new ApiError(0, 'network_error', `无法连接 console BFF：${message}`)
  }

  const text = await response.text()
  let payload: unknown = null
  if (text) {
    try {
      payload = JSON.parse(text)
    } catch {
      payload = null
    }
  }

  if (!response.ok) {
    const envelope = payload as { error?: { code?: string; message?: string } } | null
    throw new ApiError(
      response.status,
      envelope?.error?.code ?? String(response.status),
      envelope?.error?.message ?? response.statusText,
    )
  }

  return payload as T
}

export function getHealth(): Promise<ConsoleHealth> {
  return request<ConsoleHealth>('/api/health')
}

export interface EvidenceQuery {
  subjectId?: string
  kind?: string
  since?: string
  limit?: number
  cursor?: string
}

export function listEvidence(query: EvidenceQuery = {}): Promise<EvidenceListPage> {
  const params = new URLSearchParams()
  if (query.subjectId) params.set('subject_id', query.subjectId)
  if (query.kind) params.set('kind', query.kind)
  if (query.since) params.set('since', query.since)
  if (query.limit) params.set('limit', String(query.limit))
  if (query.cursor) params.set('cursor', query.cursor)
  const suffix = params.size > 0 ? `?${params.toString()}` : ''
  return request<EvidenceListPage>(`/api/evidence${suffix}`)
}

export function getEvidence(artifactId: string): Promise<EvidenceArtifact> {
  return request<EvidenceArtifact>(`/api/evidence/${encodeURIComponent(artifactId)}`)
}

/** 让 BFF 向证据服务要一个 60s、单对象的 URL。 */
export function presignEvidence(artifactId: string): Promise<PresignResult> {
  return request<PresignResult>(
    `/api/evidence/${encodeURIComponent(artifactId)}:presign`,
    { method: 'POST' },
  )
}

export interface IntegrationInfo {
  evidence: {
    write_url: string
    auth: string
    username_is_token: boolean
    tenant: string
    allowed_kinds: string[]
    frame_marker: string
  }
  warp_parse: {
    connector: string
    sink_group: string
    env: Record<string, string>
  }
}

export function getIntegration(): Promise<IntegrationInfo> {
  return request<IntegrationInfo>('/api/integration')
}
