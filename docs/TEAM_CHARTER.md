# TEAM_CHARTER.md（团队协作规范 / SSOT）

> 目的：让“不会忘/想绕也绕不过”的协作规范落到 GitHub，作为团队唯一真相源（SSOT）。
> 适用范围：qzai-workflows 相关的所有自动化协作（/qzai 系列指令、PR/Issue 驱动的多 Agent 协作）。

## P0：六条硬规则（Fail-closed）

### P0-1 身份门禁（GitHub 写操作必须用 GitHub App）
**任何 GitHub 写操作**（push / commit / PR / issue_comment / review / label / close / merge）必须先切到对应 Agent 的 GitHub App 身份：

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
由于异步/转发存在不可靠性，必须采用“显式双重汇报协议”：
1) **对用户可见**：在 PR/Issue conversation 留中文摘要 + next action；
2) **回传唤醒上游**：用 A2A 回传结果给委派方（避免黑盒等待）。

> 目标：你能在 GitHub 上看到全过程；上游 Agent 能被明确唤醒继续推进。

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
