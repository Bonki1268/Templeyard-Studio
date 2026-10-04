// 語音合成的測試：say 以假的執行函式代替、Azure 以假的 fetch 代替，不連網、不花錢。
// 只有「在本機實際以 say 產生」一項在 macOS 上真的呼叫 say（免費、本機）。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createSayVoice, createAzureVoice, SAY_NARRATOR } = require('../../src/ai/voice');
const { createProviders } = require('../../src/ai');
const { probe } = require('../../src/media/ffmpeg');
const { tempDir } = require('../helpers');

// 假的 say：記下參數，在 -o 指定的位置寫一個檔案。
function fakeSay() {
  const calls = [];
  const run = async (cmd, args) => {
    calls.push({ cmd, args });
    fs.writeFileSync(args[args.indexOf('-o') + 1], 'RIFF');
  };
  const voiceOf = i => calls[i].args[calls[i].args.indexOf('-v') + 1];
  return { calls, run, voiceOf };
}

test('場景：以 macOS 內建台灣中文語音合成旁白', async () => {
  const say = fakeSay();
  const voice = createSayVoice({ mediaDir: tempDir(), run: say.run });
  const out = await voice.synthesize({ text: '來淡水，讀懂這座廟。', speaker: '旁白' });
  const { cmd, args } = say.calls[0];
  assert.equal(cmd, 'say');
  assert.equal(say.voiceOf(0), 'Meijia');
  assert.equal(SAY_NARRATOR, 'Meijia');
  assert.deepEqual(args.slice(args.indexOf('--file-format=WAVE'), args.indexOf('--file-format=WAVE') + 2), ['--file-format=WAVE', '--data-format=LEI16@44100']);
  assert.equal(args.at(-1), '來淡水，讀懂這座廟。');
  assert.match(out.file, /\.wav$/);
  assert.ok(fs.existsSync(out.file));
  assert.equal(out.cost, 0);
  assert.equal(out.model, 'macos-say:Meijia');
});

test('場景：每個角色固定使用同一個聲音', async () => {
  const say = fakeSay();
  const voice = createSayVoice({ mediaDir: tempDir(), run: say.run });
  await voice.synthesize({ text: '這座廟有兩百年了。', speaker: '阿明' });
  await voice.synthesize({ text: '我們進去看看。', speaker: '阿明' });
  await voice.synthesize({ text: '小心門檻。', speaker: '阿嬤' });
  await voice.synthesize({ text: '旁白的話。', speaker: '' });
  assert.equal(say.voiceOf(0), say.voiceOf(1));
  for (const i of [0, 2]) assert.notEqual(say.voiceOf(i), SAY_NARRATOR);
  assert.equal(say.voiceOf(3), SAY_NARRATOR);
});

test('場景：相同台詞與聲音不重複合成', async () => {
  const say = fakeSay();
  const voice = createSayVoice({ mediaDir: tempDir(), run: say.run });
  const a = await voice.synthesize({ text: '歡迎來到廟埕。', speaker: '旁白' });
  const b = await voice.synthesize({ text: '歡迎來到廟埕。', speaker: '旁白' });
  assert.equal(say.calls.length, 1);
  assert.equal(a.file, b.file);

  let posts = 0;
  const fetchImpl = async () => { posts += 1; return new Response(Buffer.from('RIFF'), { status: 200 }); };
  const azure = createAzureVoice({ key: 'k', region: 'eastasia', mediaDir: tempDir(), fetchImpl });
  await azure.synthesize({ text: '歡迎', speaker: '旁白' });
  const again = await azure.synthesize({ text: '歡迎', speaker: '旁白' });
  assert.equal(posts, 1);
  assert.equal(again.cost, 0);
});

