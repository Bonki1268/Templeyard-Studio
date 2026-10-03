const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { tempDir } = require('../helpers');
const { checkFeatures } = require('../../../scripts/check-features');

function setup(featureText, testText) {
  const root = tempDir();
  fs.mkdirSync(path.join(root, 'features'));
  fs.mkdirSync(path.join(root, 'tests'));
  fs.writeFileSync(path.join(root, 'features', 'a.feature'), featureText);
  fs.writeFileSync(path.join(root, 'tests', 'a.test.js'), testText);
  return { featureDir: path.join(root, 'features'), testDirs: [path.join(root, 'tests')] };
}

const feature = '# language: zh-TW\n功能: 範例\n\n  場景: 搜尋寺廟\n    當 搜尋\n\n  場景: 下載成品\n    當 下載\n';

test('場景：情境找不到對應測試時檢查失敗', () => {
  const dirs = setup(feature, "test('場景：搜尋寺廟', () => {});");
  const result = checkFeatures(dirs);
  assert.equal(result.ok, false);
  assert.deepEqual(result.missing.map(m => m.scenario), ['下載成品']);
});

test('場景：每個情境都有測試時檢查通過', () => {
  const dirs = setup(feature, "test('場景：搜尋寺廟', () => {});\ntest('場景：下載成品', () => {});");
  const result = checkFeatures(dirs);
  assert.equal(result.ok, true);
  assert.equal(result.total, 2);
});
