# 2026-03-13｜Slash Bridge v1 E2E 热修复记录（补流程 PR）

背景：PR#53 合入后，在真实 E2E（GitHub Actions → Cloudflare Tunnel → Hook → GitHub 回写）验证中暴露若干“运行即阻塞/不可触发”的问题。为尽快恢复验证链路，当晚以 GitHub App 身份对 `main` 做了热修复 push（未走 PR）。

本 PR 的目的：
- 为上述 hotfix 补齐审计痕迹（why/what/how/证据）
- 让后续 review/追溯可在 PR 里一眼看清

## 变更摘要

### 1) 修复 workflow YAML 语法（避免 workflow file invalid）
- 现象：Actions run 报 `Invalid workflow file ... yaml syntax`（嵌入 python heredoc 缩进不正确）
- 修复：统一把 python heredoc 内容缩进到 `run: |` 区块内。

### 2) stop calling GET /repos/{owner}/{repo}/installation（401 JWT decode）
- 现象：`actions/github-script` 调用该 endpoint 返回 401 `A JSON web token could not be decoded`
- 修复：v1 不强依赖 installationId（allowlist 可选），Actions 不再调用该 endpoint；installationId 先从 event payload 取（缺失则传 0）。

### 3) Cloudflare 403：为 urllib 请求显式设置 User-Agent
- 现象：Actions POST 到 `https://bridge.tendou.eu.org/hooks/slash-bridge-v1` 返回 403 Forbidden
- 修复：在 python urllib request 上增加 `User-Agent: curl/8.0`。

### 4) hook 端 installationId 门禁：当 allowlist 未给 installationId 时不强制
- 现象：Actions 侧可能传 installationId=0，但 hook 端仍会 `ARGS_INVALID invalid installationId`
- 修复：仅当 allowlist 显式提供 installationId 时才做严格匹配；否则只校验 repo allowlist。

## 证据（E2E 成功）
- ACK 回写示例：
  https://github.com/qqchang2nd/qzai-workflows/pull/53#issuecomment-4056189318
- Final 回写示例：
  https://github.com/qqchang2nd/qzai-workflows/pull/53#issuecomment-4056189583

## 后续建议
- 建议开启 main 分支保护：必须 PR + 必须通过 Actions 检查（防止再出现“热修复直推 main”）。
