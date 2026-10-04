const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { Store } = require('../../src/store/store');
const { tempDir } = require('../helpers');

const fixedClock = () => new Date('2026-10-04T08:00:00Z');

test('場景：新增的資料在重新啟動後仍然存在', () => {
  const dir = tempDir();
  const a = new Store(dir, { clock: fixedClock });
  const doc = a.insert('series', { name: '淡水廟宇故事' });
  assert.ok(doc.id);
  assert.equal(doc.rev, 1);
  assert.equal(doc.createdAt, '2026-10-04T08:00:00.000Z');
  const b = new Store(dir);
  assert.deepEqual(b.get('series', doc.id), doc);
  assert.equal(b.list('series').length, 1);
});

test('場景：寫入不會留下寫到一半的檔案', () => {
  const dir = tempDir();
  const s = new Store(dir);
  for (let i = 0; i < 30; i++) {
    s.insert('videos', { title: `影片 ${i}` });
    JSON.parse(fs.readFileSync(path.join(dir, 'db.json'), 'utf8'));
  }
  assert.deepEqual(fs.readdirSync(dir).filter(n => n.endsWith('.tmp')), []);
});

test('場景：修改資料時舊版本保存在歷史中', () => {
  const s = new Store(tempDir());
  const doc = s.insert('series', { name: 'v1' });
  s.update('series', doc.id, d => { d.name = 'v2'; });
  const v3 = s.update('series', doc.id, { name: 'v3' });
  assert.equal(v3.rev, 3);
  assert.equal(v3.name, 'v3');
  const hist = s.history('series', doc.id);
  assert.deepEqual(hist.map(h => [h.rev, h.name]), [[1, 'v1'], [2, 'v2']]);
  assert.throws(() => s.update('series', 'none', {}), /找不到/);
});

test('場景：讀出的資料是複本', () => {
  const s = new Store(tempDir());
  const doc = s.insert('series', { name: '原名', tags: ['a'] });
  const copy = s.get('series', doc.id);
  copy.name = '改了';
  copy.tags.push('b');
  assert.equal(s.get('series', doc.id).name, '原名');
  assert.deepEqual(s.get('series', doc.id).tags, ['a']);
  assert.equal(s.get('series', 'none'), null);
});

test('list 可用條件篩選', () => {
  const s = new Store(tempDir());
  s.insert('videos', { seriesId: 'a' });
  s.insert('videos', { seriesId: 'b' });
  assert.equal(s.list('videos', v => v.seriesId === 'a').length, 1);
});
