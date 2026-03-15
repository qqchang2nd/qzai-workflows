/**
 * Integration tests for the handler.
 * Uses in-memory SQLite and mocked GitHub client + dispatcher.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { openDb } from '../src/db.js';
import { parseAllowedRepos } from '../src/policy.js';
import { createHandler } from '../src/handler.js';
import { computeHmacSha256Hex } from '../src/crypto.js';

const SECRET = 'testsecret';
const REPO = 'testowner/testrepo';
const INSTALL_ID = 12345;
const NOW = Date.now();

function makeAllowedRepos() {
  return parseAllowedRepos(`${REPO}:${INSTALL_ID}`);
}

function makeConfig(overrides = {}) {
  return {
    secret: SECRET,
    allowedRepos: makeAllowedRepos(),
    authorAssocExtra: [],
    rateLimitWindowMs: 60_000,
    rateLimitMax: 5,
    ...overrides,
  };
}

let commentLog = [];
let dispatchLog = [];

function makeGithubClient() {
  return {
    withRetry: async (fn) => fn(),
    createIssueComment: async (opts) => { commentLog.push({ type: 'create', ...opts }); return { id: 999 }; },
    updateIssueComment: async (opts) => { commentLog.push({ type: 'update', ...opts }); },
  };
}

function makeDispatch(result = { verdict: 'success', summary: 'ok', evidenceLinks: [] }) {
  return async (command, agentId, payload) => {
    dispatchLog.push({ command, agentId, payload });
    return result;
  };
}

async function makeHandler(overrides = {}) {
  commentLog = [];
  dispatchLog = [];
  const db = await openDb(':memory:');
  const config = makeConfig(overrides.config);
  const getToken = async () => 'fake-token';
  const dispatch = overrides.dispatch || makeDispatch();
  const githubClient = makeGithubClient();
  const handler = createHandler({ db, config, getToken, dispatch, githubClient });
  return { db, handler };
}

function makePayload(overrides = {}) {
  return {
    schemaVersion: 1,
    deliveryId: `del_${Math.random().toString(36).slice(2)}`,
    command: 'review',
    repo: REPO,
    installationId: INSTALL_ID,
    issueNumber: 1,
    prNumber: 1,
    commentId: '111',
    commentUrl: 'http://github.com/comment/111',
    headSha: 'abc123',
    baseSha: 'def456',
    requestedBy: 'alice',
    requestedAt: new Date().toISOString(),
    authorAssociation: 'MEMBER',
    idempotencyKey: `idem_${Math.random().toString(36).slice(2)}`,
    ...overrides,
  };
}

function makeRequest(payload, overrides = {}) {
  const body = JSON.stringify(payload);
  const ts = NOW;
  const nonce = `nonce_${Math.random().toString(36).slice(2).padEnd(8, '0')}`;
  const sig = computeHmacSha256Hex(SECRET, body);

  return {
    method: 'POST',
    url: '/hooks/slash-bridge-v1',
    headers: {
      'x-hub-signature-256': `sha256=${sig}`,
      'x-qzai-timestamp': String(ts),
      'x-qzai-nonce': nonce,
      'content-type': 'application/json',
      ...overrides.headers,
    },
    body,
    ...overrides,
  };
}

// Simulate an HTTP request through the handler
async function sendRequest(handler, req) {
  let statusCode = 200;
  let responseBody = '';
  const chunks = [];

  const mockReq = {
    method: req.method,
    url: req.url,
    headers: req.headers,
    [Symbol.asyncIterator]: async function* () {
      yield Buffer.from(req.body || '');
    },
  };

  const mockRes = {
    headersSent: false,
    writeHead: (code, headers) => {
      statusCode = code;
      mockRes.headersSent = true;
    },
    end: (body) => { responseBody = body; },
  };

  await handler(mockReq, mockRes);
  let parsed = {};
  try { parsed = JSON.parse(responseBody); } catch {}
  return { status: statusCode, body: parsed };
}

// --- Health check ---
test('GET /health returns 200 ok', async () => {
  const { handler } = await makeHandler();
  const mockReq = { method: 'GET', url: '/health', headers: {}, [Symbol.asyncIterator]: async function* () {} };
  const mockRes = { headersSent: false, writeHead: () => {}, end: (b) => { mockRes._body = b; } };
  await handler(mockReq, mockRes);
  const body = JSON.parse(mockRes._body);
  assert.equal(body.ok, true);
});

// --- Reject paths ---
test('SIG_INVALID: missing signature returns 401', async () => {
  const { handler } = await makeHandler();
  const payload = makePayload();
  const req = makeRequest(payload, { headers: {} }); // no sig header
  const resp = await sendRequest(handler, req);
  assert.equal(resp.status, 401);
  assert.equal(resp.body.reasonCode, 'SIG_INVALID');
});

test('SIG_INVALID: wrong signature returns 401', async () => {
  const { handler } = await makeHandler();
  const payload = makePayload();
  const req = makeRequest(payload, {
    headers: { 'x-hub-signature-256': 'sha256=' + 'a'.repeat(64), 'x-qzai-timestamp': String(NOW), 'x-qzai-nonce': 'nonce12345' },
  });
  const resp = await sendRequest(handler, req);
  assert.equal(resp.status, 401);
  assert.equal(resp.body.reasonCode, 'SIG_INVALID');
});

test('TIMESTAMP_EXPIRED: old timestamp returns 401', async () => {
  const { handler } = await makeHandler();
  const payload = makePayload();
  const body = JSON.stringify(payload);
  const oldTs = Date.now() - 10 * 60 * 1000;
  const sig = computeHmacSha256Hex(SECRET, body);
  const req = {
    method: 'POST', url: '/hooks/slash-bridge-v1',
    headers: {
      'x-hub-signature-256': `sha256=${sig}`,
      'x-qzai-timestamp': String(oldTs),
      'x-qzai-nonce': 'nonce12345',
    },
    body,
  };
  const resp = await sendRequest(handler, req);
  assert.equal(resp.status, 401);
  assert.equal(resp.body.reasonCode, 'TIMESTAMP_EXPIRED');
});

test('NONCE_REPLAY: same nonce twice returns 401 second time', async () => {
  const { handler } = await makeHandler();
  const payload1 = makePayload();
  const req1 = makeRequest(payload1);
  const nonce = req1.headers['x-qzai-nonce'];

  // First request succeeds
  await sendRequest(handler, req1);

  // Second request with same nonce: need new deliveryId + idempotencyKey but same nonce
  const payload2 = makePayload();
  const body2 = JSON.stringify(payload2);
  const sig2 = computeHmacSha256Hex(SECRET, body2);
  const req2 = {
    method: 'POST', url: '/hooks/slash-bridge-v1',
    headers: {
      'x-hub-signature-256': `sha256=${sig2}`,
      'x-qzai-timestamp': String(NOW),
      'x-qzai-nonce': nonce,
    },
    body: body2,
  };
  const resp2 = await sendRequest(handler, req2);
  assert.equal(resp2.status, 401);
  assert.equal(resp2.body.reasonCode, 'NONCE_REPLAY');
});

test('DELIVERY_DUP: same deliveryId second time returns cached ack', async () => {
  const { handler } = await makeHandler();
  const payload = makePayload();
  const req1 = makeRequest(payload);
  await sendRequest(handler, req1);

  // Second request with same deliveryId but fresh nonce
  const req2 = makeRequest(payload);
  const resp = await sendRequest(handler, req2);
  assert.equal(resp.status, 200);
  assert.equal(resp.body.status, 'DELIVERY_DUP');
  assert.ok(resp.body.ack);
});

test('ARGS_INVALID: missing required fields returns 400', async () => {
  const { handler } = await makeHandler();
  const payload = { deliveryId: 'del_x', command: 'review' }; // missing many required fields
  const body = JSON.stringify(payload);
  const sig = computeHmacSha256Hex(SECRET, body);
  const req = {
    method: 'POST', url: '/hooks/slash-bridge-v1',
    headers: {
      'x-hub-signature-256': `sha256=${sig}`,
      'x-qzai-timestamp': String(NOW),
      'x-qzai-nonce': 'nonce12345',
    },
    body,
  };
  const resp = await sendRequest(handler, req);
  assert.equal(resp.body.reasonCode || resp.body.ack?.reasonCode, 'ARGS_INVALID');
});

test('REPO_NOT_ALLOWED: unlisted repo returns ack with REPO_NOT_ALLOWED', async () => {
  const { handler } = await makeHandler();
  const payload = makePayload({ repo: 'evil/repo', installationId: 999 });
  const req = makeRequest(payload);
  const resp = await sendRequest(handler, req);
  assert.equal(resp.status, 200);
  assert.equal(resp.body.ack?.reasonCode, 'REPO_NOT_ALLOWED');
});

test('INSTALLATION_MISMATCH: wrong installationId returns ack with INSTALLATION_MISMATCH', async () => {
  const { handler } = await makeHandler();
  const payload = makePayload({ installationId: 99999 }); // wrong
  const req = makeRequest(payload);
  const resp = await sendRequest(handler, req);
  assert.equal(resp.status, 200);
  assert.equal(resp.body.ack?.reasonCode, 'INSTALLATION_MISMATCH');
});

test('GH_AUTH_FAILED: token failure returns ack with GH_AUTH_FAILED', async () => {
  const { db } = await makeHandler();
  const config = makeConfig();
  const getToken = async () => { throw new Error('auth error'); };
  const dispatch = makeDispatch();
  const githubClient = makeGithubClient();
  const handler = createHandler({ db, config, getToken, dispatch, githubClient });

  const payload = makePayload();
  const req = makeRequest(payload);
  const resp = await sendRequest(handler, req);
  assert.equal(resp.status, 200);
  assert.equal(resp.body.ack?.reasonCode, 'GH_AUTH_FAILED');
});

test('AUTHOR_NOT_ALLOWED: NONE authorAssociation is rejected', async () => {
  const { handler } = await makeHandler();
  const payload = makePayload({ authorAssociation: 'NONE' });
  const req = makeRequest(payload);
  const resp = await sendRequest(handler, req);
  assert.equal(resp.body.ack?.reasonCode, 'AUTHOR_NOT_ALLOWED');
});

test('RATE_LIMITED: exceeding rate limit is rejected', async () => {
  const db = await openDb(':memory:');
  const config = makeConfig({ rateLimitMax: 2 });
  const getToken = async () => 'fake-token';
  const dispatch = makeDispatch();
  const githubClient = makeGithubClient();
  const handler = createHandler({ db, config, getToken, dispatch, githubClient });

  // First 2 succeed
  for (let i = 0; i < 2; i++) {
    const p = makePayload();
    const resp = await sendRequest(handler, makeRequest(p));
    assert.equal(resp.body.ack?.accepted, true, `request ${i + 1} should succeed`);
  }
  // 3rd should be rate limited
  const p3 = makePayload();
  const resp3 = await sendRequest(handler, makeRequest(p3));
  assert.equal(resp3.body.ack?.reasonCode, 'RATE_LIMITED');
});

test('AGENT_NOT_ALLOWED: bad agentId override is rejected', async () => {
  const { handler } = await makeHandler();
  const payload = makePayload({ agentId: 'hacker' });
  const req = makeRequest(payload);
  const resp = await sendRequest(handler, req);
  assert.equal(resp.body.ack?.reasonCode, 'AGENT_NOT_ALLOWED');
});

test('ROUTE_NOT_FOUND: unknown command is rejected', async () => {
  const { handler } = await makeHandler();
  const payload = makePayload({ command: 'ship' });
  const req = makeRequest(payload);
  const resp = await sendRequest(handler, req);
  assert.equal(resp.body.ack?.reasonCode, 'ROUTE_NOT_FOUND');
});

// --- Accept path ---
test('UC-A: valid /qzai review request is accepted', async () => {
  const dispatched = [];
  const { handler } = await makeHandler({
    dispatch: async (cmd, agent, payload) => {
      dispatched.push({ cmd, agent });
      return { verdict: 'success', summary: 'ok', evidenceLinks: [] };
    },
  });
  const payload = makePayload({ command: 'review' });
  const req = makeRequest(payload);
  const resp = await sendRequest(handler, req);

  assert.equal(resp.status, 200);
  assert.equal(resp.body.ok, true);
  assert.equal(resp.body.ack?.accepted, true);
  assert.ok(resp.body.ack?.agentId);

  // Give async dispatch time to run
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(dispatched.length, 1);
  assert.equal(dispatched[0].cmd, 'review');
});

// --- Idempotency paths ---
test('IN_PROGRESS: same idempotencyKey while in_progress returns IN_PROGRESS', async () => {
  const db = await openDb(':memory:');
  const config = makeConfig();
  const getToken = async () => 'fake-token';
  // dispatch never resolves to simulate in-progress
  const dispatch = () => new Promise(() => {});
  const githubClient = makeGithubClient();
  const handler = createHandler({ db, config, getToken, dispatch, githubClient });

  const idemKey = 'idem_shared';
  const payload1 = makePayload({ idempotencyKey: idemKey });
  const req1 = makeRequest(payload1);
  await sendRequest(handler, req1);

  // Second request with same idempotencyKey, new deliveryId
  const payload2 = makePayload({ idempotencyKey: idemKey });
  const req2 = makeRequest(payload2);
  const resp = await sendRequest(handler, req2);
  assert.equal(resp.body.ack?.status, 'IN_PROGRESS');
});
