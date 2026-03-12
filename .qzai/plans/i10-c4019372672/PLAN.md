# PLAN v3: PR Slash Review Workflow（Issue #10 / PR #29）

> 本版基于 Master 行内反馈重写，聚焦“PR 上通过 slash 指定 bot review + Owner 决策动作”。

## 0) 反馈对齐清单

- Feedback-1（命令参数统一 `agentId`）  
  https://github.com/qqchang2nd/qzai-workflows/pull/29#discussion_r2902089588
- Feedback-2（解释 `review-id` 与 `mode`）  
  https://github.com/qqchang2nd/qzai-workflows/pull/29#discussion_r2902091025

- Feedback-3（reviewer→owner 反馈闭环）  
  https://github.com/qqchang2nd/qzai-workflows/pull/29#issuecomment-4020298707

- Feedback-4（通知机制 + /qzai re-review 收敛）  
  https://github.com/qqchang2nd/qzai-workflows/pull/29#issuecomment-4020312169

本版结论：四条均 **采纳**。

---

## 1) 目标 / 非目标

### 目标
1. 在 PR 对话区通过 slash 命令指定 bot 执行 code review。
2. review 结果同时输出人类可读与机读审计载体。
3. Owner 可通过 slash 明确“按 review 修改”或“拒绝修改”。
4. 与现有 `/qzai plan-pr`、`/qzai impl-pr`、issue commands wrapper 互斥，避免双触发/黑洞。
5. 全链路 GitHub App 身份执行，具备可审计性。

### 非目标
1. 不实现 plan-pr/impl-pr 逻辑（已实现）。
2. 不依赖 GitHub `@mention` 作为触发机制。
3. 不在本版支持代码行内 review comment 触发。

Owner 定义：**Owner = 当前 PR author（发起者）**，不是 repo owner。

---

## 2) 命令协议（统一使用 `agentId`）

> 触发来源必须是 `issue_comment`（PR conversation）+ 首行严格 slash 命令。

## 2.1 发起评审

```text
/qzai review
agentId: <required>
scope: <optional: diff|files|full>
focus: <optional free text>
```

字段约束：
- `agentId`：必填，必须命中 allowlist（`.qzai/apps.json`）。
- `scope`：默认 `diff`。
- 权限不足/参数缺失/agent 不合法：fail-closed + 回帖。

## 2.2 Owner 决策（按评审处理）

```text
/qzai apply-review
agentId: <required>
review-id: <required>
mode: <required: apply|reject|partial>
note: <optional>
```

`apply-review` 的含义是“Owner 对本轮 review 给出处理决策（承诺事件）”，使用时机为：收到 review-bot 自动通知后、准备开始修改前，由 Owner（或具备 write 权限者）发起。
- 在 Owner 无 write 权限（外部贡献者/fork PR）场景下，`apply-review` 仍可执行且仅记录承诺与状态，不直接触发敏感写操作。
- `mode=apply|partial`：状态**必须**进入 `awaiting_owner_changes`；Owner 满足完成条件后进入 `applied`（随后可触发 rerun/followup）：
  1) 提交修复 commit（MUST）；
  2) 在对应 review 线程回复处理结果（MUST，含 commit sha 或不采纳理由）。
- `mode=reject`：流程直接进入 `rejected` 终态（MUST）。

### `review-id` 定义（采纳反馈-2）
- 含义：一次已完成 review 轮次的唯一标识。  
- 生成时机：`/qzai review` 进入 `reviewed` 状态后由系统生成。  
- 建议格式：`rvw_<prNumber>_<shortHeadSha>_<agentId>_<seq>`。  
- 用途：让 Owner 明确“针对哪一轮 review”做决策，避免串单。

### `mode` 定义（采纳反馈-2）
- `apply`：Owner 接受本轮 review，进入修改执行阶段。  
- `reject`：Owner 明确拒绝本轮建议，流程收敛为 rejected。  
- `partial`：Owner 部分采纳，需在 `note` 写范围。

