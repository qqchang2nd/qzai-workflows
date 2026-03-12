#!/usr/bin/env bash
set -euo pipefail

# gh_safe_comment.sh
# Fail-closed GitHub comment publisher.
#
# Goals:
# - Prevent literal "\\n" sequences in comment bodies (must be real newlines).
# - Ensure we are using a GitHub App bot identity (qzai-xxx[bot]) by default.
# - Force body to be provided via --body-file (no inline string concatenation).
#
# Usage examples:
#   source /path/to/gh_app_auth.sh --agent luxiaofeng
#   scripts/gh_safe_comment.sh --repo qqchang2nd/qzai-workflows --pr 43 --body-file /tmp/comment.md
#
# Notes:
# - This script expects GH_TOKEN to already be set (e.g., by gh_app_auth.sh).

usage() {
  cat <<'USAGE'
用法:
  gh_safe_comment.sh --repo <owner/repo> (--pr <num> | --issue <num>) --body-file <path> [--allow-human]

必填参数:
  --repo        例如: qqchang2nd/qzai-workflows
  --pr          PR number（在 PR conversation 下发评论）
  --issue       Issue number（在 Issue 下发评论）
  --body-file   评论正文文件（Markdown）

可选:
  --allow-human 允许使用人类账号（默认禁止；P0 规则建议永远不要用）

强约束（fail-closed）:
  1) body-file 中出现字面量 "\\n" -> 直接失败（必须用真实换行）
  2) 默认要求当前身份为 qzai-xxx[bot] / qzai-bot[bot]；否则失败
USAGE
}

REPO=""
PR_NUM=""
ISSUE_NUM=""
BODY_FILE=""
ALLOW_HUMAN=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --repo) REPO="$2"; shift 2;;
    --pr) PR_NUM="$2"; shift 2;;
    --issue) ISSUE_NUM="$2"; shift 2;;
    --body-file) BODY_FILE="$2"; shift 2;;
    --allow-human) ALLOW_HUMAN=1; shift 1;;
    -h|--help|help) usage; exit 0;;
    *) echo "❌ 未知参数: $1" >&2; usage; exit 2;;
  esac
done


# Strict parameter validation (fail-closed)
# --repo must be owner/repo
if [[ -n "$REPO" ]] && ! [[ "$REPO" =~ ^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$ ]]; then
  echo "❌ FAIL-CLOSED: --repo 格式非法（应为 owner/repo）：$REPO" >&2
  exit 20
fi
# --pr / --issue must be positive integers
if [[ -n "$PR_NUM" ]] && ! [[ "$PR_NUM" =~ ^[1-9][0-9]*$ ]]; then
  echo "❌ FAIL-CLOSED: --pr 必须为正整数：$PR_NUM" >&2
  exit 21
fi
if [[ -n "$ISSUE_NUM" ]] && ! [[ "$ISSUE_NUM" =~ ^[1-9][0-9]*$ ]]; then
  echo "❌ FAIL-CLOSED: --issue 必须为正整数：$ISSUE_NUM" >&2
  exit 22
fi

if [[ -z "$REPO" || -z "$BODY_FILE" ]]; then
  echo "❌ 缺少 --repo 或 --body-file" >&2
  usage
  exit 2
fi

if [[ -n "$PR_NUM" && -n "$ISSUE_NUM" ]]; then
  echo "❌ 只能二选一：--pr 或 --issue" >&2
  exit 2
fi

if [[ -z "$PR_NUM" && -z "$ISSUE_NUM" ]]; then
  echo "❌ 必须提供 --pr 或 --issue" >&2
  exit 2
fi

if [[ ! -f "$BODY_FILE" ]]; then
  echo "❌ body-file 不存在: $BODY_FILE" >&2
  exit 2
fi

# 1) Content gate: forbid literal \n sequences
if python3 - <<PY
p=r'''$BODY_FILE'''
with open(p,'r',encoding='utf-8',errors='replace') as f:
    s=f.read()
# literal backslash+n
if "\\n" in s:
    raise SystemExit(10)
PY
then
  :
else
  rc=$?
  if [[ $rc -eq 10 ]]; then
    echo "❌ FAIL-CLOSED: 评论正文包含字面量 \\\\n。请使用真实换行，不要在文本里写 \\\\n。" >&2
    echo "提示：用多行 Markdown 文件（--body-file），不要用字符串拼接。" >&2
    exit 10
  fi
  echo "❌ 检查 body-file 失败 (rc=$rc)" >&2
  exit $rc
fi

# 2) Identity gate: require bot identity unless allow-human
if [[ -z "${GH_TOKEN:-}" ]]; then
  echo "❌ FAIL-CLOSED: GH_TOKEN 未设置。请先用 GitHub App 身份认证，例如：" >&2
  echo "   source scripts/gh_app_auth.sh --agent <agentId>" >&2
  exit 11
fi

login=$(gh api /user --jq .login 2>/dev/null || true)
if [[ -z "$login" ]]; then
  echo "❌ FAIL-CLOSED: 无法获取当前 GitHub 身份（gh api /user 失败）。" >&2
  exit 12
fi

is_bot=0
if [[ "$login" == *"[bot]" ]]; then
  is_bot=1
fi

is_qzai=0
if [[ "$login" == qzai-*"[bot]" || "$login" == "qzai-bot[bot]" ]]; then
  is_qzai=1
fi

if [[ $ALLOW_HUMAN -ne 1 ]]; then
  if [[ $is_bot -ne 1 || $is_qzai -ne 1 ]]; then
    echo "❌ FAIL-CLOSED: 当前身份不是 qzai GitHub App 机器人：login=$login" >&2
    echo "请先切换 App 身份（例如 source gh_app_auth.sh --agent <agentId>）。" >&2
    echo "如确需临时用人类账号，请显式加 --allow-human（不推荐）。" >&2
    exit 13
  fi
fi

# 3) Publish comment
owner="${REPO%/*}"
repo="${REPO#*/}"

if [[ -n "$PR_NUM" ]]; then
  # Issue number == PR number for issue_comment API
  issue_number="$PR_NUM"
else
  issue_number="$ISSUE_NUM"
fi

# Use REST to create comment with exact file content
body=$(cat "$BODY_FILE")

# shellcheck disable=SC2016
out=$(gh api -X POST "/repos/$owner/$repo/issues/$issue_number/comments" -f body="$body" --jq '{id:.id, url:.html_url, user:.user.login}' )

echo "✅ comment created: $out"
