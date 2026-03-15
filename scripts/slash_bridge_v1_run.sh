#!/bin/bash
# slash-bridge-v1 启动脚本（本地/launchd 共用）
# - 从 hooks/slash-bridge-v1/.env 加载环境变量（并导出到子进程）
# - 若 node_modules 不存在则 npm ci
# - 最终 exec node src/server.js

set -euo pipefail

# 动态定位仓库根目录
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WORK_DIR="${REPO_ROOT}/hooks/slash-bridge-v1"
ENV_FILE="${WORK_DIR}/.env"

cd "${WORK_DIR}"

if [[ ! -f "${ENV_FILE}" ]]; then
  echo "❌ 未找到 ${ENV_FILE}（请参考 ${WORK_DIR}/.env.example 创建）" >&2
  exit 1
fi

# 加载并导出环境变量
set -a
# shellcheck source=/dev/null
source "${ENV_FILE}"
set +a

# 提示端口（默认 8787，server.js 也会默认 8787）
export PORT="${PORT:-8787}"
echo "[slash-bridge-v1] 启动中，PORT=${PORT}（默认 8787）"

if [[ ! -d node_modules ]]; then
  echo "[slash-bridge-v1] node_modules 不存在，执行 npm ci..."
  npm ci
fi

echo "[slash-bridge-v1] exec node src/server.js"
exec node src/server.js
