#!/usr/bin/env bash
# 執行驗證閘門；通過才 commit「步驟 N：名稱」、push，並在 docs/PROGRESS.md 打勾記下雜湊。
# 用法：bash scripts/commit-step.sh N "名稱"
set -euo pipefail
cd "$(dirname "$0")/.."
n="$1"; name="$2"
log=$(mktemp)
if ! bash scripts/gate.sh > "$log" 2>&1; then
  grep -nE "^not ok|# fail [1-9]|failed|有 .* 個情境|Error" "$log" | head -30
  echo "驗證閘門沒過，未 commit（完整紀錄：${log}）"
  exit 1
fi
grep -E "情境對照檢查通過|passed|驗證閘門通過" "$log"
git add -A features app docs scripts prompt-studio
git commit -q -m "步驟 ${n}：${name}

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
git push -q
bash scripts/mark-done.sh "$n"
