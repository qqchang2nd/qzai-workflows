# PLAN: i10-c4019372672 — `/qzai plan-pr` / `/qzai impl-pr` Workflow Design Draft

## 1) 目标 / 非目标

### 目标
1. 定义可审计、可复现、可幂等的命令驱动 PR 流程：
   - Issue 评论触发 `/qzai plan-pr`
   - Plan PR 评论触发 `/qzai impl-pr`
2. 全流程采用 GitHub App 身份执行，保证权限边界与审计归属清晰。
3. 建立 fail-closed 门禁：输入不合法、身份不可信、关键元数据不一致时必须拒绝执行。
4. 输出可 review 的规格与 DoD，为实现 PR 提供唯一设计基线。

### 非目标
1. 本文不包含任何 workflow 代码实现。
2. 不在本次设计中覆盖代码行内评论触发（`pull_request_review_comment`）。
3. 不在本次设计中定义 UI 交互（仅定义命令协议与 GitHub comment 交互）。

---

## 2) 命令格式草案

## 2.1 `/qzai plan-pr`（Issue 对话区）

```text
/qzai plan-pr
agentId: <required>
refs: #<issue-number>         # optional，默认=当前 issue
title: <optional>
reviewers: @user1,@user2      # optional，指定 reviewer 草案
```

字段约束：
- `agentId`：必填，必须命中 `.qzai/apps.json` 白名单映射。
- `refs`：若提供，必须与当前 issue 一致；不一致 fail。
- `reviewers`：语法草案支持 `@login` 逗号分隔；仅作为“请求 reviewer”的输入，不作为授权依据。

## 2.2 `/qzai impl-pr`（Plan PR 对话区）

```text
/qzai impl-pr
agentId: <required>
plan: <required plan-pr-url>
fixes: #<issue-number>        # optional，默认=plan 关联 issue
reviewers: @user1,@user2      # optional
plan-commit: <optional sha>    # 可选覆写（需通过一致性校验）
```

字段约束：
- `agentId`：必填。
- `plan`：必填，必须为同仓库 PR URL，且通过 plan 身份强校验。
- `fixes`：Impl PR 必须存在 `Fixes #<issue>`（可由系统补全）。

---

## 3) Workflow 触发与互斥策略

## 3.1 触发事件
- 统一入口：`issue_comment` + `action=created`
- 分流条件：
  - `issue.pull_request == null` + 命令首行 `/qzai plan-pr` → Plan Flow
  - `issue.pull_request != null` + 命令首行 `/qzai impl-pr` → Impl Flow

## 3.2 互斥与防双触发
1. 仅处理“第一非空行严格匹配”的命令；正文包含命令片段不触发。
2. 忽略 bot 自身评论（按 `sender.login` 与当前执行 App bot login 比对）。
3. 使用并发分组（concurrency group）按 `planKey` / `implKey` 串行化。
4. 幂等优先于重试：命中已存在分支/PR 锚点时返回已存在结果，不重复创建。

---

## 4) 安全门禁（Fail-Closed）

## 4.1 权限门禁
1. 触发者必须满足：
   - `author_association in {OWNER, MEMBER, COLLABORATOR}`，或
   - API 反查 `permission >= write`
2. 权限 API 失败/限流/超时/未知结果：一律拒绝（fail-closed）。

## 4.2 身份与签发门禁
1. `agentId` 必须可在 `.qzai/apps.json` 解析到 `{appSlug, appId, installationId}`。
2. `appSlug` 语义写死：必须等于 GitHub API bot `login`（非 UI 展示名）。
3. 所有 bot 身份比较只用 API `login` 字段，不拼接 `[bot]`。

## 4.3 Plan 可信性门禁（impl 阶段）
- 目标 Plan PR 必须通过强信号校验：
  1) PR 作者 login 与期望 `appSlug` 一致；
  2) 存在 `qzai/plan-attestation` check-run 且 `conclusion=success`；
  3) attestation 输出字段与 Meta/.qzai/apps.json 一致（含 installationId）。
- 任一失败：拒绝执行 impl 创建。

---

## 5) 幂等策略

## 5.1 键定义
- `planKey = <repo>#<issue>:plan`
- `implKey = <repo>#<issue>:impl:<planPrNumber>:<planCommitSha>`

## 5.2 原子锚点
1. 分支锚点（原子）：
   - `qzai/plan/<agentId>/<issue>`
   - `qzai/impl/<agentId>/<issue>/<planPrNumber>/<shortSha>`
2. PR Meta 锚点：
   - `QZAI-Plan-Key`
   - `QZAI-Impl-Key`

## 5.3 判重顺序
1. 查原子分支是否存在。
2. 查 PR Meta 是否已有同键。
3. 命中任一：返回已有 PR 链接并结束（视为成功复用）。

---

## 6) 断言集（实现前置）

在 v7 基础上采用 A1~A11 闭环断言（含 installationId）：
- A1~A10：Meta / PR author / check_run / summary 的 slug/id/agent 一致性。
- A11：`check_run.output.summary.installationId == apps.json.installationId`（MUST）。

失败策略：任一断言失败 → fail-closed + 评论说明失败断言编号。

---

## 7) DoD / 验收标准

1. 设计文档覆盖目标/非目标、命令格式、触发互斥、安全门禁、幂等、DoD 六大块。
2. `agentId` 必填、`appSlug` API login 口径、A11 安装实例闭环在文档中明确写死。
3. Plan/Impl 的 Refs/Fixes 规则明确：
   - Plan PR：Refs
   - Impl PR：Fixes（可含 Refs）
4. 明确仅支持 `issue_comment` 对话区触发，不支持代码行内评论。
5. 所有关键失败场景有 fail-closed 描述，不留“默认放行”灰区。

---

## 8) 回滚与后续

- 若实现阶段发现与现网 GitHub API 字段不一致，先回到本设计修订（v8.x），不在实现中私自改口径。
- 进入实现前，建议由 Master + Q仔 + 李寻欢进行一次规格冻结确认（仅确认文档）。
