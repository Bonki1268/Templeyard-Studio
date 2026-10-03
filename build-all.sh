#!/usr/bin/env bash
# 一鍵開發：在新的分支上啟動 Claude Code，依規格書以 BDD + TDD 開發到完成。
# 用法：bash build-all.sh          （沒列在允許清單的操作會問你，最安全）
#       bash build-all.sh --auto   （略過所有權限詢問，只建議在這個專案的獨立副本執行）
set -euo pipefail
cd "$(dirname "$0")"

command -v claude >/dev/null || { echo "找不到 claude 指令，請先安裝 Claude Code。"; exit 1; }
git rev-parse --is-inside-work-tree >/dev/null 2>&1 || { echo "這個資料夾還不是 git 專案。"; exit 1; }

# 第一次執行：把 autodev/claude/ 的設定裝進 .claude/（已存在的檔案不覆蓋），並 commit
if [ -d autodev/claude ]; then
  mkdir -p .claude/commands .claude/hooks
  cp -n autodev/claude/commands/build-all.md .claude/commands/ 2>/dev/null || true
  cp -n autodev/claude/hooks/continue-until-done.sh .claude/hooks/ 2>/dev/null || true
  cp -n autodev/claude/settings.json .claude/ 2>/dev/null || true
  chmod +x .claude/hooks/continue-until-done.sh scripts/gate.sh build-all.sh
  git add CLAUDE.md build-all.sh scripts/gate.sh autodev .claude/commands .claude/hooks/continue-until-done.sh .claude/settings.json .gitignore
  if ! git diff --cached --quiet; then
    git commit -m "加入一鍵開發設定（BDD + TDD 自動開發）"
    echo "已安裝並 commit 一鍵開發設定"
  fi
fi

# 其他檔案必須都已 commit
if [ -n "$(git status --porcelain)" ]; then
  echo "有未 commit 的修改，請先 commit 或 stash："; git status --short; exit 1
fi

# 在新的分支上開發，不動主分支
branch="autodev/$(date +%Y%m%d-%H%M)"
git checkout -b "$branch"
echo "在分支 $branch 上開發"

# 不讓付費服務的金鑰進入這次執行，避免測試真的花錢
unset HIGGSFIELD_API_KEY HIGGSFIELD_API_SECRET ANTHROPIC_API_KEY OPENAI_API_KEY 2>/dev/null || true
rm -f .claude/STOP .claude/hooks/.nudges

if [ "${1:-}" = "--auto" ]; then
  claude --dangerously-skip-permissions "/build-all"
else
  claude --permission-mode acceptEdits "/build-all"
fi
