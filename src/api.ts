// BFF（`wist-console`）的客户端。
//
// 浏览器**只跟 BFF 说话**：证据的 mTLS、租户/敏感度闸、预签名代签都在 BFF 里完成；
// 这个文件不持有任何**服务**凭据（证据服务的证书、COS 的密钥都不在这里）。
// 唯一的凭据是操作员自己的访问令牌（`wcr_…`），由 `auth.ts` 管，进 `Authorization` 头。

import { getToken, notifyUnauthorized } from './auth'

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
  /** 这一次探活到底验到了哪一层（BFF 侧写的，不是前端猜的）。 */
  covers?: string
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
  const token = getToken()
  let response: Response
  try {
    response = await fetch(path, {
      ...init,
      headers: {
        Accept: 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(init?.headers ?? {}),
      },
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
    const code = envelope?.error?.code ?? String(response.status)
    if (response.status === 401) {
      // token 没了 / 过期 / 被撤销：清掉本地副本并让 App 弹出输入框。
      notifyUnauthorized()
    }
    throw new ApiError(
      response.status,
      code,
      envelope?.error?.message ?? response.statusText,
    )
  }

  return payload as T
}

export function getHealth(): Promise<ConsoleHealth> {
  return request<ConsoleHealth>('/api/health')
}

/** 登录的结果：把令牌换成「你是谁 + 给了什么角色」。 */
export interface LoginResult {
  credential_id: string
  subject: string
  roles: string[]
  audience: string
  /** Unix 秒。 */
  expires_at: number
}

/**
 * 校验访问令牌（`POST /api/login`，契约由 `wist-cred-peer` 统一）。
 *
 * 以前前端是“拿 `/api/health` 试一下”来验证令牌 —— 那只能知道能不能进，
 * 不知道进来的是谁；失败时也只能按状态码猜原因。
 */
export function login(token: string): Promise<LoginResult> {
  return request<LoginResult>('/api/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token }),
  })
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

/**
 * 代理读正文：本地文件存储（`objects.kind = file`）没有预签名 URL，
 * 页面直接开这个地址，由 BFF 带身份去证据服务取原文。
 */
export function contentUrl(artifactId: string): string {
  return `/api/evidence/${encodeURIComponent(artifactId)}/content`
}

export interface IntegrationInfo {
  evidence: {
    write_url: string
    /** `none`：现在不校验（内网可信）；将来换成 HTTPS 双向认证。 */
    auth: string
    /** 客户 id —— 租户与客户已经合并成一个维度。 */
    customer: string
    allowed_kinds: string[]
    /** 三字段示例：`cust_id` / `cmd_id` / `content`。 */
    record: Record<string, unknown>
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
