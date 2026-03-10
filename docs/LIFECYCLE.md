# Issue / PR 生命周期（QZAI 标准流程）

本文件用于固化一个简单、可追溯、可审计的协作方式：

- **Issue 负责**：为什么做、做到什么程度（目标/范围/DoD/风险/验收）。
- **PR 负责**：怎么改、改了什么（代码变更/测试证据/风险与回滚）。

一句话：**Issue 管“事”，PR 管“改动”。**

---

## 推荐主流程 A（强烈推荐）

**Issue → Plan PR → Impl PR → Merge → Close Issue**

1) **Issue（提出需求/缺陷）**
- 必填：目标、范围、DoD（Definition of Done）、验收方式、风险
- 状态：`status:todo`

2) **Plan PR（只写计划，不写代码）**
- 目的：把“怎么做”写清楚，让 Master/审查者拍板
- PR 描述必须包含：`Refs #<issue>`（不要用 Closes）
- 状态：Issue 进入 `status:review`

3) **Impl PR（实现 PR）**
- 目的：交付代码变更
- PR 描述必须包含：`Closes #<issue>`（或 `Closes #<sub-issue>`）
- 合并后自动关闭对应 Issue

4) **验收与收口**
- Master 验收通过后，Issue 应处于关闭状态（或状态为 `status:done` 并关闭）

---

## 允许流程 B（例外/补追溯）

**PR →（补）Issue → PR 关联 Issue → Merge → Close Issue**

适用场景：
- 临时修 bug / 小改动
- 先看到代码问题，先起草修复 PR

规则：
- PR 开出后必须尽快补一个 Issue（或关联到现有 Issue）
- PR 描述必须补上 `Refs #<issue>` 或 `Closes #<issue>`
- **没有 Issue 的 PR 不允许长期存在**（否则不可追溯）

---

## Plan PR 触发策略（按 Issue 类型，P0 规则）

> 目标：减少“到底要不要开 Plan PR”的人为争论，让流程可执行。

### 1) Feat 类 Issue：一律开 Plan PR

适用标签/类型（建议用 label 作为唯一裁决信号）：
- `type:feat` / `enhancement` / `refactor` / `breaking-change`（或同等语义标签）

规则：
- **必须开 Plan PR**：用 `/qzai plan-pr` 创建 Plan PR，把设计/方案落实到文档（Plan PR 即文档载体）。
- Plan PR 的核心交付物：目标/范围/非目标/方案/风险/回滚/验收口径（DoD）。
- `impl-pr` 为 fail-closed：Plan PR 分支必须包含 `.qzai/plans/<planKey>/PLAN.md`，且其中必须存在 `## DoD` 区块。

原因：Feat 的不确定性更高，Plan PR 能把关键决策沉淀为可引用的审计证据，避免边做边改、口头决策丢失。

### 2) Bug 类 Issue：默认不开 Plan PR

#### 紧急例外：生产事故/安全热修（P0）

- 允许先走快速修复路径（流程 B：先修复/先开 PR），以速度优先。
- 但必须在事后补齐追溯：在 Issue 中补充 Decision/根因/回滚方案（必要时补 Plan PR 或补充文档）。


适用标签/类型：
- `type:bug` / `bug`

规则：
- **默认不开 Plan PR**。
- 直接在 Issue 内完成“修复计划 + 验证方式”的评论闭环即可（复现 → 根因 → 修复 → 回归）。

Bug 的价值在速度与闭环，Plan PR 往往只增加延迟。

#### Bug 例外：高风险/复杂 bug 仍建议开 Plan PR

满足其一就建议转为 Plan PR 流：
- 影响面大（跨模块/跨 repo）
- 需要灰度/回滚方案
- 需要多方协作/明确责任边界
- 可能引入行为改变（看起来像 bug，实际上是设计讨论）

操作建议：
- 先把 Issue label 从 `type:bug` 调整为 `type:feat/enhancement`（或补充 `needs-design`），再走 Plan PR。

---

## 看板（Projects）联动（最小约定）

原则：**Issue 是真相源（SSOT），看板只是投影**。

- `status:*`、`priority:*` **一律用 Issue label 表达**（例如 `status:todo`、`status:review`、`priority:P0`）。
- Projects 作为可视化：
  - Project 字段 `Status` 建议与 `status:*` 同步（Todo/In Progress/Blocked/Review/Done）。
  - Project 字段 `Priority` 建议与 `priority:*` 同步。

当前阶段：我们先以 label 作为唯一驱动源；Project 同步能力后续由 `/qzai` 自动化补齐。

---

## 强制规则（不满足即不合并）

1) **每个 PR 必须关联至少一个 Issue**
- 计划类 PR：用 `Refs #123`
- 实现类 PR：用 `Closes #123`

2) **Issue 的 DoD 由 Issue 管，PR 必须提供“达成证据”**
- 测试、截图、日志、手工验证步骤均可

3) **职责分工必须清晰（各司其职）**
- 实现者用自己的 Agent 身份（GitHub App）提交/评论实现细节
- 审查者用自己的 Agent 身份给结论
- `qzai-bot` 只做自动化回执与调度，不替别人写专业结论

---

## PR 描述示例

### 计划 PR（Plan-only）

- Refs #123

说明：该 PR 仅包含计划/拆解，不包含代码变更。

### 实现 PR（Impl）

- Closes #123

说明：合并后会自动关闭 #123。

---

## Plan PR 边界（什么算“只写计划”）

允许：
- 新增/修改文档（计划、SOP、说明）
- 新增 Issue 拆解清单（以文档或 issue 列表形式）

不允许（除非 Master 明确要求）：
- 引入实际业务代码变更
- 大规模重构

---

## 最小实例

- Issue #123：明确目标与 DoD
- Plan PR #124：`Refs #123`，只提交计划文档
- Impl PR #125：`Closes #123`，提交实现与测试证据
