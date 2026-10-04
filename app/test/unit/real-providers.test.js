// 真實服務轉接層的測試：注入假的 Claude 用戶端與假的 fetch，不連網、不花錢。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createClaudeText, strictSchema } = require('../../src/ai/claude');
const { createHiggsfieldMedia } = require('../../src/ai/higgsfield');
const { createProviders } = require('../../src/ai');
const { createPromptService } = require('../../src/prompts');
const { encodePng } = require('../../src/media/png');
const { tempDir } = require('../helpers');

const prompts = createPromptService();
const scriptVars = { temple: { name: '鄞山寺' }, series: { style: '寫實', duration: 15 }, story: '渡海來台的故事。', shotCount: 5 };

function fakeAnthropic(response) {
  const calls = [];
  const create = async params => { calls.push(params); return typeof response === 'function' ? response(params) : response; };
  return { calls, client: { beta: { messages: { create } } } };
}

const okMessage = json => ({
  model: 'claude-opus-5-5', stop_reason: 'end_turn',
  content: [{ type: 'thinking', thinking: '' }, { type: 'text', text: JSON.stringify(json) }],
  usage: { input_tokens: 1000, output_tokens: 500 },
});

test('場景：Claude 依指令檔的輸出格式回傳結構化 JSON', async () => {
  const { calls, client } = fakeAnthropic(okMessage({ title: 'T', adCopy: 'A', characters: [], shots: [{ index: 1 }] }));
  const text = createClaudeText({ client });
  const request = await prompts.render('story-script', scriptVars);
  const out = await text.generate({ request, variables: scriptVars });
  const p = calls[0];
  assert.equal(p.model, 'claude-opus-5-5');
  assert.equal(p.system, request.system);
  assert.equal(p.messages[0].content, request.messages[0].content);
  assert.equal(p.output_config.format.type, 'json_schema');
  assert.equal(p.output_config.format.schema.additionalProperties, false);
  assert.equal(p.output_config.format.schema.properties.shots.items.additionalProperties, false);
  assert.ok(p.output_config.effort);
  assert.equal(p.fallbacks, 'default');
  assert.deepEqual(p.betas, ['server-side-fallback-2026-07-01']);
  assert.equal(out.json.title, 'T');
  assert.equal(out.model, 'claude-opus-5-5');
  assert.equal(out.cost, +(1000 * 4 / 1e6 + 500 * 20 / 1e6).toFixed(4));
});

test('strictSchema 為每個物件加上 additionalProperties: false 並移除不支援的限制', () => {
  const s = strictSchema({ type: 'object', properties: { n: { type: 'integer', minimum: 1 }, a: { type: 'array', items: { type: 'object', properties: {} }, minItems: 1 } } });
  assert.equal(s.additionalProperties, false);
  assert.equal(s.properties.a.items.additionalProperties, false);
  assert.ok(!('minimum' in s.properties.n));
  assert.ok(!('minItems' in s.properties.a));
});

test('場景：Claude 拒絕或輸出被截斷時回報錯誤', async () => {
  const request = await prompts.render('story-script', scriptVars);
  const refused = createClaudeText({ client: fakeAnthropic({ stop_reason: 'refusal', stop_details: { category: 'cyber' }, content: [], usage: {} }).client });
  await assert.rejects(refused.generate({ request }), /拒絕/);
  const cut = createClaudeText({ client: fakeAnthropic({ stop_reason: 'max_tokens', content: [{ type: 'text', text: '{"a":' }], usage: {} }).client });
  await assert.rejects(cut.generate({ request }), /截斷/);
});

