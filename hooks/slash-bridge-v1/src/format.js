/**
 * Pure formatting functions for ACK and Final comments.
 * No side effects, no I/O.
 */

export function reason(reasonCode, detail) {
  return { reasonCode, detail };
}

export function formatAck(ack, payload) {
  const lines = [
    '### QZAI Slash Bridge v1 (ACK)',
    `- accepted: ${ack.accepted ? 'true' : 'false'}`,
    `- traceId: \`${ack.traceId}\``,
    `- runId: \`${ack.runId}\``,
    payload?.deliveryId ? `- deliveryId: \`${payload.deliveryId}\`` : null,
    payload?.idempotencyKey ? `- idempotencyKey: \`${payload.idempotencyKey}\`` : null,
    ack.reasonCode ? `- reasonCode: \`${ack.reasonCode}\`` : null,
    ack.detail ? `- detail: ${ack.detail}` : null,
    ack.agentId ? `- agentId: \`${ack.agentId}\`` : null,
    ack.nextAction ? `- nextAction: ${ack.nextAction}` : null,
  ].filter(Boolean);
  return lines.join('\n');
}

export function formatFinal(final, payload) {
  const lines = [
    '### QZAI Slash Bridge v1 (Final)',
    `- verdict: \`${final.verdict}\``,
    `- traceId: \`${final.traceId}\``,
    `- runId: \`${final.runId}\``,
    payload?.deliveryId ? `- deliveryId: \`${payload.deliveryId}\`` : null,
    payload?.idempotencyKey ? `- idempotencyKey: \`${payload.idempotencyKey}\`` : null,
    final.errorCode ? `- errorCode: \`${final.errorCode}\`` : null,
    final.reasonCode ? `- reasonCode: \`${final.reasonCode}\`` : null,
    final.summary ? `- summary: ${final.summary}` : null,
    final.nextAction ? `- nextAction: ${final.nextAction}` : null,
  ].filter(Boolean);
  return lines.join('\n');
}
