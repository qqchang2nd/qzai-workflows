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
