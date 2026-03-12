# TEAM_CHARTER.md（团队协作规范 / SSOT）

> 目的：让“不会忘/想绕也绕不过”的协作规范落到 GitHub，作为团队唯一真相源（SSOT）。
> 适用范围：
> - **强制（P0）**：GitHub 驱动的工程协作（PR/Issue/Actions/workflow），以及任何需要“可审计证据链”的任务。
> - **不强制 GitHub 化**：纯 IM 日常讨论、一次性答疑、非代码类提醒（但依然建议用“证据型交付：摘要+链接”）。

## P0：六条硬规则（Fail-closed）

### P0-1 身份门禁（GitHub 写操作必须用 GitHub App）
**任何 GitHub 写操作**（push / commit / PR / issue_comment / review / label / close / merge）必须先切到对应 Agent 的 GitHub App 身份。

> 这里的 *review* 也包含：提交 Review、Request changes、Approve（不允许用 `qqchang2nd` 人类账号在 PR 上留下 Review）。

```bash
source scripts/gh_app_auth.sh --agent <agentId>
```

- 证据：执行后必须能看到 `Authenticated <agentId> (qzai-xxx)` 的输出（或 `gh auth status` 显示 Active 为 `app/qzai-xxx`）。
- 若无法切换（缺 key/installationId/权限）：**立即停止并报告阻塞点**，不得使用人类账号绕过。

### P0-2 证据型交付（只认证据，不信口头）
每个任务的最终交付必须包含可验证证据（至少三件套）：
- PR/Issue 链接
- commit SHA（或 review id / run url）
- checks/CI 状态（通过/失败/无）

### P0-3 双通道闭环（用户可见 + 上游可唤醒）
由于异步/转发存在不可靠性，采用“显式双重汇报协议”，但**只在满足触发条件时强制**：

- 触发条件（满足任一即强制）：
  1) 任务由上游 Agent/Master **委派**，且上游明确处于“等待你结果才能继续”的串行链路；
  2) 任务预计执行时间 > 30s 或有明显异步步骤（例如 CI、外部 API、需要多轮工具）；

- 强制动作（双通道）：
  1) **对用户可见**：在 PR/Issue conversation 留中文摘要 + next action；
  2) **回传唤醒上游**：用 A2A `sessions_send` 回传结果给委派方（避免黑盒等待）。

- 豁免条件：
  - 若无上游等待（你是链路起点，或任务可独立完成无需唤醒他人），可不做第 2 通道，但仍需完成第 1 通道（用户可见）。

### P0-4 共享文档为中枢（长文本不塞消息）
- 重要结论/长文/产物必须写入 GitHub（PR 描述、Issue、docs、或仓库文件）。
- IM/短消息只允许“摘要 + 链接”。

### P0-5 Fail-closed（缺前置就失败）
以下任一缺失必须 fail-closed（直接报错并给 next action），禁止“凑合跑”：
- 未切 GitHub App 身份（P0-1）
- 无 DoD/无验收口径
- 无证据型交付（P0-2）

### P0-6 PR 边界卫生（一个 PR 只做一件事，禁止串单）
**任何 PR 在创建/更新前必须自检**，确保不会混入其他分支/其他任务的提交：

- 分支必须从 `origin/main` 新建（或至少保证 merge-base = `origin/main`）：
  ```bash
  git fetch origin
  git merge-base --is-ancestor origin/main HEAD
  ```
- 在提交 PR 前必须人工确认变更文件清单：
  ```bash
  git diff --name-only origin/main...HEAD
  ```
- 若发现“带入别的 PR 的提交/文件”（例如不相关的 workflow、meta.json 等）：
  - 必须 `reset --hard origin/main` 后重新 `cherry-pick` 正确提交；或重开干净分支。
  - 禁止“先开 PR 再慢慢清理”，避免浪费 review 成本。

### P0-7 Token/上下文卫生（防止 cacheRead 暴涨）
当任务涉及长上下文或高频工具调用时，必须遵守：
- **重活下沉**：长文/大网页/批量工具/代码实现一律用子 Agent/隔离会话执行，主会话只保留摘要 + 链接。
- **超长会话熔断**：一旦发现当日 usage 里 `cacheRead` 异常偏大（例如 > 输入 token 的 2x，或出现百万级趋势），立刻 `/clear` 或切新会话；禁止继续在同一会话滚雪球。
- **抓取限额**：网页/文档抓取必须设置字符上限（maxChars）与截图深度（depth），避免把 2MB+ 内容反复注入上下文。

> 解释：今天的 80M+ token 暴涨主要来自 cacheRead（上下文重读），不是单个 cron。

---

## 任务模板（建议直接复制）

### 派单模板（委派方写在 Issue/PR comment）
```text
【任务】<一句话>
Agent: <agentId>
DoD:
1) ...
2) 证据：PR/commit/checks
ETA: <时间>
```

### 回执模板（执行方必须回）
```text
【已接单】@<委派方AgentId>
现状：...
计划：...
预计完成：...
风险/阻塞：...
```

### 完成模板（执行方必须回）
```text
【已完成】@<委派方AgentId>
证据：
- PR: <url>
- commit: <sha>
- checks: <url/状态>
变更摘要：...
复现/验证：...
下一步：...
```
