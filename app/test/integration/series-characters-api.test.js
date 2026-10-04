const test = require('node:test');
const assert = require('node:assert/strict');
const { startApp } = require('../helpers');
const { videoAtStep } = require('./scenario');
const { PRICES } = require('../../src/cost/prices');

const valid = { name: '淡水廟宇故事', style: '溫暖寫實・黃昏自然光', duration: 30, direction: '在地歷史故事' };

test('系列角色新增與 AI 輔助 API', async t => {
  const s = await startApp();
  t.after(() => s.close());
  const patch = (url, body) => s.request('PATCH', url, body);
  const series = (await s.post('/api/series', valid)).data.series;
  const base = `/api/series/${series.id}`;
  let character;

  await t.test('場景：以構想請 AI 撰寫系列角色的外觀描述', async () => {
    const r = await s.post(`${base}/characters/draft`, { name: '廟公阿伯', idea: '在廟口顧了四十年的老廟公' });
    assert.equal(r.status, 200);
    assert.equal(r.data.draft.name, '廟公阿伯');
    assert.ok(r.data.draft.description.length > 0);
    const gen = (await s.get(`/api/generations?seriesId=${series.id}`)).data.generations;
    assert.equal(gen.length, 1);
    assert.equal(gen[0].promptId, 'character-design');
    assert.equal(gen[0].seriesId, series.id);
    assert.equal(gen[0].id, r.data.generationId);
    assert.equal(gen[0].input.idea, '在廟口顧了四十年的老廟公');
    assert.deepEqual((await s.get(base)).data.series.characters, []);
  });

  await t.test('場景：沒有構想也沒有名稱時不能請 AI 撰寫', async () => {
    const r = await s.post(`${base}/characters/draft`, { name: ' ', idea: '' });
    assert.equal(r.status, 422);
    assert.ok(r.data.error.details.some(d => d.field === 'idea'));
  });

  await t.test('場景：產生系列角色定裝圖前先看到預估費用', async () => {
    const r = await s.get(`${base}/estimate/characters`);
    assert.equal(r.status, 200);
    assert.equal(r.data.draft, PRICES.text.perCall);
    assert.equal(r.data.sheet, +(4 * PRICES.image.perImage).toFixed(4));
  });

  await t.test('場景：在系列頁為角色產生三視圖與定裝圖', async () => {
    character = (await s.post(`${base}/characters`, { name: '廟公阿伯', description: '70 歲左右男性，灰白短髮，穿灰色唐裝' })).data.character;
    const r = await s.post(`${base}/characters/${character.id}/generate`, {});
    assert.equal(r.status, 200);
    const c = r.data.character;
    assert.equal(c.versions.length, 1);
    assert.equal(c.selectedVersion, 1);
    assert.equal(c.lockedVersion, null);
    const images = c.versions[0].images;
    for (const view of ['front', 'side', 'back', 'costume']) assert.ok(images[view].url, `缺少 ${view}`);
    assert.equal(new Set(Object.values(images).map(i => i.file)).size, 4);
    const sheets = (await s.get(`/api/generations?seriesId=${series.id}`)).data.generations.filter(g => g.promptId === 'character-sheet');
    assert.equal(sheets.length, 4);
    assert.ok(sheets.every(g => g.seriesId === series.id && g.characterId === character.id));
    const cost = (await s.get(`${base}/cost`)).data.cost;
    assert.equal(cost.spent, +(PRICES.text.perCall + 4 * PRICES.image.perImage).toFixed(4));
    assert.equal(cost.cap, series.costCap);
  });

  await t.test('場景：依指令重新產生系列角色並保留舊版本', async () => {
    const r = await s.post(`${base}/characters/${character.id}/generate`, { instruction: '換成深藍色唐裝' });
    const c = r.data.character;
    assert.equal(c.versions.length, 2);
    assert.equal(c.selectedVersion, 2);
    assert.equal(c.versions[1].instruction, '換成深藍色唐裝');
    assert.notEqual(c.versions[1].images.costume.file, c.versions[0].images.costume.file);
  });

  await t.test('場景：鎖定系列角色的定裝版本', async () => {
    const r = await patch(`${base}/characters/${character.id}`, { lockedVersion: 1 });
    assert.equal(r.status, 200);
    assert.equal(r.data.character.lockedVersion, 1);
    const stored = (await s.get(base)).data.series.characters.find(c => c.id === character.id);
    assert.equal(stored.lockedVersion, 1);
    const bad = await patch(`${base}/characters/${character.id}`, { lockedVersion: 9 });
    assert.equal(bad.status, 422);
    assert.equal((await patch(`${base}/characters/nope`, { lockedVersion: 1 })).status, 404);
  });
});

test('系列頁鎖定的角色由之後的影片沿用', async t => {
  const s = await startApp();
  t.after(() => s.close());

  await t.test('場景：之後新增的影片直接沿用系列頁鎖定的角色', async () => {
    const first = await videoAtStep(s, 2);
    const sbase = `/api/series/${first.series.id}`;
    const cid = first.series.characters[0].id;
    await s.post(`${sbase}/characters/${cid}/generate`, {});
    await s.request('PATCH', `${sbase}/characters/${cid}`, { lockedVersion: 1 });
    const locked = (await s.get(sbase)).data.series.characters[0].versions[0];

    const video = (await s.post(`${sbase}/videos`, {})).data.video;
    assert.equal(video.series.characters[0].lockedVersion, 1);
    const base = `/api/videos/${video.id}`;
    const templeId = (await s.get(`/api/temples?q=${encodeURIComponent('鄞山寺')}`)).data.items[0].id;
    await s.put(`${base}/temple`, { templeId });
    const { makeImage } = require('../fixtures');
    const img = await makeImage();
    await s.request('POST', `${base}/photos`, img.buffer, { 'Content-Type': 'image/jpeg', 'X-Filename': encodeURIComponent('廟宇.jpg') });
    await s.put(`${base}/story`, { text: '小晴想把這座廟的故事說給第一次來淡水的人聽。' });
    await s.post(`${base}/steps/2/confirm`);
    await s.post(`${base}/script/generate`, {});
    await s.post(`${base}/steps/3/confirm`);
    assert.equal((await s.get(`${base}/estimate/characters`)).data.newCharacters, 0);
    const r = await s.post(`${base}/characters/generate`, {});
    const c = r.data.video.characters.find(x => x.name === '導覽員小晴');
    assert.equal(c.reused, true);
    assert.equal(c.versions[0].images.costume.file, locked.images.costume.file);
    const gens = (await s.get(`/api/generations?videoId=${video.id}`)).data.generations.filter(g => g.promptId === 'character-sheet');
    assert.equal(gens.length, 0);
  });
});