### 触发权限（apply-review）
- **方案选择：B（写死）**。
- 允许 PR author（Owner）在无 write 权限时发送 `/qzai apply-review`，其语义仅为“承诺事件记录/状态流转”（不触发敏感写操作）。
- 具备 `permission>=write` 的用户也可发送 `/qzai apply-review`（协作者代发/推进）。
- 任何会触发敏感写操作的步骤（如自动推送代码、合并、标签写入）仍必须由 write 权限者或受信 App 执行。
- review-bot 不应自发发送该命令（避免自触发闭环）。

## 2.3 reviewer -> owner 反馈闭环（更新）

reviewer 给出评论后，owner（PR 发起者）的回应路径固定为三步：

1. **通知触达（主方案）**：review-bot 完成 review 后，**必须（MUST）**自动在 PR conversation 发一条 `issue_comment` 通知（摘要 + next actions）。
2. **owner 决策动作**：Owner 在收到通知并准备开始处理后发送 `/qzai apply-review`（`mode=apply|partial|reject`）。
3. **重审触发（命令收敛）**：不新增 `/qzai re-review`，统一复用 `/qzai review`。

### 角色映射示例（新增）
- Owner = PR author（负责修改者）。示例：`luxiaofeng`。
- Reviewer = 执行 review 的 agent（可与 Owner 不同）。示例：`qzai`。
- Master = 监督/裁决角色。示例：`qqchang2nd`。

关键约束（MUST）：Master 不作为主链路消息总线；主链路触达必须由 review-bot 自动通知完成。

### 通知机制（不依赖 @mention）

主方案（A）：**自动 issue_comment 通知**（MUST）
- 触发时机：review 进入 `reviewed` 后立即发送。
- 发送者：对应 `agentId` 的 review-bot GitHub App 身份（MUST）。
- 触达约束：不得依赖 Master 转发，也不要求 reviewer 另开 comment 触发通知（MUST）。
- 通知内容 schema（MUST）：
  - `reviewId`
  - `prNumber`
  - `headSha`
  - `summaryBySeverity`（high/medium/low 计数）
  - `unresolvedCount`
  - `nextAction`（可复制模板，示例：`/qzai apply-review\nagentId: <agentId>\nreview-id: <reviewId>\nmode: <apply|partial|reject>`）
  - `attestationUrl`（指向 `qzai/review-attestation`）

Fallback（B）：**check-run + required status**（SHOULD）
- `qzai/review-attestation` 作为 required check，使 owner 在 PR checks 视图可见待处理状态。

可选兜底（C）：手动拉取命令（COULD）
- `/qzai review-summary` 拉取未处理 comments 摘要；仅作为补救路径，不作为主触达机制。

### `/qzai review` 覆盖重审场景（采纳反馈-4）

`/qzai review` 新增可选参数：

```text
/qzai review
agentId: <required>
mode: <optional: initial|rerun|followup>
review-id: <optional, required when mode=followup>
scope: <optional>
focus: <optional>
```

规则：
- 首次评审：`mode=initial`（默认）。
- 重跑同一轮（代码更新后）：`mode=rerun`。
- 跟进指定轮次：`mode=followup` + `review-id`（必填）。
- 因此不再需要独立 `/qzai re-review` 命令。

---

## 3) 触发机制与互斥（避免双触发）

现有 workflows：
- `qzai-issue-commands-wrapper.yml`
- `qzai-issue-commands.yml`
- `qzai-two-stage-pr-wrapper.yml`
- `qzai-two-stage-pr.yml`

新增 review flow guard：
1. 仅匹配 `/qzai review`、`/qzai apply-review`。
2. 仅 `issue_comment` + `action=created` + `issue.pull_request != null`。
3. 与 two-stage 命令集互斥：`plan-pr/impl-pr` 路由不得命中 review flow。
4. 若路由多命中或无法判定：fail-closed 并回帖“路由冲突”。

---

## 4) 输出载体与格式约束

## 4.1 载体
1. **PR Review**：人类可读审查意见（comment/request changes/approve）。
2. **Check-run `qzai/review-attestation`**：机读审计与状态断言。

