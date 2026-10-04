const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const { startApp } = require('../helpers');
const { videoAtStep } = require('./scenario');
const { probe, ffmpeg } = require('../../src/media/ffmpeg');
const { tempDir } = require('../helpers');

async function withClips(s, opts) {
  const ctx = await videoAtStep(s, 7, opts);
  await s.post(`${ctx.base}/clips/generate`, { consent: true });
  await s.app.ctx.jobs.idle();
  return ctx;
}

async function compose(s, base) {
  const r = await s.post(`${base}/compose`, { consent: true });
  assert.equal(r.status, 202, JSON.stringify(r.data));
  await s.app.ctx.jobs.idle();
  const v = (await s.get(base)).data.video;
  assert.equal(v.final?.status, 'done', v.final?.error);
  return v;
}

test('成品合成（測試尺寸）', async t => {
  const s = await startApp();
  t.after(() => s.close());
  const { base, videoId } = await withClips(s);
  const { ai, config } = s.app.ctx;
  let v;

  await t.test('場景：合成成品：串接分鏡、配音、背景音樂與燒錄字幕', async () => {
    v = await compose(s, base);
    const info = await probe(path.join(config.mediaDir, v.final.file));
    assert.ok(info.hasVideo && info.hasAudio);
    assert.ok(Math.abs(info.duration - 30) < 0.2, `長度 ${info.duration}`);
    assert.equal(info.width, 320);
    assert.ok(v.final.subtitles, '應燒錄字幕');
    assert.equal(v.final.stale, false);
    assert.ok(ai.calls.some(c => c.kind === 'music'));
  });

  await t.test('場景：角色台詞使用模型原生語音，旁白使用語音合成', async () => {
    const voiceCalls = ai.calls.filter(c => c.kind === 'voice');
    const narration = v.script.shots.filter(x => x.line && x.speaker === '旁白');
    assert.equal(voiceCalls.length, narration.length);
    assert.deepEqual(voiceCalls.map(c => c.text).sort(), narration.map(x => x.line).sort());
  });

  await t.test('場景：分鏡或聲音設定變更後需要重新合成', async () => {
    const r = await s.put(`${base}/audio`, { music: 'temple-drums' });
    assert.equal(r.data.video.final.stale, true);
    const c = await s.post(`${base}/steps/7/confirm`);
    assert.equal(c.status, 422);
    assert.ok(c.data.error.unmet.some(u => /重新合成/.test(u)));
  });

  await t.test('場景：選擇語音合成時所有台詞都用語音合成', async () => {
    await s.put(`${base}/audio`, { voiceMode: 'tts' });
    const before = ai.calls.filter(c => c.kind === 'voice').length;
    v = await compose(s, base);
    const after = ai.calls.filter(c => c.kind === 'voice').slice(before);
    assert.equal(after.length, v.script.shots.filter(x => x.line).length);
    assert.equal(v.finals.length, 1, '舊成品保留在歷史');
  });

  await t.test('場景：可以上傳自己的背景音樂', async () => {
    const dir = tempDir();
    const music = path.join(dir, 'bgm.m4a');
    await ffmpeg(['-f', 'lavfi', '-i', 'sine=frequency=220:duration=40', '-c:a', 'aac', music]);
    const up = await s.request('POST', `${base}/music`, fs.readFileSync(music), { 'Content-Type': 'audio/mp4', 'X-Filename': 'bgm.m4a' });
    assert.equal(up.status, 201);
    assert.equal(up.data.video.audio.music, up.data.track.id);
    const tracks = (await s.get(`${base}/music`)).data.tracks;
    assert.ok(tracks.some(x => x.id === up.data.track.id && x.uploaded));
    const before = ai.calls.filter(c => c.kind === 'music').length;
    v = await compose(s, base);
    assert.equal(ai.calls.filter(c => c.kind === 'music').length, before, '上傳的音樂不需呼叫音樂服務');
    assert.equal(v.final.music, up.data.track.id);
  });

  await t.test('場景：記錄成品檢查結果', async () => {
    const quality = { face: true, lipsync: true, subtitles: true, duration: true };
    const r = await s.request('PATCH', `${base}/final`, { quality });
    assert.deepEqual(r.data.video.final.quality, quality);
  });

  await t.test('場景：確認成品前不能下載', async () => {
    const r = await s.get(`${base}/download`);
    assert.equal(r.status, 409);
    assert.match(r.data.error.message, /先確認成品/);
  });

  await t.test('場景：確認成品後可以下載 MP4', async () => {
    const c = await s.post(`${base}/steps/7/confirm`);
    assert.equal(c.status, 200);
    assert.equal(c.data.video.status, 'done');
    const r = await s.get(`${base}/download`);
    assert.equal(r.status, 200);
    assert.match(r.headers.get('content-type'), /video\/mp4/);
    assert.match(decodeURIComponent(r.headers.get('content-disposition')), new RegExp(`${c.data.video.title}\\.mp4`));
    const file = path.join(tempDir(), 'out.mp4');
    fs.writeFileSync(file, r.data);
    const info = await probe(file);
    assert.ok(info.hasVideo && info.duration > 29);
    assert.equal((await s.get('/api/series')).data.series[0].videoCount, 1);
    assert.ok(videoId);
  });
});

test('場景：成品符合輸出規格 1920×1080、24 fps、30 秒以內', async t => {
  const s = await startApp({ output: { width: 1920, height: 1080, fps: 24 } });
  t.after(() => s.close());
  const { base } = await withClips(s, { duration: 6 });
  const v = await compose(s, base);
  const info = await probe(path.join(s.app.ctx.config.mediaDir, v.final.file));
  assert.equal(info.width, 1920);
  assert.equal(info.height, 1080);
  assert.equal(info.fps, 24);
  assert.equal(info.videoCodec, 'h264');
  assert.equal(info.audioCodec, 'aac');
  assert.ok(info.duration <= 30);
  assert.ok(Math.abs(info.duration - 6) < 0.2);
});
