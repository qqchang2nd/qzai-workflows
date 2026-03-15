/**
 * Task template builder for the `review` command.
 * Returns a structured task description for the review agent.
 */

export function buildReviewTask({ owner, repo, prNumber, headSha, baseSha, round = 1, requestedBy }) {
  const isIncremental = round > 1;

  return {
    type: 'code-review',
    context: {
      repo: `${owner}/${repo}`,
      prNumber,
      diffUrl: `https://github.com/${owner}/${repo}/pull/${prNumber}/files`,
      headSha,
      baseSha,
      round,
      isIncremental,
      requestedBy,
    },
    instructions: `
分析 PR #${prNumber} 的代码变更${isIncremental ? `（仅第 ${round} 轮新增部分，baseSha=${baseSha}）` : '（完整 diff）'}。

逐条列出发现的问题，格式：
[严重度: critical|high|medium|low] 文件:行号 - 问题描述 - 建议修复方式

最后给出总结：
- 若无阻塞项（critical/high 级别）：**通过** ✅
- 若有阻塞项：**N 个阻塞项待修复** ❌，列出完整清单

使用 GitHub Review API 提交评审：
- 无阻塞项 → event: APPROVE
- 有阻塞项 → event: REQUEST_CHANGES

注意：第 ${round} 轮评审，${isIncremental ? '只关注 ' + baseSha + '...' + headSha + ' 新增的变更' : '评审完整 PR diff'}。
    `.trim(),
    writeback: {
      type: 'update-comment',
      issueNumber: prNumber,
      checkRun: { name: 'qzai/review', headSha },
    },
  };
}
