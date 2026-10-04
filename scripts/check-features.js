#!/usr/bin/env node
// 情境對照檢查：features/*.feature 的每個「場景」都必須有一個測試名稱包含它的標題。
const fs = require('node:fs');
const path = require('node:path');

const SCENARIO = /^\s*(?:場景|劇本|Scenario):\s*(.+?)\s*$/;

function walk(dir, pattern, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, pattern, out);
    else if (pattern.test(entry.name)) out.push(full);
  }
  return out;
}

function checkFeatures({ featureDir, testDirs }) {
  const scenarios = [];
  for (const file of walk(featureDir, /\.feature$/)) {
    fs.readFileSync(file, 'utf8').split('\n').forEach((line, i) => {
      const m = line.match(SCENARIO);
      if (m) scenarios.push({ file: path.basename(file), line: i + 1, scenario: m[1] });
    });
  }
  const testText = testDirs
    .flatMap(dir => walk(dir, /\.(test|spec)\.js$/))
    .map(file => fs.readFileSync(file, 'utf8'))
    .join('\n');
  const missing = scenarios.filter(s => !testText.includes(s.scenario));
  return { ok: missing.length === 0, total: scenarios.length, missing };
}

if (require.main === module) {
  const root = path.join(__dirname, '..');
  const result = checkFeatures({
    featureDir: path.join(root, 'features'),
    testDirs: [path.join(root, 'app', 'test'), path.join(root, 'app', 'e2e')],
  });
  if (!result.ok) {
    console.error(`有 ${result.missing.length} 個情境沒有對應的測試：`);
    for (const m of result.missing) console.error(`  ${m.file}:${m.line}  ${m.scenario}`);
    process.exit(1);
  }
  console.log(`情境對照檢查通過：${result.total} 個情境都有對應的測試`);
}

module.exports = { checkFeatures };
