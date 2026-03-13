# PLAN Index — i48-c4051032787

- Plan Key: `i48-c4051032787`
- Source Issue: #48
- Source Comment: https://github.com/qqchang2nd/qzai-workflows/issues/48#issuecomment-4051032787
- Purpose: 保留本次 `/plan-pr` 的审计索引，不承载完整长期规格。

## Stable Spec (v1)
- 主规格文件：`.qzai/specs/slash-bridge-v1.md`
- 说明：后续 impl-pr 与实现评审以该 spec 为唯一长期入口。

## 本次收敛范围（摘要）
1. 定义端到端数据流：issue_comment → hook 安全门禁/去重 → OpenClaw 执行 → GitHub 回写。
2. 写死 fail-closed 安全门禁：签名、allowlist、author policy、速率限制。
3. 明确两层幂等：`deliveryId`（传输级）+ `idempotencyKey`（命令级）。
4. 提供 payload schema v1 与失败模式回写策略（ACK + Final）。

## 审计文件
- `meta.json`：保留
- `snapshot.json`：保留

> 若 spec 与本索引冲突，以 `.qzai/specs/slash-bridge-v1.md` 为准。
