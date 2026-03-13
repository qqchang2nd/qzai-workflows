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


## Commands & Use cases（v1）

当前 v1 hook 支持的命令集非常小（仅用于验证桥接链路）。命令由 Actions 侧解析：评论首行形如：

```text
/qzai <command> [free-form args]
```

### 支持的 commands（默认路由）

| command | 默认 agentId | use case（1 句话） |
|---|---:|---|
| `plan-pr` | `luxiaofeng` | 生成/更新计划、拆解任务、输出执行清单（偏规划类）。 |
| `review` | `afei` | 对 PR/改动做 review 建议、指出风险与改进点（偏评审类）。 |
| `security` | `jingwuming` | 进行安全相关检查与建议（偏安全类）。 |

> v1：用户在评论里指定 agentId 默认不支持（由 hook 侧路由表决定）。
> 兼容：短期保留 `plan` 作为 `plan-pr` 的 alias（文档以 `plan-pr` 为准）。

### 输出（ACK / Final）

- ACK：hook 收到并通过鉴权后，会在目标 PR/Issue 回贴一条 ACK comment，包含 `traceId/runId`、`reasonCode`（若拒绝）、以及 `nextAction`。
- Final：异步执行完成后回贴 Final comment；同时在 `headSha` 存在时写一个 check-run `slash-bridge-v1/final`。

### 不支持的命令

- 若 command 不在路由表中，hook **fail-closed**：回贴 ACK（`reasonCode=ROUTE_NOT_FOUND`），不触发执行。

### 最小 E2E checklist（命令覆盖）

- [ ] `/qzai plan-pr` -> ACK + Final（agentId= luxiaofeng）
- [ ] `/qzai review` -> ACK + Final（agentId= afei）
- [ ] `/qzai security` -> ACK + Final（agentId= jingwuming）
- [ ] `/qzai unknown` -> ACK 拒绝（ROUTE_NOT_FOUND），无 Final


### Actions command ↔ Hook command 映射（避免命名漂移）

> 说明：本 PR 的 hook server 使用 `payload.command` 作为路由键；Actions 侧从评论首行 `/qzai <token>` 解析得到 `<token>` 并直接写入 `payload.command`。

当前 v1 仅保证最小闭环命令集可跑通（见上表）。其它命令会 fail-closed。

| 用户输入（GitHub comment 首行） | Actions 解析 token | hook payload.command | hook 路由结果 |
|---|---|---|---|
| `/qzai plan-pr` | `plan` | `plan-pr` | `luxiaofeng` |
| `/qzai review` | `review` | `review` | `afei` |
| `/qzai security` | `security` | `security` | `jingwuming` |
| `/qzai plan-pr` | `plan-pr` | `plan-pr` | fail-closed `ROUTE_NOT_FOUND`（v1 不实现） |
| `/qzai impl-pr` | `impl-pr` | `impl-pr` | fail-closed `ROUTE_NOT_FOUND`（v1 不实现） |
| `/qzai followup` | `followup` | `followup` | fail-closed `ROUTE_NOT_FOUND`（v1 不实现） |

建议 roadmap（不在本 PR 扩 scope）：
- v1.1：补齐 `plan-pr/impl-pr/followup` 的 command 解析与 payload schema（包含 plan url / pr context），hook 侧路由到对应 agent；仍由 agent 执行并回写。
- v2：统一命令命名与 spec（例如将 `plan-pr/impl-pr` 作为 `plan/impl` 的 mode 参数），并完善 args schema / policy。
