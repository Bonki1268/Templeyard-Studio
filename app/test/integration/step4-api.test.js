const test = require('node:test');
const assert = require('node:assert/strict');
const { startApp } = require('../helpers');
const { videoAtStep } = require('./scenario');
const { PRICES } = require('../../src/cost/prices');

async function toStep4(s, opts) {
  const ctx = await videoAtStep(s, 3, opts);
  await s.post(`${ctx.base}/script/generate`, {});
  await s.post(`${ctx.base}/steps/3/confirm`);
  return ctx;
}

test('步驟 4 API：新角色', async t => {
  const s = await startApp();
  t.after(() => s.close());
  const { base, series, videoId } = await toStep4(s, { characters: [] });
  let character;

  await t.test('場景：產生角色前先看到預估費用', async () => {
    const r = await s.get(`${base}/estimate/characters`);
    assert.equal(r.data.newCharacters, 1);
    assert.equal(r.data.estimate, PRICES.image.perImage);
  });

  await t.test('場景：依腳本找出需要的角色並產生三視圖與定裝圖', async () => {
    const r = await s.post(`${base}/characters/generate`, {});
    assert.equal(r.status, 200);
    const chars = r.data.video.characters;
    assert.deepEqual(chars.map(c => c.name), ['導覽員']);
    character = chars[0];
    assert.equal(character.source, 'video');
    assert.equal(character.selectedVersion, 1);
    const images = character.versions[0].images;
    assert.deepEqual(Object.keys(images), ['board']);
    assert.ok(images.board.url);
    const gens = (await s.get(`/api/generations?videoId=${videoId}`)).data.generations.filter(g => g.promptId === 'character-sheet');
    assert.equal(gens.length, 1);
  });

  await t.test('場景：依指令重新產生角色並保留舊版本', async () => {
    const r = await s.post(`${base}/characters/${character.id}/regenerate`, { instruction: '換成灰色唐裝', description: '70 歲左右男性，灰白短髮' });
    const c = r.data.video.characters[0];
    assert.equal(c.versions.length, 2);
    assert.equal(c.selectedVersion, 2);
    assert.equal(c.description, '70 歲左右男性，灰白短髮');
    assert.equal(c.versions[1].instruction, '換成灰色唐裝');
    assert.notEqual(c.versions[1].images.board.file, c.versions[0].images.board.file);
  });

  await t.test('場景：確認後鎖定角色版本', async () => {
    await s.request('PATCH', `${base}/characters/${character.id}`, { selectedVersion: 1, addToSeries: true });
    const r = await s.post(`${base}/steps/4/confirm`);
    assert.equal(r.status, 200);
    const c = r.data.video.characters[0];
    assert.equal(c.lockedVersion, 1);
    assert.equal(r.data.video.currentStep, 5);
  });

  await t.test('場景：確認時勾選加入系列角色，之後的影片沿用', async () => {
    const sr = (await s.get(`/api/series/${series.id}`)).data.series;
    const sc = sr.characters.find(c => c.name === '導覽員');
    assert.ok(sc, '系列應有「導覽員」');
    assert.equal(sc.lockedVersion, 1);
    assert.ok(sc.versions[0].images.board.url);
    // 同系列第二支影片
    const v2 = (await s.post(`/api/series/${series.id}/videos`, {})).data.video;
    const b2 = `/api/videos/${v2.id}`;
    const templeId = (await s.get(`/api/temples?q=${encodeURIComponent('鄞山寺')}`)).data.items[0].id;
    await s.put(`${b2}/temple`, { templeId });
    const { makeImage } = require('../fixtures');
    await s.request('POST', `${b2}/photos`, (await makeImage()).buffer, { 'Content-Type': 'image/jpeg', 'X-Filename': 'a.jpg' });
    await s.put(`${b2}/story`, { text: '第二間廟的故事。' });
    await s.post(`${b2}/steps/2/confirm`);
    await s.post(`${b2}/script/generate`, {});
    await s.post(`${b2}/steps/3/confirm`);
    assert.equal((await s.get(`${b2}/estimate/characters`)).data.estimate, 0);
    const before = s.app.ctx.ai.calls.filter(c => c.kind === 'image').length;
    const r = await s.post(`${b2}/characters/generate`, {});
    const c = r.data.video.characters[0];
    assert.equal(c.name, '導覽員');
    assert.equal(c.source, 'series');
    assert.equal(c.reused, true);
    assert.equal(c.selectedVersion, 1);
    assert.equal(s.app.ctx.ai.calls.filter(x => x.kind === 'image').length, before, '不應重新產生圖片');
  });
});

test('場景：系列建立時描述的共同角色在第一支影片產生後成為系列定裝版本', async t => {
  const s = await startApp();
  t.after(() => s.close());
  const { base, series } = await toStep4(s);
  const r = await s.post(`${base}/characters/generate`, {});
  const c = r.data.video.characters[0];
  assert.equal(c.name, '導覽員小晴');
  assert.equal(c.source, 'series');
  assert.equal(c.reused, false);
  await s.post(`${base}/steps/4/confirm`);
  const sc = (await s.get(`/api/series/${series.id}`)).data.series.characters[0];
  assert.equal(sc.name, '導覽員小晴');
  assert.equal(sc.lockedVersion, 1);
  assert.equal(sc.versions.length, 1);
});
