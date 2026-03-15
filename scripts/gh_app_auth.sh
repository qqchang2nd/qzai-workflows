#!/usr/bin/env bash
# gh_app_auth.sh - Generate a GitHub installation token for a QZAI agent.
#
# Usage:
#   gh_app_auth.sh --agent <agentId>
#   gh_app_auth.sh --help
#
# Outputs:
#   GH_TOKEN=<token>  (to stdout, suitable for eval or sourcing)
#
# Environment:
#   SLASH_BRIDGE_GH_APP_ID                 GitHub App ID
#   SLASH_BRIDGE_GH_APP_PRIVATE_KEY_PATH   Path to the PEM private key
#   SLASH_BRIDGE_GH_APP_INSTALLATION_ID    Default installation ID
#   QZAI_AGENT_<AGENTID>_INSTALL_ID        Per-agent installation ID override
#
# Example:
#   eval "$(gh_app_auth.sh --agent lixunhuan)"
#   gh pr list  # uses the generated GH_TOKEN

set -euo pipefail

AGENT_ID=""

# Parse arguments
while [[ $# -gt 0 ]]; do
  case "$1" in
    --agent)
      AGENT_ID="${2:-}"
      shift 2
      ;;
    --help|-h)
      sed -n '2,20p' "$0" | sed 's/^# //'
      exit 0
      ;;
    *)
      echo "Unknown argument: $1" >&2
      exit 1
      ;;
  esac
done

if [[ -z "${AGENT_ID}" ]]; then
  echo "Error: --agent <agentId> is required" >&2
  exit 1
fi

# Validate required env vars
: "${SLASH_BRIDGE_GH_APP_ID:?Missing SLASH_BRIDGE_GH_APP_ID}"
: "${SLASH_BRIDGE_GH_APP_PRIVATE_KEY_PATH:?Missing SLASH_BRIDGE_GH_APP_PRIVATE_KEY_PATH}"

if [[ ! -f "${SLASH_BRIDGE_GH_APP_PRIVATE_KEY_PATH}" ]]; then
  echo "Error: Private key file not found: ${SLASH_BRIDGE_GH_APP_PRIVATE_KEY_PATH}" >&2
  exit 1
fi

# Resolve installation ID: per-agent override > default
AGENT_UPPER="${AGENT_ID^^}"
AGENT_UPPER="${AGENT_UPPER//-/_}"
INSTALL_VAR="QZAI_AGENT_${AGENT_UPPER}_INSTALL_ID"
INSTALLATION_ID="${!INSTALL_VAR:-${SLASH_BRIDGE_GH_APP_INSTALLATION_ID:-}}"

if [[ -z "${INSTALLATION_ID}" ]]; then
  echo "Error: No installation ID found for agent '${AGENT_ID}'. Set ${INSTALL_VAR} or SLASH_BRIDGE_GH_APP_INSTALLATION_ID" >&2
  exit 1
fi

APP_ID="${SLASH_BRIDGE_GH_APP_ID}"
KEY_PATH="${SLASH_BRIDGE_GH_APP_PRIVATE_KEY_PATH}"

# Generate JWT and mint installation token via Python (available in GitHub Actions)
TOKEN="$(python3 - <<'PY'
import json, time, base64, hmac, hashlib, os, urllib.request
import subprocess, sys

app_id = os.environ['APP_ID']
key_path = os.environ['KEY_PATH']
installation_id = os.environ['INSTALLATION_ID']

# Read private key
with open(key_path, 'r') as f:
    pem = f.read().strip()

# Build JWT (RS256)
def b64url(data):
    if isinstance(data, str):
        data = data.encode()
    return base64.urlsafe_b64encode(data).rstrip(b'=').decode()

now = int(time.time())
header = b64url(json.dumps({'alg': 'RS256', 'typ': 'JWT'}))
payload = b64url(json.dumps({'iat': now, 'exp': now + 540, 'iss': str(app_id)}))
signing_input = f"{header}.{payload}".encode()

from cryptography.hazmat.primitives import serialization, hashes
from cryptography.hazmat.primitives.asymmetric import padding

private_key = serialization.load_pem_private_key(pem.encode(), password=None)
signature = private_key.sign(signing_input, padding.PKCS1v15(), hashes.SHA256())
jwt = f"{header}.{payload}.{b64url(signature)}"

# Exchange JWT for installation token
url = f"https://api.github.com/app/installations/{installation_id}/access_tokens"
req = urllib.request.Request(url, data=b'{}', method='POST')
req.add_header('Authorization', f'Bearer {jwt}')
req.add_header('Accept', 'application/vnd.github+json')
req.add_header('X-GitHub-Api-Version', '2022-11-28')
req.add_header('Content-Type', 'application/json')

with urllib.request.urlopen(req, timeout=10) as resp:
    data = json.loads(resp.read())

token = data.get('token', '')
if not token:
    print('Error: empty token in response', file=sys.stderr)
    sys.exit(1)
print(token)
PY
)"

if [[ -z "${TOKEN}" ]]; then
  echo "Error: Failed to generate token" >&2
  exit 1
fi

echo "GH_TOKEN=${TOKEN}"
