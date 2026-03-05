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

该文档定义了 Issue 与 PR 的职责边界与推荐流转图：默认 **先有 Issue，再有 PR**，并由实现 PR 使用 `Closes #<issue>` 关闭 Issue。

看板（Projects）方面：当前以 Issue label（`status:*`/`priority:*`）作为唯一驱动源；Projects 作为投影，后续由 `/qzai` 自动化补齐同步能力。

## 支持命令

- `/qzai status[:：] <todo|in-progress|blocked|review|done>`
- `/qzai decision[:：] ...`
- `/qzai next[:：] ...`
- `/qzai ship`

行为与 `voice-insight` 的现有版本一致：中文输出、真实换行、`status:*` 标签自动管理且会确保目标标签存在。
