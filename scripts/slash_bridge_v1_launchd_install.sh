#!/bin/bash
# macOS launchd 安装脚本：注册 slash-bridge-v1 为 LaunchAgent
# 约定：
# - Label 固定 ai.openclaw.slash-bridge-v1
# - plist 写入 ~/Library/LaunchAgents/ai.openclaw.slash-bridge-v1.plist
# - ProgramArguments: /bin/bash + <repo_root>/scripts/slash_bridge_v1_run.sh（绝对路径）
# - WorkingDirectory: <repo_root>/hooks/slash-bridge-v1
# - Stdout/Err: ~/Library/Logs/openclaw/slash-bridge-v1.out.log & .err.log

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RUN_SCRIPT="${REPO_ROOT}/scripts/slash_bridge_v1_run.sh"
WORK_DIR="${REPO_ROOT}/hooks/slash-bridge-v1"

LABEL="ai.openclaw.slash-bridge-v1"
PLIST_PATH="${HOME}/Library/LaunchAgents/${LABEL}.plist"
GUI_DOMAIN="gui/$(id -u)"
LOG_DIR="${HOME}/Library/Logs/openclaw"

if [[ -L "${LOG_DIR}" ]]; then
  echo "❌ 安装失败：${LOG_DIR} 是 symlink（存在日志重定向风险），请手动处理后重试" >&2
  exit 1
fi
mkdir -p "${LOG_DIR}"
chmod 700 "${LOG_DIR}"

mkdir -p "${HOME}/Library/LaunchAgents"

cat > "${PLIST_PATH}" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
  <dict>
    <key>Label</key>
    <string>${LABEL}</string>

    <key>ProgramArguments</key>
    <array>
      <string>/bin/bash</string>
      <string>${RUN_SCRIPT}</string>
    </array>

    <key>RunAtLoad</key>
    <true/>

    <key>KeepAlive</key>
    <true/>

    <key>StandardOutPath</key>
    <string>${LOG_DIR}/slash-bridge-v1.out.log</string>

    <key>StandardErrorPath</key>
    <string>${LOG_DIR}/slash-bridge-v1.err.log</string>

    <key>WorkingDirectory</key>
    <string>${WORK_DIR}</string>

    <key>EnvironmentVariables</key>
    <dict>
      <!-- 让 launchd 环境能找到 node/npm -->
      <key>PATH</key>
      <string>/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin</string>
    </dict>
  </dict>
</plist>
EOF

# 先卸载旧服务（若存在），再加载新 plist
launchctl bootout "${GUI_DOMAIN}" "${PLIST_PATH}" 2>/dev/null || true
launchctl bootstrap "${GUI_DOMAIN}" "${PLIST_PATH}"
launchctl kickstart -k "${GUI_DOMAIN}/${LABEL}"

echo "✅ 已安装并启动：${LABEL}"
echo "- plist: ${PLIST_PATH}"
echo "- stdout: ${LOG_DIR}/slash-bridge-v1.out.log"
echo "- stderr: ${LOG_DIR}/slash-bridge-v1.err.log"
