# Slash Bridge v1 规格（稳定版）

> 状态：Draft v1（用于 GitHub 评论触发 `/qzai <command>`）  
> 范围：GitHub `issue_comment` -> Hook -> OpenClaw Agent -> GitHub 回写

## 1. 端到端数据流

默认分发模式：**方案 A（Hook 直连执行独立 Agent）**。

1) 接收 GitHub `issue_comment` webhook，解析首行 slash 命令。  
2) 预检：命令白名单、作者策略、repo/installation allowlist。  
3) 安全门禁：签名/时间戳/nonce 校验（fail-closed）。  
4) 双层去重：
   - 传输级：`deliveryId`（`X-GitHub-Delivery`）
   - 命令级：`idempotencyKey`（见第 3 节）
5) 分发执行（默认方案 A）：生成 `traceId/runId` 后，Hook 侧**直连触发目标独立 Agent**执行（不经二次 A2A 中转）。  
6) 回写 GitHub：
   - 快速 ACK（accepted/rejected + runId）
   - Final 结果（comment/review/check-run，按命令配置）

## 2. 安全门禁（Fail-Closed，可执行口径）

## 2.1 签名校验（MUST）
- Header：`X-Hub-Signature-256`  
- 算法：`HMAC-SHA256`  
- 原文：GitHub 原始请求体（raw payload）  
- 密钥来源：服务端密钥管理（环境变量或密钥服务，不进仓库）  
- 失败回码：`SIG_INVALID`

## 2.2 重放防护（MUST）
- 时间窗口：`requestedAt` 与服务端时钟偏差必须在 `±5 分钟` 内  
- nonce：一次性使用，建议 TTL=`10 分钟`  
- nonce 冲突：直接拒绝  
- 失败回码：`TIMESTAMP_EXPIRED` / `NONCE_REPLAY`

## 2.3 Repo / Installation allowlist（MUST）
- 配置来源：服务端配置（部署配置或受控配置中心）  
- 匹配规则：`owner/repo` 精确匹配，默认拒绝（no default allow）  
- installation 必须与 allowlist 中该 repo 的 installationId 一致  
- 失败回码：`REPO_NOT_ALLOWED` / `INSTALLATION_MISMATCH`

## 2.4 作者策略（MUST）
- 默认允许：`OWNER | MEMBER | COLLABORATOR`  
- 外部贡献者（如 `CONTRIBUTOR`）可配置是否允许“只读/只记录”命令  
- 默认策略：未命中允许集合即拒绝  
- 失败回码：`AUTHOR_NOT_ALLOWED`

## 2.5 限流（MUST）
- key：`repo + actor + command`  
- 建议窗口：`60 秒`；阈值：`5 次/窗口`（可配置）  
- 超限行为：拒绝并返回重试建议  
- 失败回码：`RATE_LIMITED`

> 任一门禁失败：不得触发 Agent 执行；必须回写拒绝 ACK（含 `traceId` + `reasonCode`）。

## 3. 幂等与去重（两层）

## 3.1 传输级去重（deliveryId）
- 键：`deliveryId = X-GitHub-Delivery`  
- 存储：KV（TTL 建议 `24h`）  
- 行为：重复 delivery 直接返回首个 ACK，不重复分发

## 3.2 命令级去重（idempotencyKey）
- 组成字段：
  - `repo`
  - `issueOrPrNumber`
  - `headSha`
  - `command`
  - `argsHash`
  - `requestedBy`
  - `commentId`（或 `commandIndex`，二选一但需稳定）
- 存储：可持久化 KV/DB（TTL 建议 `7d`）
- 建议最终 key 形态：`repo#issueOrPr#headSha#command#argsHash#requestedBy#commentId`。
- 状态语义：
  - `in_progress`：返回已有 `runId`（`status=IN_PROGRESS`）
  - `completed`：返回上次 Final 结果引用（`status=ALREADY_DONE`）
  - `failed`：可按策略允许重试
- 强制重跑：需显式 `--force`；语义为“绕过命令级幂等”，但仍保留 `deliveryId` 传输去重；并记录 `parentRunId`。

