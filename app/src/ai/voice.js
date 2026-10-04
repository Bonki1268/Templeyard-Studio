// 語音合成（旁白與選「語音合成」的台詞）：
//   say：macOS 內建台灣中文語音，免費、本機（real 模式在 macOS 上的預設）
//   azure：Azure 語音服務台灣中文神經語音，付費，需 AZURE_SPEECH_KEY、AZURE_SPEECH_REGION
// 旁白固定一個聲音；角色可在角色庫指定聲音（voice），沒指定或不是這個服務的聲音時依名字固定分配。
// 相同聲音與台詞只合成一次，之後沿用檔案（不重複付費）。
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { exec } = require('../media/ffmpeg');

const hash = v => crypto.createHash('sha256').update(JSON.stringify(v)).digest('hex');
const isNarrator = speaker => !speaker || speaker === '旁白';
function pickVoice({ speaker, voice }, narrator, pool, voices) {
  if (voice && voices.some(v => v.id === voice)) return voice;
  return isNarrator(speaker) ? narrator : pool[parseInt(hash(speaker).slice(0, 8), 16) % pool.length];
}

const SAY_NARRATOR = 'Meijia';
const SAY_CHARACTERS = ['Eddy', 'Flo', 'Reed', 'Sandy', 'Shelley', 'Grandpa', 'Grandma', 'Rocko'].map(n => `${n} (中文（台灣）)`);
const SAY_LABELS = { Meijia: '美佳・女聲（旁白預設）', Eddy: 'Eddy・男聲', Flo: 'Flo・女聲', Reed: 'Reed・男聲', Sandy: 'Sandy・女聲', Shelley: 'Shelley・女聲', Grandpa: 'Grandpa・男聲・長者', Grandma: 'Grandma・女聲・長者', Rocko: 'Rocko・男聲' };
const SAY_VOICES = [SAY_NARRATOR, ...SAY_CHARACTERS].map(id => ({ id, label: SAY_LABELS[id.split(' ')[0]] }));

const AZURE_NARRATOR = 'zh-TW-HsiaoChenNeural';
const AZURE_CHARACTERS = ['zh-TW-YunJheNeural', 'zh-TW-HsiaoYuNeural'];
const AZURE_VOICES = [
  { id: AZURE_NARRATOR, label: '曉臻・女聲（旁白預設）' },
  { id: 'zh-TW-HsiaoYuNeural', label: '曉雨・女聲' },
  { id: 'zh-TW-YunJheNeural', label: '雲哲・男聲' },
];
const AZURE_USD_PER_CHAR = 15 / 1e6; // 神經語音每百萬字約 US$15

function cached(mediaDir, prefix, key) {
  const dir = path.join(mediaDir, 'gen');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${prefix}-${hash(key).slice(0, 16)}.wav`);
  return { file, exists: fs.existsSync(file) };
}

function createSayVoice({ mediaDir, run = exec }) {
  return {
    model: 'macos-say',
    voices: SAY_VOICES,
    async synthesize({ text, speaker = '', voice: chosen }) {
      const voice = pickVoice({ speaker, voice: chosen }, SAY_NARRATOR, SAY_CHARACTERS, SAY_VOICES);
      const { file, exists } = cached(mediaDir, 'say', [voice, text]);
      if (!exists) await run('say', ['-v', voice, '--file-format=WAVE', '--data-format=LEI16@44100', '-o', file, String(text)]);
      return { file, model: `macos-say:${voice.split(' ')[0]}`, cost: 0 };
    },
  };
}

const escapeXml = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c]);

function createAzureVoice({ key, region, mediaDir, fetchImpl = fetch }) {
  return {
    model: 'azure-tts',
    voices: AZURE_VOICES,
    async synthesize({ text, speaker = '', voice: chosen }) {
      const voice = pickVoice({ speaker, voice: chosen }, AZURE_NARRATOR, AZURE_CHARACTERS, AZURE_VOICES);
      const model = `azure-tts:${voice}`;
      const { file, exists } = cached(mediaDir, 'azure', [voice, text]);
      if (exists) return { file, model, cost: 0 };
      const res = await fetchImpl(`https://${region}.tts.speech.microsoft.com/cognitiveservices/v1`, {
        method: 'POST',
        headers: {
          'Ocp-Apim-Subscription-Key': key,
          'Content-Type': 'application/ssml+xml',
          'X-Microsoft-OutputFormat': 'riff-44100hz-16bit-mono-pcm',
          'User-Agent': 'templeyard-studio',
        },
        body: `<speak version='1.0' xml:lang='zh-TW'><voice name='${voice}'>${escapeXml(text)}</voice></speak>`,
      });
      if (res.status === 401 || res.status === 403) throw new Error('Azure 語音金鑰無效，或與 AZURE_SPEECH_REGION 的地區不符');
      if (!res.ok) throw new Error(`Azure 語音合成失敗（${res.status}）：${(await res.text().catch(() => '')).slice(0, 300)}`);
      fs.writeFileSync(file, Buffer.from(await res.arrayBuffer()));
      return { file, model, cost: +(String(text).length * AZURE_USD_PER_CHAR).toFixed(6) };
    },
  };
}

// real 模式的語音合成：TTS_PROVIDER = say | azure | local；未設定時 macOS 用 say，其他系統用本機提示音。
function createRealVoice({ env, platform, mediaDir, fetchImpl, local }) {
  const name = env.TTS_PROVIDER || (platform === 'darwin' ? 'say' : 'local');
  if (name === 'say') return createSayVoice({ mediaDir });
  if (name === 'azure') {
    if (!env.AZURE_SPEECH_KEY || !env.AZURE_SPEECH_REGION) throw new Error('TTS_PROVIDER=azure 需要設定環境變數 AZURE_SPEECH_KEY、AZURE_SPEECH_REGION');
    return createAzureVoice({ key: env.AZURE_SPEECH_KEY, region: env.AZURE_SPEECH_REGION, mediaDir, fetchImpl });
  }
  if (name === 'local') return { model: local.models.voice, ...local.voice };
  throw new Error(`不認得的 TTS_PROVIDER「${name}」，可用的選項：say、azure、local`);
}

module.exports = { createSayVoice, createAzureVoice, createRealVoice, SAY_NARRATOR };
