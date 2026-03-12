#!/usr/bin/env bash
set -euo pipefail

# pr_worktree_drop.sh
# Safely remove a PR worktree directory.
#
# Usage:
#   scripts/pr_worktree_drop.sh --dir ../worktrees/chore-foo

usage() {
  cat <<'USAGE'
用法:
  pr_worktree_drop.sh --dir <worktree_dir>

说明:
- 只移除 git worktree 关联，不做 rm -rf；避免误删。
- 你如需删除目录，可在确认后手动 rm -rf。
USAGE
}

DIR=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --dir) DIR="$2"; shift 2;;
    -h|--help|help) usage; exit 0;;
    *) echo "❌ 未知参数: $1" >&2; usage; exit 2;;
  esac
done

if [[ -z "$DIR" ]]; then
  echo "❌ 缺少 --dir" >&2
  usage
  exit 2
fi

if [[ ! -d .git ]]; then
  echo "❌ 请在仓库根目录执行（需要 .git）" >&2
  exit 2
fi

git worktree remove "$DIR"

echo "✅ 已移除 worktree 关联：$DIR"
echo "如需删除目录：rm -rf '$DIR'（请谨慎）"