test('場景：以 Azure 台灣中文神經語音合成台詞', async () => {
  const calls = [];
  const fetchImpl = async (url, init) => { calls.push({ url: String(url), ...init }); return new Response(Buffer.from('RIFFwave'), { status: 200 }); };
  const voice = createAzureVoice({ key: 'secret-key', region: 'eastasia', mediaDir: tempDir(), fetchImpl });
  const text = '香火 & 信仰 <永續>';
  const out = await voice.synthesize({ text, speaker: '旁白' });
  const c = calls[0];
  assert.equal(c.url, 'https://eastasia.tts.speech.microsoft.com/cognitiveservices/v1');
  assert.equal(c.method, 'POST');
  assert.equal(c.headers['Ocp-Apim-Subscription-Key'], 'secret-key');
  assert.equal(c.headers['Content-Type'], 'application/ssml+xml');
  assert.equal(c.headers['X-Microsoft-OutputFormat'], 'riff-44100hz-16bit-mono-pcm');
  assert.match(c.body, /xml:lang=['"]zh-TW['"]/);
  assert.match(c.body, /name=['"]zh-TW-HsiaoChenNeural['"]/);
  assert.match(c.body, /香火 &amp; 信仰 &lt;永續&gt;/);
  assert.equal(fs.readFileSync(out.file, 'utf8'), 'RIFFwave');
  assert.equal(out.model, 'azure-tts:zh-TW-HsiaoChenNeural');
  assert.equal(out.cost, +(text.length * 15 / 1e6).toFixed(6));

  await voice.synthesize({ text: '我們進去看看。', speaker: '阿明' });
  assert.doesNotMatch(calls[1].body, /HsiaoChen/);
  assert.match(calls[1].body, /zh-TW-\w+Neural/);
});

test('場景：Azure 金鑰錯誤或服務失敗時回報錯誤', async () => {
  const failWith = status => createAzureVoice({ key: 'k', region: 'eastasia', mediaDir: tempDir(), fetchImpl: async () => new Response('err', { status }) });
  await assert.rejects(failWith(401).synthesize({ text: '一', speaker: '旁白' }), /金鑰/);
  await assert.rejects(failWith(500).synthesize({ text: '二', speaker: '旁白' }), /語音合成失敗.*500/);
});

test('場景：real 模式依設定選擇語音合成服務', () => {
  const hf = { HF_API_KEY_ID: 'a', HF_API_KEY_SECRET: 'b' };
  const anthropicClient = { beta: { messages: { create: async () => ({}) } } };
  const make = (env, platform) => createProviders({ aiProvider: 'real', mediaDir: tempDir(), env: { ...hf, ...env }, anthropicClient, platform });
  assert.equal(make({}, 'darwin').models.voice, 'macos-say');
  assert.equal(make({}, 'linux').models.voice, 'fake-voice');
  assert.equal(make({ TTS_PROVIDER: 'local' }, 'darwin').models.voice, 'fake-voice');
  assert.equal(make({ TTS_PROVIDER: 'azure', AZURE_SPEECH_KEY: 'k', AZURE_SPEECH_REGION: 'eastasia' }, 'darwin').models.voice, 'azure-tts');
  assert.throws(() => make({ TTS_PROVIDER: 'azure' }, 'darwin'), /AZURE_SPEECH_KEY.*AZURE_SPEECH_REGION/);
  assert.throws(() => make({ TTS_PROVIDER: 'robot' }, 'darwin'), /TTS_PROVIDER/);
});

test('場景：在本機實際以 say 產生可播放的中文語音', { skip: process.platform !== 'darwin' && '只在 macOS 上執行' }, async () => {
  const voice = createSayVoice({ mediaDir: tempDir() });
  const out = await voice.synthesize({ text: '來淡水，讀懂這座廟。', speaker: '旁白' });
  const info = await probe(out.file);
  assert.ok(info.hasAudio);
  assert.ok(info.duration > 0.5);
  assert.equal(path.extname(out.file), '.wav');
});

test('場景：指定的聲音不在目前的語音服務時改用自動分配', async () => {
  const say = fakeSay();
  const voice = createSayVoice({ mediaDir: tempDir(), run: say.run });
  assert.ok(voice.voices.length >= 5);
  for (const v of voice.voices) assert.ok(v.id && v.label, '每個聲音要有代號與中文說明');
  const chosen = voice.voices.find(v => v.id !== SAY_NARRATOR).id;
  await voice.synthesize({ text: '我們進去看看。', speaker: '阿明', voice: chosen });
  assert.equal(say.voiceOf(0), chosen);
  await voice.synthesize({ text: '小心門檻。', speaker: '阿明', voice: 'zh-TW-YunJheNeural' });
  await voice.synthesize({ text: '小心門檻！', speaker: '阿明' });
  assert.equal(say.voiceOf(1), say.voiceOf(2), '不認得的聲音改用依名字自動分配');

  const calls = [];
  const azure = createAzureVoice({ key: 'k', region: 'eastasia', mediaDir: tempDir(), fetchImpl: async (url, init) => { calls.push(init); return new Response(Buffer.from('RIFF'), { status: 200 }); } });
  assert.deepEqual(azure.voices.map(v => v.id).sort(), ['zh-TW-HsiaoChenNeural', 'zh-TW-HsiaoYuNeural', 'zh-TW-YunJheNeural']);
  await azure.synthesize({ text: '一', speaker: '阿明', voice: 'zh-TW-YunJheNeural' });
  assert.match(calls[0].body, /zh-TW-YunJheNeural/);
  await azure.synthesize({ text: '二', speaker: '阿明', voice: SAY_NARRATOR });
  assert.match(calls[1].body, /zh-TW-\w+Neural/, '不認得的聲音改用依名字自動分配');
  assert.doesNotMatch(calls[1].body, /Meijia/);
});
