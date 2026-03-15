/**
 * Task template builder for the `followup` command.
 * Supports two modes:
 * - 'notify': after review finds blocking issues, notify PR author to fix
 * - 'escalation': after max_rounds reached, request human intervention
 */

export function buildFollowupTask({
  owner,
  repo,
  prNumber,
  prAuthor,
  originalReviewer,
  mode,
  round,
  blockingIssues = [],
  allUnresolvedIssues = [],
  maxRounds,
  requestedBy,
}) {
  if (mode === 'escalation') {
    return buildEscalationTask({
      owner, repo, prNumber, prAuthor, originalReviewer,
      allUnresolvedIssues, maxRounds, requestedBy,
    });
  }
  return buildNotifyTask({
    owner, repo, prNumber, prAuthor, round, blockingIssues, requestedBy,
  });
}

function buildNotifyTask({ owner, repo, prNumber, prAuthor, round, blockingIssues, requestedBy }) {
  const issuesList = blockingIssues.length > 0
    ? blockingIssues.map((issue, i) => `${i + 1}. ${issue}`).join('\n')
    : '（详见 review 评论）';

  return {
    type: 'followup-notify',
    context: {
      repo: `${owner}/${repo}`,
      prNumber,
      prAuthor,
      round,
      blockingIssues,
      requestedBy,
    },
    instructions: `
在 PR #${prNumber} 中发布 followup 通知评论，@${prAuthor}。

内容须包含：
1. 第 ${round} 轮 review 已完成，发现 ${blockingIssues.length} 个阻塞问题
2. 阻塞问题清单：
${issuesList}
3. 请求操作：请修复上述问题并 push 新提交，系统将自动触发第 ${round + 1} 轮 review

评论语气：专业、简洁、明确行动项。
    `.trim(),
    writeback: {
      type: 'update-comment',
      issueNumber: prNumber,
    },
  };
}

function buildEscalationTask({
  owner, repo, prNumber, prAuthor, originalReviewer,
  allUnresolvedIssues, maxRounds, requestedBy,
}) {
  const issuesList = allUnresolvedIssues.length > 0
    ? allUnresolvedIssues.map((issue, i) => `${i + 1}. ${issue}`).join('\n')
    : '（详见历轮 review 评论）';

  const reviewerMention = originalReviewer ? `@${originalReviewer}` : '';

  return {
    type: 'followup-escalation',
    context: {
      repo: `${owner}/${repo}`,
      prNumber,
      prAuthor,
      originalReviewer,
      allUnresolvedIssues,
      maxRounds,
      requestedBy,
    },
    instructions: `
在 PR #${prNumber} 中发布 escalation 评论，@${prAuthor}${reviewerMention ? ' 和 ' + reviewerMention : ''}。

内容须包含：
1. 已经完成 ${maxRounds} 轮 review，仍存在以下未解决问题
2. 未解决问题汇总：
${issuesList}
3. 需要人工介入：请 @${prAuthor}${reviewerMention ? ' 和 ' + reviewerMention : ''} 确认下一步行动
   - 选项 A：修复所有问题后重新提交
   - 选项 B：接受现状并说明原因（需团队讨论）
   - 选项 C：关闭 PR 并重新规划

check-run 状态：failure（MAX_ROUNDS_REACHED）

评论语气：严肃但中立，强调需要人工决策。
    `.trim(),
    writeback: {
      type: 'update-comment',
      issueNumber: prNumber,
      checkRun: { name: 'qzai/review', conclusion: 'failure', title: 'MAX_ROUNDS_REACHED' },
    },
  };
}
