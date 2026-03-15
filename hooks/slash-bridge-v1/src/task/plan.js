/**
 * Task template builder for the `plan` command.
 * Returns a structured task description for the planning agent.
 */

export function buildPlanTask({ owner, repo, issueNumber, issueBody, requestedBy }) {
  return {
    type: 'plan',
    context: {
      repo: `${owner}/${repo}`,
      issueNumber,
      issueBody: issueBody || '',
      requestedBy,
    },
    instructions: `
读取 Issue #${issueNumber} 的描述和评论，生成完整的 PLAN.md 文件，放置于 .qzai/plans/ 目录。

PLAN.md 必须包含以下章节：
## Goals
明确定义本次变更要达成的目标

## Non-Goals
明确排除在外的内容

## Approach
技术实现方案，含关键设计决策

## Risks
已知风险和不确定性

## Rollback
回滚策略

## DoD (Definition of Done)
可验证的完成标准清单

完成后：
1. 将 PLAN.md push 到新分支 qzai/plan/issue-${issueNumber}
2. 创建 Plan PR，标题格式：plan: Issue #${issueNumber} - <简短描述>
3. 给 PR 添加 label: qzai:plan
4. 在原 Issue #${issueNumber} 评论中回复 Plan PR 链接
    `.trim(),
    writeback: {
      type: 'update-comment',
      issueNumber,
      checkRun: { name: 'qzai/plan' },
    },
  };
}