## 4. Payload Schema v1（字段 + 来源）

```json
{
  "schemaVersion": 1,
  "deliveryId": "uuid-from-github",
  "traceId": "trc_xxx",
  "runId": "run_xxx",
  "command": "review",
  "args": "--scope diff",
  "repo": "qqchang2nd/qzai-workflows",
  "owner": "qqchang2nd",
  "installationId": 123456,
  "issueNumber": 48,
  "prNumber": 49,
  "commentId": 4051032787,
  "commentUrl": "https://github.com/.../issuecomment-...",
  "prUrl": "https://github.com/.../pull/49",
  "headSha": "abcdef...",
  "baseSha": "123456...",
  "requestedBy": "qqchang2nd",
  "requestedAt": "2026-03-12T23:39:05Z",
  "idempotencyKey": "repo#pr#head#command#argsHash#actor#commentId"
}
```

必填字段：`schemaVersion, deliveryId, traceId, runId, command, repo, installationId, commentId, headSha, requestedBy, requestedAt, idempotencyKey`。

字段可信度要求：
- 来自 webhook：`deliveryId/commentId/requestedBy/requestedAt`（需签名校验通过）
- 需二次查询 GitHub API：`headSha/baseSha/prNumber/installationId`（防伪造）


## 4.1 command -> agentId 路由规则（方案 A 核心）

### 默认路由表（v1）
- `review` -> `afei`
- `security` -> `jingwuming`
- `plan` -> `luxiaofeng`

> 路由表来源：受控配置（仓库配置文件或服务端配置），必须可审计。

### 是否允许用户指定 agentId
- 默认：**禁止**在 comment 中任意指定 `agentId`。
- 可选放开：仅当 `agentId` 在命令级 allowlist 中且调用者具备对应权限策略时允许。

### 失败与回写（fail-closed）
- 未命中路由：`ROUTE_NOT_FOUND`
- 命中但 agent 不在 allowlist：`AGENT_NOT_ALLOWED`
- 指定 agent 与策略冲突：`AGENT_POLICY_DENIED`

以上情况均：拒绝执行 + ACK 回写 reasonCode + traceId。

## 5. 失败模式与回写策略

## 5.1 回写相位
1) **ACK（快速）**：必须写 `issue_comment`（至少 1 条）
2) **Final（异步）**：按命令配置写 comment/review/check-run

## 5.2 ACK 最小字段（MUST）
- `accepted`（true/false）
- `traceId`
- `runId`（若已生成）
- `reasonCode`（拒绝或失败时）
- `nextAction`（可执行建议）

## 5.3 Final 最小字段（MUST）
- `verdict`（success|failed|timeout|partial）
- `summary`
- `evidenceLinks`（日志/产物/关联链接）
- `errorCode`（失败时）
- `traceId/runId`

## 5.4 写回失败兜底
- 重试：指数退避（例如 1s/4s/16s，最多 3 次）
- 回写幂等键：`(runId, targetType, targetId)`
- 重试耗尽：写入 dead-letter（持久化存储）并提供人工重放入口

## 6. 命令解析规则（v1 最小）
- 仅解析第一非空行为 `/qzai <command> ...`
- 忽略 code block / quote 内的命令文本
- 仅允许白名单命令，未知命令直接拒绝（`COMMAND_NOT_ALLOWED`）
- key/value 参数采用严格解析，非法参数拒绝（`ARGS_INVALID`）

## 7. 示例（端到端）

输入：PR 评论 `/qzai review --scope diff`

- ACK 示例：
  - `accepted=true, runId=run_123, traceId=trc_abc, nextAction=等待最终结果`
- Final 示例：
  - `verdict=success, summary=发现2项风险, evidenceLinks=[...], traceId=trc_abc`

若签名失败：
- ACK：`accepted=false, reasonCode=SIG_INVALID, traceId=trc_xxx`

## 8. Plan 与 Spec 关系
- Plan 审计索引：`.qzai/plans/i48-c4051032787/PLAN.md`
- 稳定实现规格：`.qzai/specs/slash-bridge-v1.md`（本文件）
- 若两者冲突，以稳定 spec 为准。
