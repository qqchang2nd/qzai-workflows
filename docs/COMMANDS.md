# QZAI Command Reference

## Pure Actions（Actions 直接执行，无 AI）

### `/qzai status: <状态>`
更新 Issue label。

**有效状态**：`todo` | `in-progress` | `blocked` | `review` | `done`

```
/qzai status: in-progress
```

> 注：`plan` 命令触发时会自动将 Issue status 改为 in-progress。

---

### `/qzai decide: <文本>`（原 `decision`，向后兼容）
追加一条 Decision Log 到 Issue body。

```
/qzai decide: 选择 SQLite 而非 Redis，原因是部署简单且数据量小
```

> 旧命名 `/qzai decision:` 仍支持，将在未来版本移除。

---

### `/qzai subtask: <标题>`（原 `next`，向后兼容）
创建子 Issue（含 SHA256 去重，同一评论多次触发安全）。

```
/qzai subtask: 实现 token 缓存层
/qzai subtask: 补充单元测试
```

> 旧命名 `/qzai next:` 仍支持，将在未来版本移除。

---

## Slash-bridge → Agent（有 AI 推理）

所有命令均有默认 Agent，`agentId:` 参数**可选**，仅在需要覆盖默认时填写。

### `/qzai plan`（原 `plan-pr`，向后兼容）
读取 Issue → 生成完整 PLAN.md → 创建 Plan PR。

**默认 Agent**：lixunhuan

```
/qzai plan
```

```
/qzai plan
agentId: lixunhuan
```

**触发效果**：
- 自动将 Issue status 改为 in-progress
- 创建包含 PLAN.md 的 Plan PR（label: `qzai:plan`）
- 写入 `plan-attestation` check-run

---

### `/qzai implement`（原 `impl-pr`，向后兼容）
读取 PLAN.md → 写代码 → 创建 Impl PR。

**默认 Agent**：lengyan

```
/qzai implement
```

```
/qzai implement
agentId: lengyan
```

> `plan:` 参数可选，系统自动从 Issue 上下文查找关联 Plan PR。

**前置条件**：Plan PR 必须存在且包含 `## DoD` 章节（fail-closed）。

---

### `/qzai review`
代码评审（多轮，默认最多 3 轮，可通过 `QZAI_MAX_REVIEW_ROUNDS` 配置）。

**默认 Agent**：lixunhuan

```
/qzai review
```

```
/qzai review
agentId: jingwuming
```

**Review Loop 状态**：
- 无阻塞项 → `approved` + PR Review: APPROVE
- 有阻塞项 → `pending_fix` + 自动触发 followup 通知
- 超出 max rounds → `max_reached` + 自动触发 followup escalation

---

### `/qzai security`
专项安全扫描（独立于 review，可并行执行）。

**默认 Agent**：jingwuming

```
/qzai security
```

---

### `/qzai followup`
驱动修复行动（通常由系统自动触发，也可手动调用）。

**默认 Agent**：lengyan

```
/qzai followup
```

**两种自动触发模式**：
- **通知模式**：每轮 review 发现阻塞项后自动触发，@prAuthor
- **Escalation 模式**：达到 max rounds 后自动触发，@prAuthor + @reviewer，请求人工介入

---

### `/qzai pr-desc`（新增）
基于 PR diff 生成或更新 PR 描述（纯手动）。

**默认 Agent**：lengyan

```
/qzai pr-desc
```

> 适用于人工建 PR 但没有写描述，或描述已过时需要刷新的场景。

---

## agentId 覆盖

所有命令支持 `agentId:` 参数覆盖默认 Agent：

```
/qzai review
agentId: jingwuming
```

**允许的 agentId**：`main` | `luxiaofeng` | `afei` | `jingwuming` | `lengyan` | `lixunhuan` | `aji`

---

## 废弃命令

| 旧命令 | 新命令 | 状态 |
|--------|--------|------|
| `/qzai plan-pr` | `/qzai plan` | 向后兼容，仍可用 |
| `/qzai impl-pr` | `/qzai implement` | 向后兼容，仍可用 |
| `/qzai decision:` | `/qzai decide:` | 向后兼容，仍可用 |
| `/qzai next:` | `/qzai subtask:` | 向后兼容，仍可用 |
| `/qzai ship` | 已删除，用 PR template 替代 | 不再支持 |
