#!/usr/bin/env bash
# 驗證閘門：跑所有已完成步驟的測試，任何一項失敗就整體失敗。
# 每新增一組測試，就在下面加一行。
set -euo pipefail
cd "$(dirname "$0")/.."

echo "== 情境對照檢查 =="
node scripts/check-features.js

echo "== prompt-studio =="
(cd prompt-studio && npm test)

echo "== app 單元與整合測試 =="
(cd app && npm test)

echo "== 端對端測試 =="
(cd app && npx playwright test)

echo "驗證閘門通過"
