const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { loadTemples, toWesternYear, normalizePhone, cleanRecord, parseCsv } = require('../../src/temples/clean');

const CSV = path.join(__dirname, '..', '..', '..', '新北市寺廟資料.csv');
const db = loadTemples(CSV);

test('場景：讀入全部寺廟並排除廢止與未登記後剩 940 間', () => {
  assert.equal(db.all.length, 982);
  assert.equal(db.all.filter(t => t.flags.abolished).length, 41);
  assert.equal(db.all.filter(t => t.flags.unregistered).length, 1);
  assert.equal(db.valid.length, 940);
});

test('場景：民國與民前紀年換算為西元年', () => {
  assert.equal(toWesternYear('民國75'), 1986);
  assert.equal(toWesternYear('民前88'), 1824);
  assert.equal(toWesternYear('民前350'), 1562);
  assert.equal(toWesternYear('民國76年'), 1987);
  assert.equal(toWesternYear('民國77年9月'), 1988);
  const yinshan = db.all.find(t => t.name === '鄞山寺');
  assert.equal(yinshan.builtYear, 1824);
  assert.equal(yinshan.builtRaw, '民前88');
  assert.equal(db.all.find(t => t.name === '慈德廟').builtYear, 1558);
});

test('場景：清代年號換算為西元年', () => {
  assert.equal(toWesternYear('乾隆12'), 1747);
  assert.equal(toWesternYear('光緒3'), 1877);
  assert.equal(toWesternYear('康熙25'), 1686);
  assert.equal(toWesternYear('嘉慶1'), 1796);
  assert.equal(toWesternYear('道光10'), 1830);
  assert.equal(toWesternYear('咸豐3'), 1853);
  assert.equal(toWesternYear('同治2'), 1863);
});

test('場景：無法判斷的紀年留空並保留原始紀年', () => {
  for (const raw of ['日據0', '不詳0', '民前0', '民國0', '康熙0', '', '0', undefined]) {
    assert.equal(toWesternYear(raw), null, `${raw} 應為空值`);
  }
  const t = db.all.find(t => t.builtRaw === '日據0');
  assert.equal(t.builtYear, null);
  assert.equal(t.builtRaw, '日據0');
});

test('場景：電話正規化為含區碼的數字並保留原始值', () => {
  assert.equal(normalizePhone('89915390'), '0289915390');
  assert.equal(normalizePhone('(02)2345-6789'), '0223456789');
  assert.equal(normalizePhone('02 2677 3456'), '0226773456');
  assert.equal(normalizePhone('2985-1038總務 陳秋燕'), '0229851038');
  assert.equal(normalizePhone('26295517轉1234'), '0226295517');
  assert.equal(normalizePhone('0912345678'), '0912345678');
  assert.equal(normalizePhone(''), null);
  const yinshan = db.all.find(t => t.name === '鄞山寺');
  assert.equal(yinshan.phone, '0226295517');
  assert.equal(yinshan.phoneRaw, '26295517');
});

test('場景：里別缺漏時從地址補上', () => {
  const t = cleanRecord({ tep_id: 'X', tep_name: '測試宮', tep_address: '新北市三芝區圓山里二坪頂69號', tep_area: '三芝區', tep_village: '' });
  assert.equal(t.village, '圓山里');
  assert.equal(t.villageFromAddress, true);
  const u = cleanRecord({ tep_id: 'Y', tep_name: '測試宮', tep_address: '新北市新莊區5鄰頭前路15巷1號', tep_area: '新莊區', tep_village: '' });
  assert.equal(u.village, null);
  const w = cleanRecord({ tep_id: 'Z', tep_name: '測試宮', tep_address: '新北市萬里區萬里里1號', tep_area: '萬里區', tep_village: '' });
  assert.equal(w.village, '萬里里');
});

test('場景：標記財團法人與重名的寺廟', () => {
  const t = db.all.find(t => t.name === '財團法人新北市金山慈音寺');
  assert.equal(t.flags.foundation, true);
  assert.equal(t.displayName, '金山慈音寺');
  const fuan = db.all.filter(t => t.displayName === '福安宮');
  assert.ok(fuan.length > 1);
  assert.ok(fuan.every(t => t.flags.duplicateName));
  assert.equal(db.all.find(t => t.name === '鄞山寺').flags.duplicateName, false);
  assert.equal(db.all.find(t => t.name === '萬壽宮(已廢止)').displayName, '萬壽宮');
});

test('場景：祭典日期欄位被移除', () => {
  assert.ok(db.all.every(t => !('festivalDate' in t) && !('tep_festivaldate' in t)));
});

test('CSV 解析支援引號內的逗號與 BOM', () => {
  const rows = parseCsv('﻿a,b\n1,"x, y"\n');
  assert.deepEqual(rows, [{ a: '1', b: 'x, y' }]);
});
