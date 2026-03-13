# Slash Bridge v1 Spec

> Status: Draft v1 (for `/qzai <command>` on GitHub comment triggers)
> Scope: GitHub issue_comment -> Hook -> OpenClaw agent -> GitHub writeback

## 1. End-to-end data flow
1) GitHub `issue_comment` webhook receives `/qzai <command> [args]`.
2) Bridge precheck: command allowlist, author policy, repo/installation allowlist.
3) Security gate: signature/timestamp/nonce verification (fail-closed).
4) Dedupe gate:
   - Transport dedupe by `deliveryId` (`X-GitHub-Delivery`)
   - Command dedupe by `idempotencyKey` (see §3)
5) Queue/dispatch: create `runId`, enqueue execution, call OpenClaw (`sessions_spawn` or equivalent).
6) Result writeback to GitHub:
   - quick ACK comment (accepted/rejected + runId)
   - final result via comment/review/check-run summary (configurable by command profile)

## 2. Security gates (fail-closed)
- Signature: HMAC or equivalent signed payload validation.
- Replay protection: timestamp window + nonce one-time use.
- Repo allowlist: only configured `owner/repo` accepted.
- Installation allowlist: request installation must match configured installation id.
- Author policy: `author_association` or explicit policy map; otherwise reject.
- Rate limit: per repo + per actor throttling; overflow -> reject with explicit reason.

Any failed gate => no agent execution, writeback rejection reason + trace id.

## 3. Idempotency and dedupe

## 3.1 Transport-level dedupe
- Key: `deliveryId` from `X-GitHub-Delivery`
- Behavior: duplicate delivery returns same ACK, no re-dispatch.

## 3.2 Command-level dedupe
- `idempotencyKey` fields:
  - `repo`
  - `issueOrPrNumber`
  - `headSha`
  - `command`
  - `argsHash`
  - `requestedBy`
- Behavior:
  - same key in-progress -> return existing `runId`
  - same key completed -> return last result reference
  - force rerun requires explicit command flag (e.g. `--force`) and records parent run

## 4. Payload schema v1

```json
{
  "schemaVersion": 1,
  "deliveryId": "uuid-from-github",
  "command": "review",
  "args": "--scope diff",
  "repo": "qqchang2nd/qzai-workflows",
  "owner": "qqchang2nd",
  "installationId": 123456,
  "issueNumber": 48,
  "prNumber": 49,
  "commentId": 4051032787,
  "commentUrl": "https://github.com/.../issuecomment-...",
  "prUrl": "https://github.com/.../pull/49",
  "headSha": "abcdef...",
  "baseSha": "123456...",
  "requestedBy": "qqchang2nd",
  "requestedAt": "2026-03-12T23:39:05Z",
  "idempotencyKey": "repo#pr#head#command#argsHash#actor"
}
```

Mandatory fields: `schemaVersion, deliveryId, command, repo, installationId, commentId, headSha, requestedBy, requestedAt, idempotencyKey`.

## 5. Failure modes and writeback policy
- **Auth/Gate failure**: immediate ACK comment with `REJECTED` + reason code.
- **Dispatch failure**: ACK `FAILED_TO_DISPATCH` + retry hint.
- **Execution timeout**: final writeback `TIMEOUT` + runId + suggested rerun command.
- **Writeback failure**:
  - retry with exponential backoff
  - idempotent by `(runId, targetType, targetId)`
  - if exhausted, persist dead-letter record for manual replay

Writeback phases:
1) ACK (fast): accepted/rejected + runId
2) Final (async): verdict, summary, evidence links, error code (if any)

## 6. Plans vs Spec
- Plan snapshot index: `.qzai/plans/i48-c4051032787/PLAN.md`
- Stable implementation spec: `.qzai/specs/slash-bridge-v1.md` (this file)
