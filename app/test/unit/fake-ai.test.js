const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createFakeProviders } = require('../../src/ai/fake');
const { createProviders } = require('../../src/ai');
const { createPromptService } = require('../../src/prompts');
const { probe } = require('../../src/media/ffmpeg');
const { pngSize } = require('../../src/media/png');
const { tempDir } = require('../helpers');

const prompts = createPromptService();
const baseVars = {
  temple: { name: '鄞山寺', district: '淡水區', deity: '定光古佛', builtYear: 1824 },
  series: { style: '溫暖寫實', direction: '在地歷史故事', duration: 30 },
  story: '老一輩說，當年移民渡海來台，帶著定光古佛的香火在淡水落腳。後來才有了這座廟。',
};

test('場景：預設使用不花錢的假實作', async () => {
  const original = global.fetch;
  global.fetch = () => { throw new Error('不應該連網'); };
  try {
    const ai = createProviders({ aiProvider: undefined, mediaDir: tempDir() });
    assert.equal(ai.name, 'fake');
    const request = await prompts.render('copy-polish', baseVars);
    const out = await ai.text.generate({ request, variables: baseVars });
    assert.ok(out.json.polished);
  } finally {
    global.fetch = original;
  }
});

test('場景：不認得的 AI 服務設定會被拒絕', () => {
  assert.throws(() => createProviders({ aiProvider: 'nope', mediaDir: tempDir() }), /fake/);
});

test('場景：假實作的文字結果固定', async () => {
  const ai = createFakeProviders({ mediaDir: tempDir() });
  const request = await prompts.render('copy-polish', baseVars);
  const a = await ai.text.generate({ request, variables: baseVars });
  const b = await ai.text.generate({ request, variables: baseVars });
  assert.deepEqual(a.json, b.json);
  const vars2 = { ...baseVars, instruction: '語氣再口語一點' };
  const c = await ai.text.generate({ request: await prompts.render('copy-polish', vars2), variables: vars2 });
  assert.notEqual(c.json.polished, a.json.polished);
  assert.match(a.json.polished, /定光古佛/);
});

test('場景：假實作產生的腳本秒數加總等於系列秒數', async () => {
  const ai = createFakeProviders({ mediaDir: tempDir() });
  const vars = { ...baseVars, shotCount: 8, photos: '1. 廟宇正面；2. 廟埕石獅', photoCount: 2, characterList: [{ name: '導覽員小晴', description: '30 歲女性' }] };
  const out = await ai.text.generate({ request: await prompts.render('story-script', vars), variables: vars });
  const { shots, characters, adCopy } = out.json;
  assert.equal(shots.length, 8);
  assert.equal(shots.reduce((s, x) => s + x.seconds, 0), 30);
  assert.ok(adCopy.length > 10);
  assert.equal(characters[0].name, '導覽員小晴');
  for (const s of shots) {
    for (const k of ['scene', 'shotSize', 'composition', 'camera', 'transition', 'intent', 'narrativeRole', 'action', 'line', 'speaker', 'subtitle']) {
      assert.ok(s[k], `第 ${s.index} 格缺少 ${k}`);
    }
    assert.ok(s.seconds >= 2 && s.seconds <= 4);
    assert.ok(s.photoIndex >= 1 && s.photoIndex <= 2);
  }
  assert.deepEqual(new Set(shots.map(s => s.shotSize)), new Set(['遠景', '中景', '特寫']));
});

test('場景：假實作產生的圖片是 16:9 的 PNG 且結果固定', async () => {
  const ai = createFakeProviders({ mediaDir: tempDir() });
  const vars = { shot: { index: 1, scene: '廟宇正面', action: '小晴走進廟埕' }, series: { style: '寫實' } };
  const request = await prompts.render('storyboard-image', vars);
  const a = await ai.image.generate({ request, variables: vars });
  const b = await ai.image.generate({ request, variables: vars });
  const size = pngSize(fs.readFileSync(a.file));
  assert.equal(size.width / size.height, 16 / 9);
  assert.deepEqual(fs.readFileSync(a.file), fs.readFileSync(b.file));
});

test('場景：假實作以首格圖片產生指定秒數的影片', async () => {
  const dir = tempDir();
  const ai = createFakeProviders({ mediaDir: dir, output: { width: 320, height: 180, fps: 24 } });
  const vars = { shot: { index: 1, scene: '廟宇正面', action: '走進廟埕' }, series: { style: '寫實' } };
  const frame = await ai.image.generate({ request: await prompts.render('storyboard-image', vars), variables: vars });
  const request = await prompts.render('shot-video', { shot: { index: 1, seconds: 2, action: '走進廟埕', line: '這座廟有故事', speaker: '小晴' } });
  const out = await ai.video.generate({ request, firstFrame: frame.file, seconds: 2, nativeVoice: true });
  const info = await probe(out.file);
  assert.equal(info.width, 320);
  assert.equal(info.height, 180);
  assert.equal(info.fps, 24);
  assert.ok(Math.abs(info.duration - 2) < 0.1, `長度 ${info.duration}`);
  assert.equal(info.hasAudio, true);
  assert.ok(path.isAbsolute(out.file));
});
