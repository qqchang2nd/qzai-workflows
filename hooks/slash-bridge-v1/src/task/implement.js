/**
 * Task template builder for the `implement` command.
 * Returns a structured task description for the implementation agent.
 */

export function buildImplementTask({ owner, repo, issueNumber, planPrNumber, planFilePath, requestedBy }) {
  const planPath = planFilePath || `.qzai/plans/issue-${issueNumber}/PLAN.md`;

  return {
    type: 'implement',
    context: {
      repo: `${owner}/${repo}`,
      issueNumber,
      planPrNumber: planPrNumber || null,
      planFilePath: planPath,
      requestedBy,
    },
    instructions: `
读取 ${planPath} 中的 DoD（Definition of Done）和 Approach 章节。

按照计划实现代码：
1. 创建实现分支 qzai/impl/issue-${issueNumber}
2. 按 Approach 章节的技术方案编写代码
3. 为新功能编写测试（最低 80% 覆盖率）
4. 运行测试确认通过
5. push 到分支并创建 Impl PR，标题格式：feat: Issue #${issueNumber} - <简短描述>
6. PR 描述须包含：
   - 背景：本次变更解决的问题
   - 改动摘要：主要代码变更列表
   - 测试方法：如何验证功能正确
   - Closes #${issueNumber}
7. 给 PR 添加 label: qzai:impl

注意：PR 描述必须包含 Closes #${issueNumber} 以实现 merge 后自动关闭 Issue。
    `.trim(),
    writeback: {
      type: 'update-comment',
      issueNumber,
      checkRun: { name: 'qzai/implement' },
    },
  };
}
