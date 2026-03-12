#!/usr/bin/env bash
set -euo pipefail

# pr_worktree_new.sh
# Create an isolated git worktree for a PR branch, always based on origin/main.
#
# Why: prevent "串单" (mixed commits) by physically isolating each PR in its own directory.
#
# Usage:
#   scripts/pr_worktree_new.sh --branch chore/foo --dir ../worktrees/chore-foo
#
# Notes:
# - Must be run from the repo root.

usage() {
  cat <<'USAGE'
用法:
  pr_worktree_new.sh --branch <branch> [--dir <worktree_dir>]

参数:
  --branch   新 PR 分支名（必填），例如: chore/comment-hygiene
  --dir      worktree 目录（可选）。默认: ../worktrees/<branch>（斜杠会被替换为 -）
行为（fail-closed）:
  1) 强制 git fetch origin
  2) 强制基于 origin/main 创建分支并建立独立 worktree
  3) 完成后打印下一步指令（cd 进入目录）
USAGE
}

BRANCH=""
DIR=""
BASE="origin/main"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --branch) BRANCH="$2"; shift 2;;
    --dir) DIR="$2"; shift 2;;
    -h|--help|help) usage; exit 0;;
    *) echo "❌ 未知参数: $1" >&2; usage; exit 2;;
  esac
done

if [[ -z "$BRANCH" ]]; then
  echo "❌ 缺少 --branch" >&2
  usage
  exit 2
fi

if [[ -z "$DIR" ]]; then
  safe="${BRANCH//\//-}"
  DIR="../worktrees/${safe}"
fi

if [[ ! -d .git ]]; then
  echo "❌ 请在仓库根目录执行（需要 .git）" >&2
  exit 2
fi

echo "==> fetch origin"
git fetch origin --prune

# fail-closed: base must exist
if ! git rev-parse --verify "$BASE" >/dev/null 2>&1; then
  echo "❌ base ref 不存在: $BASE" >&2
  exit 3
fi

# Ensure worktree dir parent exists
mkdir -p "$(dirname "$DIR")"

# If dir already used, fail-closed
if [[ -e "$DIR" ]]; then
  echo "❌ worktree 目录已存在: $DIR" >&2
  echo "如需复用请先删除或换一个 --dir。" >&2
  exit 4
fi

echo "==> create worktree"
# If branch already exists locally or remotely, git worktree add -b will fail.
# We prefer fail-closed to avoid accidentally stacking on existing history.
git worktree add -b "$BRANCH" "$DIR" "$BASE"

cat <<NEXT

✅ worktree 已创建
- branch: $BRANCH
- base:   $BASE
- dir:    $DIR

下一步：
  cd "$DIR"

建议流程：
  1) 在该目录内开发/提交（每个 PR 只在一个 worktree 内操作）
  2) push 后用 gh 创建 PR
NEXT
