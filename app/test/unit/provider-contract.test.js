// AI 服務的介面契約：任何真實服務（Higgsfield、文字模型）接入前，都要讓這組測試通過。
// 目前只有假實作；接入真實服務時，在 IMPLEMENTATIONS 加上以假 fetch 建立的實作即可。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { createFakeProviders } = require('../../src/ai/fake');
const { createPromptService } = require('../../src/prompts');
const { tempDir } = require('../helpers');

const IMPLEMENTATIONS = {
  fake: () => createFakeProviders({ mediaDir: tempDir(), output: { width: 320, height: 180, fps: 24 } }),
};
const prompts = createPromptService();

for (const [name, create] of Object.entries(IMPLEMENTATIONS)) {
  test(`場景：每個 AI 服務實作都提供五種生成介面（${name}）`, () => {
    const ai = create();
    assert.equal(typeof ai.name, 'string');
    for (const kind of ['text', 'image', 'video', 'voice', 'music']) assert.equal(typeof ai.models[kind], 'string', kind);
    assert.equal(typeof ai.text.generate, 'function');
    assert.equal(typeof ai.image.generate, 'function');
    assert.equal(typeof ai.video.generate, 'function');
    assert.equal(typeof ai.voice.synthesize, 'function');
    assert.equal(typeof ai.music.track, 'function');
  });

  test(`場景：文字生成回傳可解析的 JSON（${name}）`, async () => {
    const ai = create();
    const variables = { temple: { name: '鄞山寺' }, series: { style: '寫實', duration: 15 }, story: '渡海來台的故事。', shotCount: 5 };
    const out = await ai.text.generate({ request: await prompts.render('story-script', variables), variables });
    assert.equal(typeof out.json, 'object');
    assert.ok(Array.isArray(out.json.shots));
    assert.equal(typeof out.model, 'string');
  });

  test(`場景：圖片與影片生成回傳本機檔案路徑（${name}）`, async () => {
    const ai = create();
    const vars = { shot: { index: 1, scene: '廟宇', action: '走進廟埕', seconds: 1 }, series: { style: '寫實' } };
    const image = await ai.image.generate({ request: await prompts.render('storyboard-image', vars), refs: [] });
    assert.ok(fs.existsSync(image.file));
    assert.equal(typeof image.model, 'string');
    const clip = await ai.video.generate({ request: await prompts.render('shot-video', vars), firstFrame: image.file, seconds: 1 });
    assert.ok(fs.existsSync(clip.file));
    assert.equal(typeof clip.model, 'string');
  });
}
