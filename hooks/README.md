# QZAI Hooks 文档

本文档介绍 `hooks/slash-bridge-v1` 的配置、部署与自测。该服务用于把 GitHub Actions 侧的 `/qzai <cmd>` 事件（Actions 已完成解析与验签封装）桥接为一个可验证的 HTTP 请求，并在 GitHub PR/Issue 评论区回写 ACK/Final。

## 1) 服务入口

- Endpoint：`POST /hooks/slash-bridge-v1`
- Content-Type：`application/json`
- 默认端口：`8787`（可通过 `PORT` 覆盖）

## 2) 安全校验（Fail-Closed）

服务会按以下顺序严格校验（任一失败即拒绝）：

1. **签名校验**：Header `X-Hub-Signature-256` 必须符合 `sha256=<hex>` 格式，且等于
   `HMAC_SHA256(SLASH_BRIDGE_HOOK_SECRET, raw_body)`。
2. **时间戳校验**：Header `X-QZAI-Timestamp` 为**毫秒**时间戳，必须在服务器当前时间的 ±5 分钟内。
3. **Nonce 防重放**：Header `X-QZAI-Nonce` 长度必须 ≥ 8；服务会将其写入 SQLite（TTL=10 分钟），重复 nonce 将被拒绝。
4. **deliveryId 去重**：payload `deliveryId` 作为投递去重 key；若同 deliveryId 重复投递，会直接返回之前的 ack。

## 3) 环境变量与 .env

`.env` 放置位置：

- `hooks/slash-bridge-v1/.env`
- 示例模板：`hooks/slash-bridge-v1/.env.example`

注意：
- `.env` 含敏感信息（secret/private key path/token），**禁止提交到仓库**。

### 必要环境变量（与源码一致）

- `PORT`：监听端口（默认 `8787`）
- `SLASH_BRIDGE_DB_PATH`：SQLite 路径（默认 `./slash-bridge-v1.sqlite`）
- `SLASH_BRIDGE_HOOK_SECRET`：HMAC secret
- `SLASH_BRIDGE_ALLOWED_REPOS`：白名单（fail-closed）
  - 格式：`owner/repo` 或 `owner/repo:installationId`
  - 多个用逗号分隔

### 可选：作者权限扩展与限流

- `SLASH_BRIDGE_AUTHOR_ASSOC_EXTRA_ALLOW`：额外允许的 `authorAssociation`（逗号分隔）
  - 默认仅允许：`OWNER` / `MEMBER` / `COLLABORATOR`
- `SLASH_BRIDGE_RATE_WINDOW_MS`：限流窗口（毫秒，默认 60000）
- `SLASH_BRIDGE_RATE_MAX`：窗口内最大次数（默认 5）

### GitHub 鉴权（二选一）

服务会在每次请求中获取用于回写 GitHub 评论的 token：

- 方式 A（本地调试可用）：`GITHUB_TOKEN`
- 方式 B（推荐）：GitHub App
  - `SLASH_BRIDGE_GH_APP_ID`
  - `SLASH_BRIDGE_GH_APP_PRIVATE_KEY_PATH`
  - Installation ID：优先使用请求 payload 里的 `installationId`（或你设置了 `SLASH_BRIDGE_GH_APP_INSTALLATION_ID` 作为兜底）

#### 多身份（按 routed agent 切换 GitHub 身份）

为了让“不同角色/agent”以各自的 GitHub 身份回写评论/检查，本服务支持 **agent 专属 env 覆盖**。

命名规则：在变量名后追加 `__<AGENTID大写>`（例如 `__LUXIAOFENG`）。优先级为：

1) `GITHUB_TOKEN__<AGENT>`（若存在直接用）
2) `SLASH_BRIDGE_GH_APP_ID__<AGENT>` + `SLASH_BRIDGE_GH_APP_PRIVATE_KEY_PATH__<AGENT>` + installationId（CLI/请求/或 `SLASH_BRIDGE_GH_APP_INSTALLATION_ID__<AGENT>`）
3) fallback 到全局 `GITHUB_TOKEN` 或全局 `SLASH_BRIDGE_GH_APP_*`

