const test = require('node:test');
const assert = require('node:assert/strict');
const { startApp } = require('../helpers');

const valid = {
  name: '淡水廟宇故事', style: '溫暖寫實・黃昏自然光', styleNote: '淺景深、柔和逆光',
  duration: 30, direction: '在地歷史故事',
};

test('系列專案 API', async t => {
  let tick = 0;
  const s = await startApp({ clock: () => new Date(Date.UTC(2026, 9, 4, 8, 0, tick++)) });
  t.after(() => s.close());

  await t.test('場景：建立系列專案', async () => {
    const r = await s.post('/api/series', valid);
    assert.equal(r.status, 201);
    const sr = r.data.series;
    assert.ok(sr.id);
    assert.equal(sr.name, '淡水廟宇故事');
    assert.equal(sr.duration, 30);
    assert.deepEqual(sr.output, { aspectRatio: '16:9', width: 1920, height: 1080, fps: 24 });
    assert.equal(sr.costCap, 20);
    assert.deepEqual(sr.characters, []);
  });

  await t.test('場景：建立系列時可以先描述共同角色', async () => {
    const r = await s.post('/api/series', { ...valid, characters: [{ name: '導覽員小晴', description: '30 歲左右女性，及肩黑髮' }] });
    const c = r.data.series.characters;
    assert.equal(c.length, 1);
    assert.equal(c[0].name, '導覽員小晴');
    assert.equal(c[0].description, '30 歲左右女性，及肩黑髮');
    assert.ok(c[0].id);
    assert.equal(c[0].lockedVersion, null);
    assert.deepEqual(c[0].versions, []);
  });

  await t.test('場景：系列設定不完整時拒絕建立', async () => {
    const a = await s.post('/api/series', { ...valid, name: ' ' });
    assert.equal(a.status, 422);
    assert.ok(a.data.error.details.some(d => d.field === 'name'));
    const b = await s.post('/api/series', { ...valid, duration: 45 });
    assert.equal(b.status, 422);
    assert.ok(b.data.error.details.some(d => d.field === 'duration'));
    const c = await s.post('/api/series', { ...valid, style: '' });
    assert.ok(c.data.error.details.some(d => d.field === 'style'));
  });

  await t.test('場景：首頁列出已建立的系列', async () => {
    const r = await s.get('/api/series');
    assert.equal(r.status, 200);
    assert.equal(r.data.series.length, 2);
    assert.ok(r.data.series[0].updatedAt >= r.data.series[1].updatedAt);
    assert.equal(r.data.series[0].videoCount, 0);
  });

  await t.test('場景：修改系列設定並保留舊版', async () => {
    const id = (await s.post('/api/series', valid)).data.series.id;
    const r = await s.put(`/api/series/${id}`, { duration: 20 });
    assert.equal(r.status, 200);
    assert.equal(r.data.series.duration, 20);
    assert.equal(r.data.series.name, '淡水廟宇故事');
    const hist = await s.get(`/api/series/${id}/history`);
    assert.equal(hist.data.history[0].duration, 30);
    const bad = await s.put(`/api/series/${id}`, { duration: 0 });
    assert.equal(bad.status, 422);
    assert.equal((await s.get('/api/series/none')).status, 404);
  });

  await t.test('場景：之後再加入系列角色', async () => {
    const id = (await s.post('/api/series', valid)).data.series.id;
    const r = await s.post(`/api/series/${id}/characters`, { name: '廟埕的老伯', description: '70 歲左右男性' });
    assert.equal(r.status, 201);
    const got = await s.get(`/api/series/${id}`);
    assert.deepEqual(got.data.series.characters.map(c => c.name), ['廟埕的老伯']);
    assert.deepEqual(got.data.videos, []);
  });
});
