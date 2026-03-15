/**
 * Task template builder for the `security` command.
 * Returns a structured task description for the security review agent.
 */

export function buildSecurityTask({ owner, repo, prNumber, headSha, baseSha, requestedBy }) {
  return {
    type: 'security-review',
    context: {
      repo: `${owner}/${repo}`,
      prNumber,
      diffUrl: `https://github.com/${owner}/${repo}/pull/${prNumber}/files`,
      headSha,
      baseSha,
      requestedBy,
    },
    instructions: `
专项安全扫描 PR #${prNumber} 的代码变更。

重点检查以下安全维度：
1. **注入漏洞**：SQL 注入、命令注入、LDAP 注入
2. **越权访问**：水平越权、垂直越权、IDOR
3. **Secrets 泄漏**：硬编码密钥、API token、密码、私钥
4. **加密安全**：不安全算法（MD5/SHA1 用于密码）、不安全随机数
5. **OWASP Top 10**：XSS、CSRF、SSRF、不安全反序列化、XXE
6. **依赖安全**：已知 CVE 的依赖版本
7. **认证授权**：绕过认证、权限提升路径

输出格式（每个问题一条）：
[严重度: critical|high|medium|low] 漏洞类型 - 位置（文件:行号）- 描述 - 修复建议

最后总结：
- 安全通过 ✅ 或 N 个安全问题需修复 ❌

安全扫描独立于代码 review，结果发布为独立评论。
    `.trim(),
    writeback: {
      type: 'update-comment',
      issueNumber: prNumber,
      checkRun: { name: 'qzai/security', headSha },
    },
  };
}
