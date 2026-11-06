# wist-console-web（数据场 · 现场视图）

计算区**只读**界面：**证据 / 资产拓扑 / 运行指标 / 接口可用性 / 安全设备** 一个入口。

> 展示名「**数据场 · 现场视图**」：现场由三类信号构成 —— 发生过什么（证据）、由什么构成（资产）、
> 现在跑得怎样（指标）。场是由采样重建的，所以“静默”与“少了几条序列”是同一件事：场缺一块。
> 只读，不动手（不重启、不发布、不处置）。
> 技术名保持 `wist-console-web`（仓名 / 镜像名 / 服务名不跟着改）。

- 后端：`wist-console`（BFF），浏览器只跟它说话
- 部署：`wist-console-stack`（计算区，经 VPN / 堡垒机进入）
- 设计：`wist-design/doc/design/console/console-architecture.md`

## 为什么不在接入区

证据正文只在计算区与 COS 之间流动。把浏览界面放在接入区（`wist-center-web` 所在处）等于
让正文和预签名 URL 穿过 DMZ，也违背「center 零 COS 凭据、接入区被攻破拿不到正文」的初衷。
所以本台与 `wist-evidence`、`wist-atlas` 同区（计算区）。

## 页面

| 页面 | 状态 | 数据源 |
|---|---|---|
| 概览 | 可用 | `GET /api/health`（各数据源就绪度 + 接口可用性摘要） |
| 证据 | 可用 | `GET /api/evidence`、`GET /api/evidence/{id}`、`GET /api/evidence/capabilities`（选正文通路）、`POST /api/evidence/{id}:presign` |
| 资产拓扑 | 嵌入 | 同源 `/atlas/`（`wist-atlas-web`） |
| 运行指标 | 占位 | 平台侧尚无聚合（现网的 VM 在各网关栈里） |
| 接口可用性 | 可用 | `GET /api/health.interfaces[]`：逐条探活 + 本次会话可用率 |
| 安全设备 | 占位 | `containment_capabilities` 尚未上报 |

**占位页不是"待美化"，是"没数据源"**：缺什么、按什么顺序接，页面上都写出来了。

## 与 BFF 的契约

```text
GET  /api/health
     → { status, version?, sources: { evidence|atlas|metrics|devices: { status, detail? } },
         interfaces: [{ id, label, covers, url?, status, detail?, latency_ms?, checked_at_ms? }] }

GET  /api/evidence?subject_id=&kind=&since=&limit=&cursor=
     → { artifacts: [EvidenceArtifact], next_cursor }

GET  /api/evidence/{artifact_id}
     → EvidenceArtifact

GET  /api/evidence/capabilities
     → { objects_kind: "file"|"s3"|null, presign_supported: bool }

POST /api/evidence/{artifact_id}:presign
     → { artifact_id, url, expires_in_seconds, expires_at }
```

- 浏览器**不持有**任何凭据；BFF 负责到证据服务的 mTLS 与 scope；
- 正文通路看 `capabilities.presign_supported`：`false`（`objects.kind = file`）直接走
  `GET /api/evidence/{id}/content` 由 BFF 代理读，不用先撞一次 501；
  后端不报 `objects`（老实例）时保留「先试签名、失败再回落」；
- 预签名 60s、单对象，BFF 不缓存 URL；
- 租户与敏感度由证据服务裁决，BFF 只透传 `404`（不区分「不存在」和「无权看」）。

`EvidenceArtifact` 的字段与 `wist-evidence` 索引行一致（见
`design/center/evidence-service.md` §5.1）。

## atlas 嵌入

`wist-atlas-web` 需要：

1. 以 `base: '/atlas/'` 构建（否则 `/assets/*` 会打到本域名根，页面白屏）；
2. 由本容器反代 `location /atlas/ → http://atlas-web:80/`；
3. 深链走 `/atlas/#/host/<id>`，不传 token、不做跨域 iframe。

## 开发

```bash
npm ci
npm run dev        # http://127.0.0.1:5175
```

本机另起 BFF / atlas 时用环境变量覆盖代理目标：

```bash
VITE_CONSOLE_API_TARGET=http://127.0.0.1:19201 \
VITE_ATLAS_DEV_URL=http://127.0.0.1:18080 \
npm run dev
```

## 构建与镜像

```bash
npm run build      # tsc --noEmit + vite build
docker build -t wist-console-web:dev .
```

镜像契约与同级前端一致：`ARG APP_VERSION` → `VITE_APP_VERSION`（页面左下角版本号）。
发版 `v*.*.*` 由 `.github/workflows/release.yml` 推 ghcr + TCR。
