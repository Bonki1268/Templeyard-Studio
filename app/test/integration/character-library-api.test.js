const test = require('node:test');
const assert = require('node:assert/strict');
const { startApp } = require('../helpers');

const valid = { name: '淡水廟宇故事', style: '溫暖寫實・黃昏自然光', duration: 30, direction: '在地歷史故事' };

test('角色庫 API', async t => {
  const s = await startApp();
  t.after(() => s.close());

  await t.test('場景：刪除系列角色', async () => {
    const series = (await s.post('/api/series', { ...valid, characters: [{ name: '導覽員小晴' }, { name: '廟公阿伯' }] })).data.series;
    const base = `/api/series/${series.id}`;
    const target = series.characters.find(c => c.name === '廟公阿伯');
    const r = await s.del(`${base}/characters/${target.id}`);
    assert.equal(r.status, 200);
    assert.deepEqual(r.data.series.characters.map(c => c.name), ['導覽員小晴']);
    assert.deepEqual((await s.get(base)).data.series.characters.map(c => c.name), ['導覽員小晴']);
    const history = (await s.get(`${base}/history`)).data.history;
    assert.ok(history.some(h => (h.characters || h.data?.characters || []).some(c => c.name === '廟公阿伯')), '刪除前的設定要保存在歷史中');
    assert.equal((await s.del(`${base}/characters/${target.id}`)).status, 404);
  });

  await t.test('場景：刪除系列角色不影響已建立的影片', async () => {
    const series = (await s.post('/api/series', { ...valid, characters: [{ name: '導覽員小晴' }] })).data.series;
    const video = (await s.post(`/api/series/${series.id}/videos`, {})).data.video;
    await s.del(`/api/series/${series.id}/characters/${series.characters[0].id}`);
    const after = (await s.get(`/api/videos/${video.id}`)).data.video;
    assert.deepEqual(after.series.characters.map(c => c.name), ['導覽員小晴']);
  });
});
