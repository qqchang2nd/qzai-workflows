# QZAI Issue Commands Reusable Workflow

本仓库提供可复用工作流：`.github/workflows/qzai-issue-commands.yml`。

## 调用方最小接入方式

在你的目标仓库里只需要新增一个 wrapper workflow，例如：

```yaml
name: QZAI Issue Commands Wrapper

on:
  issue_comment:
    types: [created]

permissions:
  contents: read
  issues: write

jobs:
  qzai-issue-commands:
    uses: qqchang2nd/qzai-workflows/.github/workflows/qzai-issue-commands.yml@main
    secrets: inherit
```

如果不使用 `secrets: inherit`，也可以显式传入：

```yaml
jobs:
  qzai-issue-commands:
    uses: qqchang2nd/qzai-workflows/.github/workflows/qzai-issue-commands.yml@main
    secrets:
      QZAI_APP_ID: ${{ secrets.QZAI_APP_ID }}
      QZAI_APP_PRIVATE_KEY: ${{ secrets.QZAI_APP_PRIVATE_KEY }}
```

## 调用方前置条件

- 目标仓库 Secrets 里有：
  - `QZAI_APP_ID`
  - `QZAI_APP_PRIVATE_KEY`
- GitHub App 已安装到目标仓库。

## 推荐流程（强烈建议阅读）

- docs/LIFECYCLE.md

该文档定义了 Issue 与 PR 的职责边界与推荐流转图。

---

## 支持命令

本仓库当前有两套 `/qzai` 命令入口：

### A) Issue Commands（旧入口：可复用工作流 `qzai-issue-commands.yml`）

- `/qzai status[:：] <todo|in-progress|blocked|review|done>`
- `/qzai decision[:：] ...`
- `/qzai next[:：] ...`
- `/qzai ship`

行为与 `voice-insight` 的现有版本一致：中文输出、真实换行、`status:*` 标签自动管理且会确保目标标签存在。

### B) Two-Stage PR Flow（v8 新入口：Plan/Impl 两段式）

由 `qzai-two-stage-pr-wrapper.yml` → `qzai-two-stage-pr.yml` 处理。

#### 命令解析规则（重要）

- 仅解析评论**第一行**作为命令行；会先做空白归一化（trim + 连续空白折叠为单空格）。
- 第一行必须精确匹配：`/qzai plan-pr` 或 `/qzai impl-pr`，否则工作流会直接跳过。


- `/qzai plan-pr`
  - 触发：Issue 评论
  - 必填字段：`agentId: <agentId>`
  - 作用：创建 Plan PR（沉淀计划文档快照 + attestation check-run）

- `/qzai impl-pr`
  - 触发：PR conversation（即 PR 线程的评论，issue_comment on PR）。
  - 推荐：在对应的 Plan PR 线程触发；实现上允许在**任意** PR 线程触发，只要 `plan:` 指向同仓库的 Plan PR 链接。
  - 必填字段：
    - `agentId: <agentId>`
    - `plan: <Plan PR URL>`
  - 作用：校验 plan attestation（fail-closed）后创建 Impl PR
  - 额外约束（fail-closed）：Plan PR 分支必须存在 `.qzai/plans/<planKey>/PLAN.md`，且文件内必须包含 `## DoD` 区块。

注意：为了避免与旧入口重复触发，本仓库的 wrapper 已对 `plan-pr/impl-pr` 做了互斥 guard。
