# PLAN v3: PR Slash Review Workflow（Issue #10 / PR #29）

> 本版基于 Master 行内反馈重写，聚焦“PR 上通过 slash 指定 bot review + Owner 决策动作”。

## 0) 反馈对齐清单

- Feedback-1（命令参数统一 `agentId`）  
  https://github.com/qqchang2nd/qzai-workflows/pull/29#discussion_r2902089588
- Feedback-2（解释 `review-id` 与 `mode`）  
  https://github.com/qqchang2nd/qzai-workflows/pull/29#discussion_r2902091025

- Feedback-3（reviewer→owner 反馈闭环）  
  https://github.com/qqchang2nd/qzai-workflows/pull/29#issuecomment-4020298707

本版结论：三条均 **采纳**。

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

### `review-id` 定义（采纳反馈-2）
- 含义：一次已完成 review 轮次的唯一标识。  
- 生成时机：`/qzai review` 进入 `reviewed` 状态后由系统生成。  
- 建议格式：`rvw_<prNumber>_<shortHeadSha>_<agentId>_<seq>`。  
- 用途：让 Owner 明确“针对哪一轮 review”做决策，避免串单。

### `mode` 定义（采纳反馈-2）
- `apply`：Owner 接受本轮 review，进入修改执行阶段。  
- `reject`：Owner 明确拒绝本轮建议，流程收敛为 rejected。  
- `partial`：Owner 部分采纳，需在 `note` 写范围。

### 谁可发出 `/qzai apply-review`
- 仅 Owner/MEMBER/COLLABORATOR 或 `permission>=write` 用户。
- review-bot 不应自发发送该命令（避免自触发闭环）。

## 2.3 reviewer -> owner 反馈闭环（新增）

reviewer 给出评论后，owner 的回应路径固定为三步：

1. **选择动作**：Owner 发送 `/qzai apply-review`（`mode=apply|partial|reject`）。
2. **执行回应**（仅 `apply/partial`）：
   - 提交修复 commit（对应 reviewer 建议）；
   - 在对应 review 线程回复（`resolved by <commit_sha>` 或明确不采纳理由）；
3. **确认完成**：Owner 发送重审命令：

```text
/qzai re-review
agentId: <required>
review-id: <required>
head-sha: <optional, default current PR head>
```

说明：
- `/qzai re-review` 只能在 `apply_requested` 或 `partial_applied` 后触发；
- 触发后进入新一轮 `reviewing`，并把 `parentReviewId=<review-id>` 写入 attestation；
- 若 owner 只回复线程但没有新 commit，允许重审，但 check-run 标记 `NO_CODE_CHANGE_RECHECK=true`。

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
`requested -> reviewing -> reviewed -> apply_requested -> applied`  
闭环扩展：
- `applied -> re_review_requested -> reviewing -> reviewed`（owner 主动重审）

等价终态：
- `rejected`（mode=reject）
- `partial_applied`（mode=partial，随后可 `re_review_requested`）
- `timeout`（reviewed 或 apply_requested 后超时未决）

## 5.2 幂等键
- `reviewKey = <repo>#<pr>#<headSha>#<agentId>`
- `decisionKey = <reviewId>#<mode>`

规则：
- 同 `reviewKey` 重复 `/qzai review`：复用已存在 review 轮次，不重复发起。
- 同 `decisionKey` 重复 `/qzai apply-review`：仅首个生效，后续回帖“已处理”。
- 重审幂等：`reReviewKey = <reviewId>#<headSha>#<agentId>`，同 key 重复 `/qzai re-review` 不重复触发。

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
期望：进入 `apply_requested->applied`。

## 示例 C：失败（无权限或 agentId 非法）
```text
/qzai review
agentId: unknown-bot
```
期望：fail-closed；回帖 `INVALID_AGENT_ID` 或 `PERMISSION_DENIED`。

---


## 示例 D：Owner 线程回复后发起重审
```text
/qzai re-review
agentId: luxiaofeng
review-id: rvw_29_d955d43_luxiaofeng_1
```
期望：进入 `re_review_requested->reviewing->reviewed`，并在 attestation 记录 `parentReviewId`。

## 8) 最小可行 DoD（MVP）

1. 触发不依赖 @mention，仅来自 `issue_comment` slash。  
2. 命令参数统一使用 `agentId`（无 reviewerId/agent/id 混用）。  
3. 明确 `review-id` 与 `mode` 的定义、阶段、发起者。  
4. 提供 2~3 个端到端命令例子（含失败返回）。  
5. 状态机与幂等键可落地、可审计。  
6. 与现有 plan/impl/issue wrappers 的路由互斥规则明确。  
7. reviewer 评论后的 owner 反馈闭环明确（commit修复 + 线程回复 + re-review）。  
8. 全链路 App 身份要求与 fail-closed 门禁明确。