## 4.2 `qzai/review-attestation` 最小字段
`output.summary` MUST 包含：
- `reviewId`
- `agentId`
- `appSlug`
- `appId`
- `installationId`
- `prNumber`
- `headSha`
- `decision`（comment|request_changes|approve）
- `status`（completed|failed|timeout）

缺失/不一致：fail-closed。

---

## 5) 状态机与幂等

## 5.1 状态机（最小）
`requested -> reviewing -> reviewed -> apply_requested -> awaiting_owner_changes -> applied`  
闭环扩展：
- `applied -> review_requested(mode=rerun|followup) -> reviewing -> reviewed`

等价终态：
- `rejected`（mode=reject）
- `partial_applied`（mode=partial，随后可 `review_requested`）
- `timeout`（reviewed 或 apply_requested 后超时未决）

## 5.2 幂等键
- `reviewKey = <repo>#<pr>#<headSha>#<agentId>`
- `decisionKey = <reviewId>#<mode>`

规则：
- 同 `reviewKey` 重复 `/qzai review`（mode=initial）：复用已存在 review 轮次，不重复发起。
- `/qzai review` 在 `mode=rerun|followup` 下使用 `rerunKey = <reviewId>#<headSha>#<agentId>#<mode>` 去重。
- 同 `decisionKey` 重复 `/qzai apply-review`：仅首个生效，后续回帖“已处理”。

---

## 6) 安全门禁（Fail-Closed）

1. 权限校验：`author_association` 或 `permission>=write`；API 异常视为拒绝。  
2. `agentId` 必须在 `.qzai/apps.json` 白名单。  
3. 忽略 bot 自身评论（按 API `sender.login` 比对）。  
4. 禁止人类账号作为系统流程输出作者（若检测到则该轮标记无效）。

---

## 7) 端到端命令示例（含失败返回）

## 示例 A：正常发起 review
```text
/qzai review
agentId: luxiaofeng
scope: diff
focus: security and regression
```
期望：进入 `requested->reviewing->reviewed`，产出 PR Review + attestation。

## 示例 B：Owner 接受并执行
```text
/qzai apply-review
agentId: luxiaofeng
review-id: rvw_29_a733aad_luxiaofeng_1
mode: apply
```
期望：进入 `apply_requested->awaiting_owner_changes`；owner 完成 commit+线程回复后进入 `applied`。

## 示例 C：失败（无权限或 agentId 非法）
```text
/qzai review
agentId: unknown-bot
```
期望：fail-closed；回帖 `INVALID_AGENT_ID` 或 `PERMISSION_DENIED`。

---


## 示例 D：Owner 线程回复后发起重审（复用 `/qzai review`）
```text
/qzai review
agentId: luxiaofeng
mode: followup
review-id: rvw_29_d955d43_luxiaofeng_1
```
期望：进入 `review_requested(mode=followup)->reviewing->reviewed`，并在 attestation 记录 `parentReviewId`。

## 8) 最小可行 DoD（MVP）

1. 触发不依赖 @mention，仅来自 `issue_comment` slash。  
2. 命令参数统一使用 `agentId`（无 reviewerId/agent/id 混用）。  
3. 明确 `review-id` 与 `mode` 的定义、阶段、发起者。  
4. 提供 2~3 个端到端命令例子（含失败返回）。  
5. 状态机与幂等键可落地、可审计。  
6. 与现有 plan/impl/issue wrappers 的路由互斥规则明确。  
7. reviewer 评论后的 owner 反馈闭环明确（自动通知 + apply-review 决策 + `/qzai review` 复跑）。  
8. 明确不依赖 @mention：主通知为 review-bot 自动 issue_comment，check-run 为 fallback。  
9. 外部贡献者（Owner 无 write）可执行 `/qzai apply-review` 记录承诺，且不触发敏感写操作；敏感动作仍由 write 权限者/App 执行。  
10. 全链路 App 身份要求与 fail-closed 门禁明确。
