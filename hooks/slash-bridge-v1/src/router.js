/**
 * Command routing: maps commands to default agents,
 * resolves final agentId with optional override validation.
 */

// Default agent per command (new naming as of plan)
const ROUTE_TABLE = new Map([
  ['plan',        'lixunhuan'],
  ['plan-pr',     'lixunhuan'],  // backward-compat alias
  ['implement',   'lengyan'],
  ['impl-pr',     'lengyan'],    // backward-compat alias
  ['review',      'lixunhuan'],
  ['security',    'jingwuming'],
  ['followup',    'lengyan'],
  ['pr-desc',     'lengyan'],
]);

// Allowed agent override list (prevents escalation to arbitrary agents)
const ALLOWED_AGENTS = new Set([
  'main', 'luxiaofeng', 'afei', 'jingwuming', 'lengyan', 'lixunhuan', 'aji',
]);

/**
 * Returns the default agentId for a command, or null if unknown.
 */
export function defaultRoute(command) {
  return ROUTE_TABLE.get(String(command || '').trim()) || null;
}

/**
 * Returns true if the given agentId is in the allowed override list.
 */
export function isAgentAllowed(agentId) {
  return ALLOWED_AGENTS.has(String(agentId || '').trim());
}

/**
 * Resolves the final agentId for a request.
 * Returns { agentId, error } where error is a reasonCode string or null.
 */
export function resolveAgent(command, overrideAgentId) {
  const override = String(overrideAgentId || '').trim() || null;

  if (override) {
    if (!isAgentAllowed(override)) {
      return { agentId: null, error: 'AGENT_NOT_ALLOWED' };
    }
    return { agentId: override, error: null };
  }

  const routed = defaultRoute(command);
  if (!routed) {
    return { agentId: null, error: 'ROUTE_NOT_FOUND' };
  }

  return { agentId: routed, error: null };
}
