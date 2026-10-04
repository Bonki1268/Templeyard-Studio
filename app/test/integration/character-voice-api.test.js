// 角色語音：角色庫為系列角色選擇語音合成的聲音、試聽，合成成品時沿用。全程使用假的語音服務。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { startApp } = require('../helpers');
const { videoAtStep } = require('./scenario');

const valid = { name: '淡水廟宇故事', style: '溫暖寫實・黃昏自然光', duration: 30, direction: '在地歷史故事' };

test('角色語音 API', async t => {
  const s = await startApp();
  t.after(() => s.close());
  const { ai, config } = s.app.ctx;
  let voices;

  await t.test('場景：列出目前語音服務可選的聲音', async () => {
    const r = await s.get('/api/voices');
    assert.equal(r.status, 200);
    assert.equal(r.data.provider, ai.models.voice);
    voices = r.data.voices;
    assert.ok(voices.length >= 2);
    for (const v of voices) assert.ok(v.id && v.label);
  });

  await t.test('場景：為系列角色指定語音', async () => {
    const series = (await s.post('/api/series', { ...valid, characters: [{ name: '導覽員小晴' }] })).data.series;
    const url = `/api/series/${series.id}/characters/${series.characters[0].id}`;
    const r = await s.request('PATCH', url, { voice: voices[1].id });
    assert.equal(r.status, 200);
    assert.equal(r.data.character.voice, voices[1].id);
    assert.equal((await s.get(`/api/series/${series.id}`)).data.series.characters[0].voice, voices[1].id);
    assert.equal((await s.request('PATCH', url, { voice: '' })).data.character.voice, '');
    const bad = await s.request('PATCH', url, { voice: '不存在的聲音' });
    assert.equal(bad.status, 422);
    assert.equal(bad.data.error.code, 'invalid_voice');
  });

  await t.test('場景：試聽角色語音', async () => {
    const series = (await s.post('/api/series', { ...valid, characters: [{ name: '導覽員小晴' }] })).data.series;
    const cid = series.characters[0].id;
    const r = await s.post(`/api/series/${series.id}/characters/${cid}/voice-preview`, { voice: voices[1].id });
    assert.equal(r.status, 200, JSON.stringify(r.data));
    const call = ai.calls.filter(c => c.kind === 'voice').at(-1);
    assert.equal(call.voice, voices[1].id);
    assert.match(call.text, /導覽員小晴/);
    assert.ok(r.data.preview.url);
    assert.ok(fs.existsSync(path.join(config.mediaDir, r.data.preview.file)));
    const audio = await fetch(s.base + r.data.preview.url);
    assert.equal(audio.status, 200);
    const cost = (await s.get(`/api/series/${series.id}/cost`)).data.cost;
    assert.ok(cost.spent > 0, JSON.stringify(cost));
  });

  await t.test('場景：合成時角色台詞使用角色庫指定的語音', async () => {
    const { series, base, video } = await videoAtStep(s, 7);
    const main = series.characters[0];
    await s.request('PATCH', `/api/series/${series.id}/characters/${main.id}`, { voice: voices[1].id });
    await s.post(`${base}/clips/generate`, { consent: true });
    await s.app.ctx.jobs.idle();
    await s.put(`${base}/audio`, { voiceMode: 'tts' });
    const before = ai.calls.length;
    const r = await s.post(`${base}/compose`, { consent: true });
    assert.equal(r.status, 202, JSON.stringify(r.data));
    await s.app.ctx.jobs.idle();
    assert.equal((await s.get(base)).data.video.final?.status, 'done');
    const calls = ai.calls.slice(before).filter(c => c.kind === 'voice');
    const mine = calls.filter(c => c.speaker === main.name);
    const narration = calls.filter(c => c.speaker === '旁白');
    assert.ok(mine.length > 0, '腳本要有角色台詞');
    assert.ok(narration.length > 0, '腳本要有旁白');
    for (const c of mine) assert.equal(c.voice, voices[1].id);
    for (const c of narration) assert.ok(!c.voice, '旁白不受角色語音影響');
    assert.ok(video.script.shots.length > 0);
  });
});
