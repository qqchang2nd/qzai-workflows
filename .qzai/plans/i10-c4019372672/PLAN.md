# PLAN v2: PR Slash Review Workflow（Issue #10 / PR #29）

> 本版替换前稿，聚焦 **PR 上的 slash review 工作流**。  
> 范围：只定义设计与验收，不包含实现代码。

## 1) 目标 / 非目标

### 目标
1. 在 PR 对话区通过 slash 命令，指定某个 bot 执行 code review。  
2. 规范 review bot 的输出载体与格式，保证可审计、可追踪、可机读。  
3. 允许 Owner 依据 review 结果发起“按评论修改/拒绝修改”的后续动作，并有清晰状态机。  
4. 与现有命令流（`/qzai plan-pr`、`/qzai impl-pr`、issue commands wrapper）互斥，避免黑洞/双触发。  
5. 全链路强制 GitHub App 身份，杜绝人类账号误写。

### 非目标
1. 不设计 plan-pr / impl-pr 主链路（已实现）。  
2. 不在本版定义具体审查策略规则库（如安全规则集合细节）。  
3. 不覆盖行内 review comment 触发（仅 PR conversation）。

---

## 2) Slash 命令协议（PR 指定 bot review）

## 2.1 入口命令（PR conversation）

```text
/qzai review
bot: <required>
scope: <optional: files|diff|full>
focus: <optional free-text>
```

语义：
- `bot`：指定执行 review 的 bot（如 `luxiaofeng` / `lixunhuan`）。
- `scope`：默认 `diff`。
- `focus`：可选审查重点（性能/安全/风格等）。

## 2.2 Owner 决策命令

```text
/qzai apply-review
review-id: <required>
mode: <required: apply|reject|partial>
note: <optional>
```

语义：
- `apply`：接受 review 并进入修改执行阶段。
- `reject`：明确拒绝本轮建议并结束该轮。
- `partial`：部分采纳，要求在 `note` 里说明范围。

## 2.3 参数与权限

- 仅允许 PR 仓库的 `OWNER/MEMBER/COLLABORATOR` 或 `permission>=write` 触发。  
- `bot` 必须命中 allowlist（来自 `.qzai/apps.json` 的 agentId 映射）。  
- 未命中 allowlist / 权限不足 / 参数缺失：fail-closed 并回帖。

---

## 3) Review bot 输出载体与格式约束

## 3.1 载体选择（规范）

采用 **双载体**（主 + 审计）：
1. **PR Review（主载体）**：用于人类可读的审查意见（Approve/Comment/Request changes）。
2. **Check-run `qzai/review-attestation`（审计载体）**：用于机读断言、状态与身份闭环。

补充：允许追加一条 PR comment 作为“流程状态通知”（可选，不作为唯一事实源）。

## 3.2 最小输出格式（机读）

`qzai/review-attestation` 的 `output.summary` 必须包含：
- `reviewId`
- `agentId`
- `appSlug`
- `appId`
- `installationId`
- `prNumber`
- `headSha`
- `decision`（comment|request_changes|approve）
- `status`（completed|failed|timeout）

所有字段缺失或不一致 => fail-closed。

---

## 4) Owner “修改/拒绝修改”动作设计（状态机+幂等+超时）

## 4.1 状态机

- `REVIEW_REQUESTED`：收到 `/qzai review` 并校验通过。
- `REVIEW_POSTED`：bot 已完成 review 并写入 attestation。
- `OWNER_DECISION_PENDING`：等待 Owner `/qzai apply-review`。
- `ACTION_APPLYING`：进入按 review 修改流程。
- `ACTION_REJECTED`：Owner 拒绝本轮建议。
- `DONE`：流程结束（apply 完成或 reject 完成）。
- `TIMEOUT`：超时未决策。

## 4.2 幂等键

- `reviewKey = <repo>#<pr>#<headSha>#<agentId>`
- `decisionKey = <reviewId>#<mode>`

规则：同一 `reviewKey` 重复触发只复用，不重复发起评审；同一 `decisionKey` 只执行一次。

## 4.3 超时

- `OWNER_DECISION_PENDING` 超过默认 24h 进入 `TIMEOUT`，并自动回帖提醒。
- 超时后允许 Owner 重新发 `apply-review`（生成新 `decisionKey`，仍绑定原 `reviewId`）。

---

## 5) 触发互斥与 guard 设计

当前已存在：
- `.github/workflows/qzai-issue-commands-wrapper.yml`
- `.github/workflows/qzai-issue-commands.yml`
- `.github/workflows/qzai-two-stage-pr-wrapper.yml`
- `.github/workflows/qzai-two-stage-pr.yml`

## 5.1 互斥原则
1. **review workflow 仅处理 PR comment 的 review 命令**：`/qzai review`、`/qzai apply-review`。
2. two-stage PR 工作流只处理：`/qzai plan-pr`、`/qzai impl-pr`。
3. issue wrapper 仅处理 Issue 场景，不接 PR review 命令。

## 5.2 Guard（必须）
- 首行严格匹配命令（第一非空行）。
- 事件源必须是 `issue_comment + action=created`。
- `issue.pull_request != null` 才能进入 review 流程。
- 命令路由必须单命中；若多路命中 => fail-closed 并回帖“路由冲突”。

---

## 6) 身份合规与审计

## 6.1 全链路 GitHub App 身份（MUST）
- 触发、回帖、review、check-run 均必须由对应 App bot 执行。
- 禁止人类账号直接写流程性评论作为系统输出。

## 6.2 防误写控制
- 评论发布统一走 bot comment helper（由 Master 已指定脚本）。
- 审计字段中记录 `issuer appSlug/appId/installationId`。
- 若检测到流程输出作者非 bot，直接标记该轮无效并回帖。

## 6.3 验收检查项（身份）
1. PR/Issue 流程评论作者必须是 `qzai-<agent>[bot]` 对应 API login。  
2. review attestation 的 `appSlug/appId/installationId` 与 allowlist 一致。  
3. 不允许出现“Agent 文案 + 人类账号作者”的错位输出。

---

## 7) 最小可行 DoD（可上线范围）

MVP 上线只要求以下命令与流程：

1. 支持 `/qzai review`（含 `bot` 必填）在 PR conversation 触发。  
2. review bot 能产出：
   - 一条 PR Review（人类可读）
   - 一条 `qzai/review-attestation` check-run（机读）
3. 支持 Owner `/qzai apply-review` 的 `mode=apply|reject`（`partial` 可后置）。  
4. 路由 guard 生效：不会与 plan-pr/impl-pr/issue-wrapper 双触发。  
5. 幂等生效：重复命令不重复创建同轮 review/action。  
6. 身份合规生效：全链路 bot 身份，可被审计字段验证。  
7. fail-closed 生效：权限不足、参数错误、allowlist 不匹配、断言失败均拒绝并给出原因。

---

## 8) 实施建议顺序（仅供实现阶段参考）

1. 先做命令路由与 guard（确保不双触发）。  
2. 再做 `/qzai review` + attestation 输出。  
3. 最后做 `/qzai apply-review` 状态机与超时处理。  
4. 收尾做身份合规验收与审计校验。
