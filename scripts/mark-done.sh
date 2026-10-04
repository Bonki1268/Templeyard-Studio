#!/usr/bin/env bash
# 把 docs/PROGRESS.md 中的「步驟 N」打勾並記下目前 HEAD 的 commit 雜湊。
# 用法：bash scripts/mark-done.sh N
set -euo pipefail
cd "$(dirname "$0")/.."
n="$1"
hash=$(git rev-parse --short HEAD)
node -e '
const fs = require("fs"); const [n, hash] = process.argv.slice(1);
const file = "docs/PROGRESS.md";
const lines = fs.readFileSync(file, "utf8").split("\n");
const i = lines.findIndex(l => new RegExp("^- \\[[ ~x]\\] 步驟 " + n + "：").test(l));
if (i < 0) { console.error("找不到步驟 " + n); process.exit(1); }
lines[i] = lines[i].replace(/^- \[[ ~x]\]/, "- [x]").replace(/（commit [0-9a-f]+）$/, "") + "（commit " + hash + "）";
fs.writeFileSync(file, lines.join("\n"));
console.log(lines[i]);
' "$n" "$hash"