示例请参考：`hooks/slash-bridge-v1/.env.example`。

## 4) v1 路由与 agentId override

v1 内置最小命令集路由（含向后兼容别名）：

- `plan` / `plan-pr` → `lixunhuan`
- `implement` / `impl-pr` / `followup` / `pr-desc` → `lengyan`
- `review` → `lixunhuan`
- `security` → `jingwuming`

支持 payload 里传 `agentId` 覆盖路由，但会做白名单校验（防止任意 agent 提权）。

## 5) Payload（schemaVersion=1）

服务期望请求体是一个 JSON 对象，并包含以下字段。

### Required（与 server.js 一致）

- `schemaVersion`
- `deliveryId`
- `command`
- `repo`
- `installationId`
- `issueNumber`
- `commentId`
- `commentUrl`
- `headSha`
- `baseSha`
- `requestedBy`
- `requestedAt`
- `authorAssociation`
- `idempotencyKey`

### Optional

- `args`
- `agentId`
- `prNumber`

## 6) 本地 curl selftest（签名 + timestamp + nonce）

前置：确保你已在 `hooks/slash-bridge-v1/.env` 设置好 `SLASH_BRIDGE_HOOK_SECRET` 等变量，并启动服务。

### 6.1 生成 payload 与签名（python）

```bash
python3 - <<'PY'
import os, json, time, hmac, hashlib, secrets

secret = os.environ.get('SLASH_BRIDGE_HOOK_SECRET', 'your_webhook_secret_here').encode()

payload = {
  "schemaVersion": 1,
  "deliveryId": "delivery_local_001",
  "command": "plan-pr",
  "args": "--demo",
  "repo": "owner/repo",
  "installationId": 123456,
  "issueNumber": 42,
  "commentId": 987654321,
  "commentUrl": "https://github.com/owner/repo/pull/42#issuecomment-987654321",
  "headSha": "abcdef1234567890abcdef1234567890abcdef12",
  "baseSha": "1234567890abcdef1234567890abcdef12345678",
  "requestedBy": "test-user",
  "requestedAt": time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()),
  "authorAssociation": "OWNER",
  "idempotencyKey": "idem_local_001",
}

raw = json.dumps(payload, separators=(',', ':'), ensure_ascii=False)

sig = hmac.new(secret, raw.encode(), hashlib.sha256).hexdigest()
ts_ms = str(int(time.time() * 1000))
nonce = secrets.token_hex(16)

print(raw)
print(sig)
print(ts_ms)
print(nonce)
PY
```

### 6.2 发送请求（curl）

将上一段输出的 4 行依次填入：

- `<RAW_JSON>`
- `<SIG_HEX>`
- `<TS_MS>`
- `<NONCE>`

```bash
curl -sS -X POST 'http://127.0.0.1:8787/hooks/slash-bridge-v1' \
  -H 'Content-Type: application/json' \
  -H 'X-Hub-Signature-256: sha256=<SIG_HEX>' \
  -H 'X-QZAI-Timestamp: <TS_MS>' \
  -H 'X-QZAI-Nonce: <NONCE>' \
  -d '<RAW_JSON>' | jq .
```

预期：返回 `ack`，并尝试回写 GitHub 评论（需要正确配置 GitHub 鉴权）。

## 7) macOS launchd 部署

我们提供了统一脚本在 macOS 上安装/卸载 LaunchAgent（不把 secret 写进 plist，运行时由 `run.sh` 读取 `.env`）：

- 安装并启动：

```bash
bash scripts/slash_bridge_v1_launchd_install.sh
```

- 停止并卸载：

```bash
bash scripts/slash_bridge_v1_launchd_uninstall.sh
```

日志：
- `/tmp/openclaw/slash-bridge-v1.out.log`
- `/tmp/openclaw/slash-bridge-v1.err.log`
