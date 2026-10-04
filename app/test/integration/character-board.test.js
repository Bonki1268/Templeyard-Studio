const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { startApp } = require('../helpers');
const { videoAtStep } = require('./scenario');
const { PRICES } = require('../../src/cost/prices');

test('四格定妝板', async t => {
  const s = await startApp();
  t.after(() => s.close());
  const { ai, config, store } = s.app.ctx;

  await t.test('場景：角色定妝板是一張四格圖', async () => {
    const { base, videoId } = await videoAtStep(s, 5, { characters: [] });
    const before = ai.calls.filter(c => c.kind === 'image').length;
    const r = await s.post(`${base}/characters/generate`, {});
    const c = r.data.video.characters[0];
    assert.deepEqual(Object.keys(c.versions[0].images), ['board']);
    const calls = ai.calls.filter(x => x.kind === 'image').slice(before);
    assert.equal(calls.length, 1);
    const prompt = [calls[0].request.system, calls[0].request.messages[0].content].join('\n');
    for (const word of ['2×2', '正面', '不要頭', '側面', '背面', '頭部特寫']) assert.ok(prompt.includes(word), `指令缺少「${word}」`);
    const gens = (await s.get(`/api/generations?videoId=${videoId}`)).data.generations.filter(g => g.promptId === 'character-sheet');
    assert.equal(gens.length, 1);
    assert.equal(gens[0].view, 'board');
  });

  await t.test('場景：產生定妝板的預估費用以一張圖計算', async () => {
    const { base, series } = await videoAtStep(s, 5, { characters: [] });
    assert.equal((await s.get(`${base}/estimate/characters`)).data.estimate, PRICES.image.perImage);
    assert.equal((await s.get(`/api/series/${series.id}/estimate/characters`)).data.sheet, PRICES.image.perImage);
  });

  await t.test('場景：精緻圖以鎖定版本的定妝板作為角色參考', async () => {
    const { base, videoId } = await videoAtStep(s, 6);
    const before = ai.calls.length;
    await s.post(`${base}/frames/generate`, {});
    await s.app.ctx.jobs.idle();
    const ch = store.get('videos', videoId).characters[0];
    const board = path.join(config.mediaDir, ch.versions.find(x => x.version === ch.lockedVersion).images.board.file);
    const calls = ai.calls.slice(before).filter(c => c.request?.promptId === 'refined-frame');
    assert.ok(calls.length > 0);
    assert.ok(calls.every(c => c.refs.includes(board)));
  });

  await t.test('場景：舊版分開產生的定裝圖仍可作為參考', async () => {
    const { base, videoId } = await videoAtStep(s, 6);
    // 把鎖定版本改成舊格式（front/side/back/costume 四張分開的圖）。
    const legacy = store.update('videos', videoId, v => {
      const ver = v.characters[0].versions.find(x => x.version === v.characters[0].lockedVersion);
      const file = ver.images.board.file;
      ver.images = { front: { file }, side: { file }, back: { file }, costume: { file } };
    }).characters[0];
    const costume = path.join(config.mediaDir, legacy.versions[0].images.costume.file);
    const before = ai.calls.length;
    await s.post(`${base}/frames/generate`, {});
    await s.app.ctx.jobs.idle();
    const calls = ai.calls.slice(before).filter(c => c.request?.promptId === 'refined-frame');
    assert.ok(calls.length > 0);
    assert.ok(calls.every(c => c.refs.includes(costume)));
  });
});
