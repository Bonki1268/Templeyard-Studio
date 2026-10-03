const test = require('node:test');
const assert = require('node:assert/strict');
const { startApp } = require('../helpers');

test('專案骨架', async t => {
  const s = await startApp();
  t.after(() => s.close());

  await t.test('場景：健康檢查回報服務正常', async () => {
    const r = await s.get('/api/health');
    assert.equal(r.status, 200);
    assert.equal(r.data.ok, true);
    assert.equal(r.data.aiProvider, 'fake');
  });

  await t.test('場景：開啟網站就看到網頁', async () => {
    const r = await s.get('/');
    assert.equal(r.status, 200);
    assert.match(r.headers.get('content-type'), /text\/html/);
    assert.match(r.data.toString('utf8'), /<title>[^<]*廟埕影室/);
  });

  await t.test('場景：不存在的 API 回傳 404', async () => {
    const r = await s.get('/api/不存在');
    assert.equal(r.status, 404);
    assert.equal(r.data.error.code, 'not_found');
  });
});
