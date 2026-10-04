const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createPromptService, PROMPT_DIR } = require('../../src/prompts');
const { tempDir } = require('../helpers');

const vars = {
  temple: { name: '鄞山寺', district: '淡水區', deity: '定光古佛', builtYear: 1824 },
  series: { style: '溫暖寫實', direction: '在地歷史故事', duration: 30 },
  story: '老一輩說，當年移民渡海來台，帶著定光古佛的香火在淡水落腳。',
  shotCount: 8,
};

// 用複本測試模型專用規則，不改到真正的 prompts/
function copyPrompts() {
  const dir = tempDir('prompts-');
  for (const f of fs.readdirSync(PROMPT_DIR).filter(f => f.endsWith('.json'))) fs.copyFileSync(path.join(PROMPT_DIR, f), path.join(dir, f));
  return dir;
}

const load = id => JSON.parse(fs.readFileSync(path.join(PROMPT_DIR, `${id}.json`), 'utf8'));
const ALL = ['copy-polish', 'story-script', 'storyboard-image', 'character-sheet', 'refined-frame', 'shot-video'];

test('場景：以 prompt-studio 的指令檔組出送給 AI 的內容', async () => {
  const prompts = createPromptService();
  const request = await prompts.render('story-script', vars);
  assert.equal(request.promptId, 'story-script');
  assert.equal(request.promptVersion, load('story-script').version);
  assert.match(request.messages[0].content, /鄞山寺（淡水區/);
  assert.match(request.messages[0].content, /30 秒/);
  assert.doesNotMatch(request.messages[0].content + request.system, /\{\{/);
  assert.equal(request.output.format, 'json');
});

test('場景：缺少必要變數時拒絕組裝', async () => {
  const prompts = createPromptService();
  await assert.rejects(prompts.render('story-script', { ...vars, story: '' }), err => {
    assert.equal(err.code, 'missing_variables');
    assert.ok(err.extra.missing.includes('story'));
    return true;
  });
});

test('場景：指定模型時加入該模型專用的寫法規則', async () => {
  const dir = copyPrompts();
  const prompts = createPromptService({ promptDir: dir });
  const p = JSON.parse(fs.readFileSync(path.join(dir, 'shot-video.json'), 'utf8'));
  assert.ok(p.modelRules['seedance-2.0'], '分鏡影片應有 Seedance 規則');
  const shotVars = { shot: { index: 1, seconds: 3, action: '走進廟埕', camera: '緩慢推近' }, series: { style: '寫實' } };
  const plain = await prompts.render('shot-video', shotVars);
  assert.ok(!plain.system.includes(p.modelRules['seedance-2.0']));
  const seedance = await prompts.render('shot-video', shotVars, { model: 'seedance-2.0' });
  assert.ok(seedance.system.includes(p.modelRules['seedance-2.0']));
  assert.ok(!seedance.system.includes(p.modelRules['kling-2.1']));
  assert.equal(seedance.target.model, 'seedance-2.0');
});

test('場景：透過 Prompt Studio API 組裝的結果與內建組裝相同', async t => {
  process.env.PROMPT_DIR = PROMPT_DIR;
  const { server } = require('../../../prompt-studio/server');
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  t.after(() => server.close());
  const url = `http://127.0.0.1:${server.address().port}`;
  const local = await createPromptService().render('story-script', vars);
  const remote = await createPromptService({ studioUrl: url }).render('story-script', vars);
  assert.deepEqual(remote, local);
  await assert.rejects(createPromptService({ studioUrl: url }).render('story-script', {}), err => err.code === 'missing_variables');
});

test('場景：圖片與影片節點的畫面比例都是 16:9', () => {
  for (const id of ['storyboard-image', 'character-sheet', 'refined-frame', 'shot-video']) {
    const p = load(id);
    assert.equal(p.target.aspectRatio, '16:9', id);
    assert.doesNotMatch(p.system + p.template, /9:16|vertical|直式/i, id);
  }
  assert.doesNotMatch(load('story-script').template, /直式/);
});

test('場景：腳本指令要求輸出完整的分鏡欄位', () => {
  const schema = load('story-script').output.schema;
  const shot = schema.properties.shots.items;
  for (const k of ['scene', 'photoIndex', 'shotSize', 'composition', 'camera', 'transition', 'intent', 'narrativeRole', 'action', 'line', 'speaker', 'subtitle', 'seconds']) {
    assert.ok(shot.properties[k], `缺少分鏡欄位 ${k}`);
  }
  assert.ok(schema.properties.characters, '腳本應列出需要的角色');
  assert.ok(schema.properties.adCopy, '腳本應包含廣告腳本全文');
});

test('場景：所有指令的 system 都包含內容與宗教規則', () => {
  for (const id of ALL) {
    const sys = load(id).system;
    assert.match(sys, /只使用.*寺廟資料.*使用者/, id);
    assert.match(sys, /不得對神明不敬/, id);
    assert.match(sys, /可辨識的真實民眾/, id);
  }
});

test('場景：指令檔更新後版本加一並保留舊版', () => {
  for (const id of ALL) {
    const p = load(id);
    assert.ok(p.version > 1, id);
    assert.ok(fs.existsSync(path.join(PROMPT_DIR, '.history', id, `v${p.version - 1}.json`)), id);
  }
});
