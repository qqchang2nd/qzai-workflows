import { test } from 'node:test';
import assert from 'node:assert/strict';
import { withRetry, submitPrReview } from '../src/github.js';

// Helper to create a mock fetch
function mockFetch(responses) {
  let i = 0;
  return async (url, opts) => {
    const r = responses[i++] || { ok: false, status: 500, body: {} };
    const status = r.status || (r.ok ? 200 : 500);
    return {
      ok: r.ok !== false,
      status,
      headers: { get: (h) => r.headers?.[h] ?? null },
      text: async () => JSON.stringify(r.body || {}),
    };
  };
}

test('withRetry: succeeds on first try', async () => {
  let calls = 0;
  const result = await withRetry(() => { calls++; return 'ok'; }, { retries: 3, baseDelayMs: 1 });
  assert.equal(result, 'ok');
  assert.equal(calls, 1);
});

test('withRetry: retries on 5xx and succeeds', async () => {
  let calls = 0;
  const result = await withRetry(() => {
    calls++;
    if (calls < 3) {
      const err = new Error('500');
      err.status = 500;
      throw err;
    }
    return 'ok';
  }, { retries: 3, baseDelayMs: 1 });
  assert.equal(result, 'ok');
  assert.equal(calls, 3);
});

test('withRetry: throws after exhausting all retries', async () => {
  let calls = 0;
  await assert.rejects(async () => {
    await withRetry(() => {
      calls++;
      const err = new Error('500');
      err.status = 500;
      throw err;
    }, { retries: 2, baseDelayMs: 1 });
  }, /500/);
  assert.equal(calls, 2);
});

test('withRetry: 401 is not retried (immediately throws)', async () => {
  let calls = 0;
  await assert.rejects(async () => {
    await withRetry(() => {
      calls++;
      const err = new Error('401');
      err.status = 401;
      throw err;
    }, { retries: 3, baseDelayMs: 1 });
  });
  assert.equal(calls, 1, '401 should not be retried');
});

test('withRetry: 403 is not retried', async () => {
  let calls = 0;
  await assert.rejects(async () => {
    await withRetry(() => {
      calls++;
      const err = new Error('403');
      err.status = 403;
      throw err;
    }, { retries: 3, baseDelayMs: 1 });
  });
  assert.equal(calls, 1, '403 should not be retried');
});

test('withRetry: 404 is not retried', async () => {
  let calls = 0;
  await assert.rejects(async () => {
    await withRetry(() => {
      calls++;
      const err = new Error('404');
      err.status = 404;
      throw err;
    }, { retries: 3, baseDelayMs: 1 });
  });
  assert.equal(calls, 1, '404 should not be retried');
});

test('withRetry: 429 is retried', async () => {
  let calls = 0;
  await assert.rejects(async () => {
    await withRetry(() => {
      calls++;
      const err = new Error('429');
      err.status = 429;
      err.retryAfter = null;
      throw err;
    }, { retries: 2, baseDelayMs: 1 });
  });
  assert.equal(calls, 2, '429 should be retried');
});