// 假的 Higgsfield：記下每個請求，依路徑回應。
function fakeHiggsfield({ final = 'completed', kind = 'image' } = {}) {
  const calls = [];
  let polls = 0;
  const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
  const fetchImpl = async (url, init = {}) => {
    const u = String(url);
    calls.push({ url: u, method: init.method || 'GET', headers: init.headers || {}, body: init.body });
    if (u.endsWith('/files/generate-upload-url')) {
      const n = calls.filter(c => c.url.endsWith('/files/generate-upload-url')).length;
      return json({ public_url: `https://cdn.test/in-${n}.png`, upload_url: `https://storage.test/put-${n}`, content_type: 'image/png', upload_headers: { 'Content-Type': 'image/png', 'x-amz-tagging': 'retention=temporary' } });
    }
    if (u.startsWith('https://storage.test/')) return new Response(null, { status: 200 });
    if (u.includes('/estimate/')) return json({ credits: '1.000', usd: '0.062' });
    if (u.includes('/requests/') && u.endsWith('/status')) {
      polls += 1;
      if (polls < 2) return json({ status: 'in_progress', request_id: 'r1' });
      if (final !== 'completed') return json({ status: final, request_id: 'r1', error: final === 'failed' ? 'Generation failed' : null });
      return json(kind === 'image'
        ? { status: 'completed', request_id: 'r1', images: [{ url: 'https://cdn.test/out.png' }] }
        : { status: 'completed', request_id: 'r1', video: { url: 'https://cdn.test/out.mp4' } });
    }
    if (u.startsWith('https://cdn.test/out')) return new Response(Buffer.from('MEDIA'), { status: 200 });
    if (u.startsWith('https://api.higgsfield.ai/')) {
      return json({ status: 'queued', request_id: 'r1', status_url: 'https://api.higgsfield.ai/requests/r1/status', cancel_url: 'https://api.higgsfield.ai/requests/r1/cancel' });
    }
    throw new Error(`unexpected ${u}`);
  };
  return { calls, fetchImpl };
}

function refFile(dir, name, color = [200, 100, 50]) {
  const file = path.join(dir, name);
  fs.writeFileSync(file, encodePng(16, 9, () => color));
  return file;
}

const creds = { keyId: 'id', keySecret: 'secret' };
const fast = { pollIntervalMs: 1, maxPollIntervalMs: 2 };

test('場景：Higgsfield 先上傳參考圖再生成圖片並下載結果', async () => {
  const dir = tempDir();
  const { calls, fetchImpl } = fakeHiggsfield();
  const media = createHiggsfieldMedia({ ...creds, ...fast, fetchImpl, mediaDir: dir, output: { width: 1920, height: 1080, fps: 24 } });
  const vars = { shot: { index: 1, scene: '廟宇', action: '走進廟埕' }, character: { reference: '小晴' }, photo: { description: '廟宇正面' }, series: { style: '寫實' } };
  const request = await prompts.render('refined-frame', vars);
  const refs = [refFile(dir, 'photo.png'), refFile(dir, 'costume.png', [10, 20, 30])];
  const out = await media.image.generate({ request, refs });
  assert.equal(calls.filter(c => c.url.endsWith('/files/generate-upload-url')).length, 2);
  const puts = calls.filter(c => c.url.startsWith('https://storage.test/'));
  assert.equal(puts.length, 2);
  assert.ok(puts.every(c => c.method === 'PUT' && !c.headers.Authorization), '不可把金鑰送到儲存網址');
  const submit = calls.find(c => c.url === 'https://api.higgsfield.ai/xai/grok-imagine-image-2.0');
  assert.equal(submit.headers.Authorization, 'Key id:secret');
  assert.ok(submit.headers['Idempotency-Key']);
  const body = JSON.parse(submit.body);
  assert.deepEqual(body.image_urls, ['https://cdn.test/in-1.png', 'https://cdn.test/in-2.png']);
  assert.equal(body.aspect_ratio, '16:9');
  assert.match(body.prompt, /走進廟埕/);
  assert.equal(fs.readFileSync(out.file, 'utf8'), 'MEDIA');
  assert.ok(out.file.startsWith(path.join(dir, 'gen')));
  assert.equal(out.model, 'xai/grok-imagine-image-2.0');
  assert.equal(out.cost, 0.062);
  // 同一個參考圖不重複上傳
  await media.image.generate({ request, refs });
  assert.equal(calls.filter(c => c.url.endsWith('/files/generate-upload-url')).length, 2);
});

test('場景：Higgsfield 以精緻圖為首格生成 Seedance 影片', async () => {
  const dir = tempDir();
  const { calls, fetchImpl } = fakeHiggsfield({ kind: 'video' });
  const media = createHiggsfieldMedia({ ...creds, ...fast, fetchImpl, mediaDir: dir, output: { width: 1920, height: 1080, fps: 24 } });
  const request = await prompts.render('shot-video', { shot: { index: 1, seconds: 2.5, action: '回頭看向鏡頭', line: '這座廟有故事', speaker: '小晴' } }, { model: 'seedance-2.0' });
  const frame = refFile(dir, 'frame.png');
  const out = await media.video.generate({ request, firstFrame: frame, lastFrame: frame, seconds: 2.5, nativeVoice: true });
  const submit = calls.find(c => c.url === 'https://api.higgsfield.ai/bytedance/seedance-2.0/image-to-video');
  const body = JSON.parse(submit.body);
  assert.equal(body.image_url, 'https://cdn.test/in-1.png');
  assert.equal(body.end_image_url, 'https://cdn.test/in-1.png');
  assert.equal(body.duration, 4);
  assert.equal(body.generate_audio, true);
  assert.equal(body.resolution, '1080p');
  assert.match(body.prompt, /Seedance 寫法/);
  assert.ok(out.file.endsWith('.mp4'));
  assert.equal(out.hasVoice, true);
});

