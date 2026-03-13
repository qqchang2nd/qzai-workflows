# hooks 部署说明（qzai-workflows）

本目录包含 `slash-bridge-v1` 的 hook server 实现，用于将 GitHub Actions 侧的 `/qzai <cmd>` 评论事件桥接到 OpenClaw 执行（v1 可先 stub），并将 ACK/Final 回写 GitHub。

> 形态1：`GitHub Actions -> HTTP POST -> Hook endpoint -> (独立 agent 执行) -> GitHub 回写`

## 1. 目录结构

- `hooks/slash-bridge-v1/`
  - `src/server.js`：HTTP server（`POST /hooks/slash-bridge-v1`）
  - `src/db.js`：SQLite 存储（nonce/delivery/idempotency）
  - `src/github.js`：GitHub 回写（issue_comment + check-run）

## 2. 安全门禁（Fail-Closed）

Hook 侧严格校验（任一失败即拒绝）：

- `X-Hub-Signature-256`：HMAC-SHA256（`sha256=<hex>`）
- `X-QZAI-Timestamp`：与服务端时钟偏差必须在 `±5min`
- `X-QZAI-Nonce`：一次性 nonce，TTL=10min（SQLite 存储防重放）

## 3. 最小存储（SQLite）

v1 使用单文件 SQLite（落盘），包含：

- `nonces(nonce, expires_at_ms)`：重放防护
- `deliveries(delivery_id, ack_json)`：deliveryId 去重（Actions 侧 v1 用 surrogate）
- `commands(idempotency_key, status, trace_id, run_id, final_json)`：命令级幂等

每次请求会清理过期数据（TTL）。

## 4. 环境变量

Hook server 运行时必须配置：

- `SLASH_BRIDGE_HOOK_SECRET`：与 Actions 侧一致的 HMAC secret
- `GITHUB_TOKEN`：用于回写 GitHub（建议 GitHub App installation token）
- `SLASH_BRIDGE_DB_PATH`：SQLite 文件路径（默认 `./slash-bridge-v1.sqlite`）
- `PORT`：监听端口（默认 8787）

## 5. 本地运行（tunnel 未验证前 E2E）

```bash
cd hooks/slash-bridge-v1
npm i
export SLASH_BRIDGE_HOOK_SECRET='...'
export GITHUB_TOKEN='...'
export PORT=8787
npm start
```

然后用本机 curl 发送请求（示例为最小 payload；实际 Actions 会带更多字段）：

```bash
export SLASH_BRIDGE_HOOK_SECRET='...'
TS=$(python3 - <<'PY'
import time; print(int(time.time()*1000))
PY
)
NONCE=$(python3 - <<'PY'
import secrets; print(secrets.token_hex(16))
PY
)
export BODY='{"schemaVersion":1,"deliveryId":"local-dev","traceId":"trc_local","runId":"run_local","command":"plan","args":"","repo":"qqchang2nd/qzai-workflows","installationId":0,"issueNumber":10,"commentId":123,"commentUrl":"https://github.com/...","headSha":"","baseSha":"","requestedBy":"local","requestedAt":"2026-03-13T00:00:00Z","idempotencyKey":"qqchang2nd/qzai-workflows#10#head#plan#args#local#123"}'
SIG=$(python3 - <<'PY'
import hmac,hashlib,os
secret=os.environ['SLASH_BRIDGE_HOOK_SECRET'].encode()
body=os.environ['BODY'].encode()
print(hmac.new(secret, body, hashlib.sha256).hexdigest())
PY
)

curl -sS -X POST 'http://127.0.0.1:8787/hooks/slash-bridge-v1' \
  -H "Content-Type: application/json" \
  -H "X-Hub-Signature-256: sha256=$SIG" \
  -H "X-QZAI-Timestamp: $TS" \
  -H "X-QZAI-Nonce: $NONCE" \
  -d "$BODY" | jq .
```

预期：
- Hook 返回 200 + ack JSON
- GitHub 对应 issue/PR 会出现 ACK comment，随后出现 Final comment（v1 stub）

## 6. Tunnel 部署（Cloudflare）

将该服务暴露到：

- `https://bridge.tendou.eu.org/hooks/slash-bridge-v1`

并在 repo secrets 配置：

- `OPENCLAW_GATEWAY_URL=https://bridge.tendou.eu.org`
- `SLASH_BRIDGE_HOOK_SECRET=<same secret>`

## 7. GitHub Actions 侧（触发与失败回写）

本仓库 workflow：`.github/workflows/qzai-slash-bridge-v1.yml`

- 在 `issue_comment(created)` 检测首行 `/qzai <cmd>`
- 组装 payload + `X-Hub-Signature-256` + `X-QZAI-Timestamp` + `X-QZAI-Nonce`
- HTTP POST 到 `${OPENCLAW_GATEWAY_URL}/hooks/slash-bridge-v1`
- 若 POST 失败：必须回写 comment +（PR 场景）check-run，包含错误原因与排查建议
