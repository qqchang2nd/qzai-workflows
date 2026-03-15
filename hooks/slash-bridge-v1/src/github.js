import { setTimeout as sleep } from 'node:timers/promises';

const API = 'https://api.github.com';

async function ghFetch(token, path, { method = 'GET', body, headers = {} } = {}) {
  const url = path.startsWith('http') ? path : `${API}${path}`;
  const resp = await fetch(url, {
    method,
    headers: {
      Authorization: `token ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      ...headers,
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  const text = await resp.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { raw: text };
  }

  if (!resp.ok) {
    const err = new Error(`GitHub API ${method} ${path} failed: HTTP ${resp.status}`);
    err.status = resp.status;
    err.data = data;
    err.retryAfter = resp.headers.get('retry-after') ? Number(resp.headers.get('retry-after')) : null;
    throw err;
  }
  return data;
}

export async function createIssueComment({ token, owner, repo, issueNumber, body }) {
  return ghFetch(token, `/repos/${owner}/${repo}/issues/${issueNumber}/comments`, {
    method: 'POST',
    body: { body },
  });
}

export async function updateIssueComment({ token, owner, repo, commentId, body }) {
  return ghFetch(token, `/repos/${owner}/${repo}/issues/comments/${commentId}`, {
    method: 'PATCH',
    body: { body },
  });
}

export async function createCheckRun({ token, owner, repo, headSha, name, title, summary, conclusion = 'success' }) {
  return ghFetch(token, `/repos/${owner}/${repo}/check-runs`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: {
      name,
      head_sha: headSha,
      status: 'completed',
      conclusion,
      output: { title, summary },
    },
  });
}

// event: 'APPROVE' | 'REQUEST_CHANGES' | 'COMMENT'
export async function submitPrReview({ token, owner, repo, pullNumber, event, body }) {
  return ghFetch(token, `/repos/${owner}/${repo}/pulls/${pullNumber}/reviews`, {
    method: 'POST',
    body: { event, body },
  });
}

export async function withRetry(fn, { retries = 3, baseDelayMs = 800 } = {}) {
  let lastErr;
  for (let i = 0; i < retries; i++) {
    try {
      return await fn();
    } catch (e) {
      lastErr = e;
      // 4xx errors (except 429 Too Many Requests) are not transient — don't retry
      if (e.status >= 400 && e.status < 500 && e.status !== 429) {
        throw e;
      }
      // 429: respect Retry-After header if present
      const retryAfterMs = e.status === 429 && e.retryAfter
        ? e.retryAfter * 1000
        : baseDelayMs * Math.pow(2, i);
      await sleep(retryAfterMs);
    }
  }
  throw lastErr;
}
