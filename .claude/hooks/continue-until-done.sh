#!/usr/bin/env bash
# Stop hook：Claude 想結束時檢查進度，還有未完成的步驟就要求它繼續。
# 為了避免無限循環，最多催促 MAX_NUDGES 次（可用環境變數覆寫）。
set -u
cd "${CLAUDE_PROJECT_DIR:-$(pwd)}" || exit 0

MAX_NUDGES="${AUTODEV_MAX_NUDGES:-60}"
COUNTER=".claude/hooks/.nudges"
PROGRESS="docs/PROGRESS.md"

# 讀掉 hook 傳入的 JSON（目前不需要用到內容）
cat > /dev/null

# 手動停止：建立 .claude/STOP 檔案即可讓它結束
if [ -f ".claude/STOP" ]; then
  rm -f "$COUNTER"
  exit 0
fi

count=$(cat "$COUNTER" 2>/dev/null || echo 0)
if [ "$count" -ge "$MAX_NUDGES" ]; then
  echo "已催促 $MAX_NUDGES 次，自動停止。" >&2
  rm -f "$COUNTER"
  exit 0
fi

if [ ! -f "$PROGRESS" ]; then
  echo $((count + 1)) > "$COUNTER"
  echo "還沒有 docs/PROGRESS.md：請完成 /build-all 的第 0 階段（規劃），然後接著開發。" >&2
  exit 2
fi

remaining=$(grep -cE '^[[:space:]]*- \[ \]' "$PROGRESS" || true)
if [ "$remaining" -gt 0 ]; then
  next=$(grep -m1 -E '^[[:space:]]*- \[ \]' "$PROGRESS" | sed -E 's/^[[:space:]]*- \[ \] //')
  echo $((count + 1)) > "$COUNTER"
  echo "docs/PROGRESS.md 還有 $remaining 個未完成步驟。請繼續下一步：$next（依 CLAUDE.md 的 BDD + TDD 流程與驗證閘門）。" >&2
  exit 2
fi

# 全部完成或只剩等待決定的步驟
rm -f "$COUNTER"
exit 0