test('場景：Higgsfield 生成失敗或被內容審核拒絕時回報錯誤', async () => {
  const request = await prompts.render('storyboard-image', { shot: { index: 1, scene: '廟宇', action: '走' } });
  for (const [final, pattern] of [['failed', /生成失敗/], ['nsfw', /內容審核/]]) {
    const { fetchImpl } = fakeHiggsfield({ final });
    const media = createHiggsfieldMedia({ ...creds, ...fast, fetchImpl, mediaDir: tempDir() });
    await assert.rejects(media.image.generate({ request, refs: [] }), pattern);
  }
  const noCredit = createHiggsfieldMedia({ ...creds, ...fast, mediaDir: tempDir(),
    fetchImpl: async u => (String(u).includes('/estimate/') ? new Response('{"usd":"0.1"}') : new Response(JSON.stringify({ detail: 'Insufficient credits' }), { status: 403 })) });
  await assert.rejects(noCredit.image.generate({ request, refs: [] }), /點數不足/);
});

test('場景：未設定金鑰時無法以真實服務啟動', () => {
  assert.throws(() => createProviders({ aiProvider: 'real', mediaDir: tempDir(), env: {} }), /HF_API_KEY_ID.*HF_API_KEY_SECRET/);
  const ai = createProviders({ aiProvider: 'real', mediaDir: tempDir(), env: { HF_API_KEY_ID: 'a', HF_API_KEY_SECRET: 'b' }, anthropicClient: fakeAnthropic(okMessage({})).client });
  assert.equal(ai.name, 'real');
  assert.equal(ai.models.text, 'claude-opus-5-5');
  assert.equal(ai.models.video, 'bytedance/seedance-2.0/image-to-video');
  assert.equal(ai.ruleModels.video, 'seedance-2.0');
});

test('場景：Seedance 估價只回傳計價說明時依 token 公式計算實際費用', async () => {
  const dir = tempDir();
  const { fetchImpl: base } = fakeHiggsfield({ kind: 'video' });
  const description = 'Token-metered pricing. Billable video tokens = ceil(generated video seconds × output width × output height × 24 fps / 1024). Per 1,000 video tokens: 480p/720p/1080p $0.014, 4K $0.008.';
  const fetchImpl = async (url, init) => (String(url).includes('/estimate/')
    ? new Response(JSON.stringify({ type: 'description', pricing_description: description }), { status: 200 })
    : base(url, init));
  const media = createHiggsfieldMedia({ ...creds, ...fast, fetchImpl, mediaDir: dir, output: { width: 1920, height: 1080, fps: 24 } });
  const request = await prompts.render('shot-video', { shot: { index: 1, seconds: 3, action: '走' } });
  const out = await media.video.generate({ request, firstFrame: refFile(dir, 'f.png'), seconds: 3 });
  assert.equal(out.cost, +(Math.ceil(4 * 1920 * 1080 * 24 / 1024) * 0.014 / 1000).toFixed(4));
});

test('場景：分鏡影片以 720p 生成以節省費用，成品仍輸出 1920×1080', async () => {
  const dir = tempDir();
  const { calls, fetchImpl } = fakeHiggsfield({ kind: 'video' });
  const ai = createProviders({ aiProvider: 'real', mediaDir: dir, output: { width: 1920, height: 1080, fps: 24 }, videoHeight: 720,
    env: { HF_API_KEY_ID: 'a', HF_API_KEY_SECRET: 'b' }, anthropicClient: fakeAnthropic(okMessage({})).client, fetchImpl, pollIntervalMs: 1 });
  const request = await prompts.render('shot-video', { shot: { index: 1, seconds: 3, action: '走' } });
  await ai.video.generate({ request, firstFrame: refFile(dir, 'f.png'), seconds: 3 });
  const body = JSON.parse(calls.find(c => c.url.endsWith('/image-to-video')).body);
  assert.equal(body.resolution, '720p');
});
