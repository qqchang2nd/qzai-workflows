# QZAI Workflows

## 概览

```
GitHub 评论 /qzai <cmd>
  → qzai-slash-bridge-v1.yml（解析命令 + 收集上下文）
  → HMAC 签名 POST → slash-bridge-v1 Hook Server
      验签 / 限流 / 幂等 / 路由
      → Dispatch 任务到 Agent（A2A）
  ← Agent 执行（生成代码/review/plan）
  ← Hook Server 更新 final comment
```

---

## Workflow 列表

### 核心触发

#### `qzai-slash-bridge-v1.yml`
- **触发**：`issue_comment: created`（含 `/qzai` 的评论）
- **职责**：解析命令 → 收集 PR 上下文（headSha/baseSha/installationId）→ HMAC 签名 POST 到 Hook Server
- **互斥**：单条评论一个并发组，`cancel-in-progress: false`
- **适用范围**：PR 评论（v1 不支持 Issue 评论，fail-closed）
- **支持命令**：`plan` `implement` `review` `security` `followup` `pr-desc`（及旧命名别名）

#### `qzai-issue-commands.yml`（Reusable）
- **触发**：被 wrapper 调用
- **职责**：处理纯 Actions Issue 命令：`status` `decide` `subtask`
- **互斥**：`eyes` reaction 作为 2 分钟并发锁

#### `qzai-two-stage-pr.yml`（Reusable）
- **触发**：被 wrapper 调用
- **职责**：两阶段 Plan + Impl PR 流程（旧路径，新路径走 slash-bridge-v1）

---

### 自动化触发

#### `qzai-plan-auto-trigger.yml`
- **触发**：`issues: labeled`（label = `type:feat`）
- **职责**：自动在 Issue 上评论 `/qzai plan`
- **互斥**：无（评论幂等）
- **注意**：若 Issue 已有 `status:in-progress` 等进行中标签则跳过

#### `qzai-impl-auto-trigger.yml`
- **触发**：`pull_request: closed`（merged = true，label = `qzai:plan`）
- **职责**：Plan PR merge 后自动评论 `/qzai implement`
- **互斥**：无

#### `qzai-review-auto-first.yml`
- **触发**：`pull_request: opened` 或 `labeled`（label = `qzai:impl`）
- **职责**：Impl PR 创建后自动触发首轮 `/qzai review`
- **互斥**：检查是否已有 `autoTriggered: true` 的 review 评论，避免重复

#### `qzai-review-loop.yml`
- **触发**：`pull_request: synchronize`（push 新 commit）
- **职责**：PR push 后检查 review_rounds 状态，若 `pending_fix` 则自动触发下一轮 review
- **互斥**：同 PR 一个并发组，`cancel-in-progress: false`

---

### 检查 & 收尾

#### `qzai-pr-link-check.yml`
- **触发**：`pull_request: opened / edited / synchronize`
- **职责**：验证 PR body 包含 `Closes #N` 或 `Refs #N`（fail-closed check-run）
- **豁免**：draft PR、`qzai:plan` label 的 PR

#### `qzai-issue-close.yml`
- **触发**：`pull_request: closed`（merged = true）
- **职责**：Impl PR merge 后，将 PR body 中 `Closes #N` 引用的 Issue 状态改为 `status:done`
- **豁免**：`qzai:plan` label 的 PR

---

## 循环触发防护

| 风险 | 防护措施 |
|------|---------|
| bot 自评论触发 slash-bridge | 检查 `github.actor` 不等于 bot 账号 |
| plan auto-trigger 无限循环 | 检查 Issue 已有进行中状态标签 |
| review-auto-first 重复触发 | 检查是否已有 `autoTriggered` 评论 |
| review-loop 无限循环 | max_reached 状态下停止触发 |

---

## Label 约定

| Label | 含义 |
|-------|------|
| `type:feat` | 功能类 Issue，触发 plan auto-trigger |
| `qzai:plan` | Plan PR |
| `qzai:impl` | Impl PR，触发 review-auto-first |
| `status:todo` | Issue 状态 |
| `status:in-progress` | Issue 状态 |
| `status:blocked` | Issue 状态 |
| `status:review` | Issue 状态 |
| `status:done` | Issue 状态 |
