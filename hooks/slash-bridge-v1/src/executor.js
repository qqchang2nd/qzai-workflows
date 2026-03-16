/**
 * Executor: dispatches tasks to agents via A2A HTTP interface.
 * Adapter pattern - the A2A dispatch is injected so it can be swapped/mocked in tests.
 *
 * The executor does NOT call Claude API directly.
 * It builds a task description and sends it to the target agent process.
 */

import { buildPlanTask } from './task/plan.js';
import { buildReviewTask } from './task/review.js';
import { buildImplementTask } from './task/implement.js';
import { buildSecurityTask } from './task/security.js';
import { buildFollowupTask } from './task/followup.js';
import { getLatestReviewRound, updateReviewRoundStatus } from './db.js';

const MAX_REVIEW_ROUNDS = Number(process.env.QZAI_MAX_REVIEW_ROUNDS || 3);

/**
 * Build the task payload for a given command.
 */
export function buildTask(command, payload) {
  const { owner, repo, issueNumber, prNumber, headSha, baseSha, requestedBy } = payload;
  const num = prNumber || issueNumber;

  switch (command) {
    case 'plan':
    case 'plan-pr':
      return buildPlanTask({ owner, repo, issueNumber, issueBody: payload.issueBody, requestedBy });

    case 'implement':
    case 'impl-pr':
      return buildImplementTask({
        owner, repo, issueNumber,
        planPrNumber: payload.planPrNumber,
        planFilePath: payload.planFilePath,
        requestedBy,
      });

    case 'review':
      return buildReviewTask({
        owner, repo, prNumber: num, headSha, baseSha,
        round: payload.round || 1,
        requestedBy,
      });

    case 'security':
      return buildSecurityTask({ owner, repo, prNumber: num, headSha, baseSha, requestedBy });

    case 'followup':
      return buildFollowupTask({
        owner, repo, prNumber: num,
        prAuthor: payload.prAuthor,
        originalReviewer: payload.originalReviewer,
        mode: payload.followupMode || 'notify',
        round: payload.round || 1,
        blockingIssues: payload.blockingIssues || [],
        allUnresolvedIssues: payload.allUnresolvedIssues || [],
        maxRounds: payload.maxRounds || MAX_REVIEW_ROUNDS,
        requestedBy,
      });

    case 'pr-desc':
      return buildImplementTask({
        owner, repo,
        issueNumber: issueNumber || num,
        planPrNumber: payload.planPrNumber,
        planFilePath: payload.planFilePath,
        requestedBy,
      });

    default:
      throw new Error(`Unknown command: ${command}`);
  }
}

/**
 * Default A2A dispatch function.
 * Sends task to agent via HTTP POST.
 *
 * CRIT-2 fix: validate QZAI_A2A_ENDPOINT against an allowlist of safe prefixes
 * to prevent SSRF if the env var is tampered with.
 */
const ALLOWED_A2A_PREFIXES = ['http://localhost:', 'http://127.0.0.1:', 'https://'];
const ALLOWED_GATEWAY_PREFIXES = ['http://localhost:', 'http://127.0.0.1:'];

function validateA2aEndpoint(endpoint) {
  if (!endpoint) throw new Error('QZAI_A2A_ENDPOINT is not set');
  const allowed = ALLOWED_A2A_PREFIXES.some((prefix) => endpoint.startsWith(prefix));
  if (!allowed) {
    throw new Error(`QZAI_A2A_ENDPOINT "${endpoint}" is not in the allowed prefix list: ${ALLOWED_A2A_PREFIXES.join(', ')}`);
  }
  // Reject credentials in URL
  try {
    const u = new URL(endpoint);
    if (u.username || u.password) throw new Error('QZAI_A2A_ENDPOINT must not contain credentials');
  } catch (e) {
    if (e.message.includes('credentials')) throw e;
    throw new Error(`QZAI_A2A_ENDPOINT is not a valid URL: ${endpoint}`);
  }
}

function validateGatewayUrl(url) {
  if (!url) throw new Error('QZAI_GATEWAY_URL is not set');
  // Parse first to catch credentials and malformed URLs early
  let u;
  try {
    u = new URL(url);
  } catch (_e) {
    throw new Error(`QZAI_GATEWAY_URL is not a valid URL: ${url}`);
  }
  if (u.username || u.password) throw new Error('QZAI_GATEWAY_URL must not contain credentials');
  const allowed = ALLOWED_GATEWAY_PREFIXES.some((prefix) => url.startsWith(prefix));
  if (!allowed) {
    throw new Error(`QZAI_GATEWAY_URL "${url}" is not in the allowed prefix list: ${ALLOWED_GATEWAY_PREFIXES.join(', ')}`);
  }
}

async function defaultA2aDispatch(agentId, task) {
  const gatewayToken = process.env.QZAI_GATEWAY_TOKEN;

  if (gatewayToken) {
    const gatewayUrl = process.env.QZAI_GATEWAY_URL || 'http://127.0.0.1:18789/tools/invoke';
    // Fix 1: validate gateway URL against allowlist (SSRF prevention)
    validateGatewayUrl(gatewayUrl);

    const resp = await fetch(gatewayUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${gatewayToken}`,
      },
      body: JSON.stringify({
        tool: 'sessions_spawn',
        args: {
          runtime: 'subagent',
          agentId,
          // Fix 2: fire-and-forget — omit mode:'run' so gateway queues async;
          // we only wait for the spawn ACK, not task completion.
          task: typeof task === 'string' ? task : JSON.stringify(task),
        },
      }),
      signal: AbortSignal.timeout(30_000),
    });

    // Fix 3: read body before throwing so error includes server detail
    const bodyText = await resp.text().catch(() => '');
    if (!resp.ok) {
      throw new Error(`Gateway dispatch failed: HTTP ${resp.status} ${bodyText}`.trimEnd());
    }

    // Fix 3: parse JSON safely, fall back to raw text
    let gwResult;
    try {
      gwResult = JSON.parse(bodyText);
    } catch (_e) {
      gwResult = { summary: bodyText || 'Gateway returned non-JSON response' };
    }

    return {
      verdict: 'dispatched',
      sessionId: gwResult?.sessionId ?? gwResult?.id ?? undefined,
      summary: gwResult?.summary ?? gwResult?.message ?? 'Task dispatched via Gateway',
      evidenceLinks: [],
    };
  }

  const endpoint = process.env.QZAI_A2A_ENDPOINT || 'http://localhost:8788/a2a';
  const authToken = process.env.QZAI_A2A_TOKEN || '';

  validateA2aEndpoint(endpoint);

  const resp = await fetch(`${endpoint}/dispatch`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
    },
    body: JSON.stringify({ agentId, task }),
    signal: AbortSignal.timeout(30_000),
  });

  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    throw new Error(`A2A dispatch failed: HTTP ${resp.status} ${text}`);
  }

  return resp.json();
}

/**
 * Create a dispatch function with injected dependencies.
 * @param {object} opts
 * @param {function} [opts.a2aDispatch] - Override A2A dispatch for testing
 */
export function createDispatcher({ db, githubClient, config, a2aDispatch = defaultA2aDispatch } = {}) {
  return async function dispatch(command, agentId, payload) {
    const task = buildTask(command, payload);
    const result = await a2aDispatch(agentId, task);
    return result;
  };
}
