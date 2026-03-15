# PLAN

## Context
- 背景：Issue #46 需要新增 `/qzai followup` 命令，解决“派单后缺少显式唤醒、缺少强制回执、缺少证据闭环”的协作痛点。
- 目标：在 `issue_comment` 事件下，解析并执行 `/qzai followup`，生成中文结构化回执，且满足 GitHub App 身份门禁、真实换行、证据区块必填三项 fail-closed 约束。

## Scope
- In Scope:
  1. 在工作流层新增/接入 `/qzai followup` 命令分发入口（仅匹配评论第一行精确命令）。
  2. 实现 `key: value` 参数解析（`target/goal/owners/eta/checks`），并定义缺省值与错误处理。
  3. 生成统一中文回执模板：目标/目的、当前状态、下一步、证据要求、ETA。
  4. 增加 fail-closed 校验：
     - 非 GitHub App 身份拒绝写评论；
     - 评论内容禁止字面量 `\n`；
     - 回执缺失“证据要求”区块则拒绝发布。
  5. 最小化验证链路：命令触发验证 + 两段式流程联动场景验证（plan-pr/impl-pr/followup）。
- Out of Scope:
  1. 不实现跨仓库任务编排系统。
  2. 不在本期引入复杂状态机或外部数据库。
  3. `findings/followups.json` 持久化先不做强制交付（仅作为后续扩展）。

## Approach
- 方案：
  1. **触发与路由**
     - 在评论驱动 workflow 中增加 `followup` 分支。
     - 只读取评论第一行并做精确匹配 `/qzai followup`，避免误触发。
  2. **参数解析与规范化**
     - 解析评论全文中 `key: value` 行，支持字段：`target/goal/owners/eta/checks`。
     - `owners/checks` 支持分隔符（`,` 或 `/`），统一规范成列表。
     - 缺省规则：`target=当前线程`、`goal=催办与闭环`、`eta=未提供`、`status=unknown`。
  3. **回执生成与发布**
     - 构建固定中文模板，包含：目标/目的、当前状态、下一步、证据要求、ETA。
     - 发布前通过 `gh_safe_comment.sh` 或等价门禁脚本执行内容校验（真实换行 + 身份校验）。
  4. **Fail-closed 守卫**
     - 身份不是 `qzai-xxx[bot]` 直接失败并给出原因。
     - 内容存在字面量 `\n` 直接失败。
     - 缺少“证据要求”区块直接失败。
  5. **验证与联调**
     - 用测试评论触发 `/qzai followup`，确认回执结构与格式。
     - 在 Plan PR 线程配合 `/qzai impl-pr` 做一次联调，验证 followup 可给出证据化闭环信息（check-run/PR 链接）。
- 风险与回滚：
  - 风险1：命令匹配过宽导致误触发。
    - 缓解：仅首行精确匹配；非匹配直接退出。
  - 风险2：评论格式不稳定导致解析失败。
    - 缓解：设置安全缺省值，并在回执中明确“未提供”字段。
  - 风险3：评论发布出现 `\n` 字面量或身份漂移。
    - 缓解：统一走门禁脚本；失败即中断，不降级写入。
  - 回滚：若上线后发现异常，回滚新增命令分支与解析逻辑，保留现有命令路径不受影响。

## DoD
- [ ] workflow 能识别并处理 `/qzai followup`（仅首行精确匹配）
- [ ] `target/goal/owners/eta/checks` 解析可用，缺省值行为明确
- [ ] 回执评论为中文结构化模板，包含“证据要求”区块
- [ ] 写操作强制 GitHub App 身份，且输出无字面量 `\n`
- [ ] 至少完成 1 次真实触发验证并附证据（评论链接）
- [ ] 完成 1 次与 `/qzai plan-pr` + `/qzai impl-pr` 的联动验证并附证据（PR/check-run/评论链接）

## Validation
- 测试：
  1. 正常路径：发送 `/qzai followup` + 完整字段，验证成功回执。
  2. 缺省路径：仅发送命令，验证缺省值填充与结构完整性。
  3. 失败路径：构造缺“证据要求”区块的输出，验证 fail-closed 阻断。
  4. 失败路径：模拟非 bot 身份，验证拒绝写操作。
  5. 格式路径：检查评论内容不含字面量 `\n`。
- 验收方式：
  - 提供 PR 中实现文件与关键逻辑说明；
  - 提供触发评论 URL + 回执评论 URL；
  - 提供联动验证证据（关联 PR/check-run/评论 URL）；
  - 满足 DoD 全部勾选后可进入 merge 审查。