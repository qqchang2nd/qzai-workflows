#!/bin/bash
# macOS launchd 卸载脚本：停止并移除 slash-bridge-v1 LaunchAgent

set -euo pipefail

LABEL="ai.openclaw.slash-bridge-v1"
PLIST_PATH="${HOME}/Library/LaunchAgents/${LABEL}.plist"
GUI_DOMAIN="gui/$(id -u)"

# 停止并卸载（忽略不存在）
launchctl bootout "${GUI_DOMAIN}" "${PLIST_PATH}" 2>/dev/null || true

# 删除 plist
if [[ -f "${PLIST_PATH}" ]]; then
  rm -f "${PLIST_PATH}"
  echo "✅ 已移除：${PLIST_PATH}"
else
  echo "ℹ️ 未找到 plist：${PLIST_PATH}（可能已移除）"
fi
