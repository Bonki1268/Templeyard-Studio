// 假的 AI 服務：結果只由輸入決定、不連網、不花錢。
// 文字依 prompt id 產生固定的結構；圖片是由 hash 決定顏色的 PNG；影片、語音、音樂用 ffmpeg 測試訊號源在本機產生。
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { encodePng } = require('../../media/png');
const { ffmpeg } = require('../../media/ffmpeg');

const hash = v => crypto.createHash('sha256').update(typeof v === 'string' ? v : JSON.stringify(v)).digest('hex');
const pick = (list, seed) => list[parseInt(hash(seed).slice(0, 8), 16) % list.length];

function sentencesOf(story) {
  return String(story || '').split(/[。！？!?\n]+/).map(s => s.trim()).filter(Boolean);
}

function fakePolish(v) {
  const parts = sentencesOf(v.story);
  const variant = v.instruction ? parseInt(hash(v.instruction).slice(0, 8), 16) % 3 : 0;
  let polished;
  if (variant === 1) polished = parts.join('，') + '。';
  else if (variant === 2) polished = `在${v.temple?.name || '這座廟'}，${parts.join('。')}。`;
  else polished = parts.join('。') + '。';
  if (v.instruction && polished === parts.join('。') + '。') polished = `${parts.join('；')}。`;
  return { polished, notes: '只改寫語句，沒有加入新的事實。' };
}

function fakeCharacterDesign(v) {
  const name = String(v.character?.name || '').trim() || '在地導覽員';
  const idea = String(v.idea || '').trim() || name;
  const outfit = pick(['米白色棉麻襯衫、深灰長褲', '深藍色唐裝、黑色布鞋', '淺卡其外套、白色上衣'], `${idea}|${v.instruction || ''}`);
  return {
    name,
    description: `${idea}。外觀：五官柔和、髮型整齊，穿${outfit}，配色呼應「${v.series?.style || '系列風格'}」。`,
    notes: '依構想補上可畫的外觀細節，沒有加入新的經歷或事實。',
  };
}

const SIZES = ['遠景', '中景', '特寫', '中景'];
const CAMERAS = ['緩慢推近', '固定鏡頭', '緩慢跟拍', '橫移', '微微上搖'];
const ACTIONS = ['走進廟埕，停下來回頭看向鏡頭', '抬頭看著屋脊上的剪黏', '在石獅旁對著鏡頭說話', '雙手合十向廟內致意', '翻看手機裡的老照片', '望向廟門微笑'];

function fakeScript(v) {
  const duration = Number(v.series?.duration) || 30;
  const n = Math.max(4, Math.min(12, Number(v.shotCount) || Math.round(duration / 3.75)));
  const half = duration * 2;
  const base = Math.floor(half / n);
  const rem = half - base * n;
  const characters = (v.characterList?.length ? v.characterList : [{ name: '導覽員', description: '親切的在地導覽員，20 多歲' }])
    .map(c => ({ name: c.name, description: c.description || '' }));
  const main = characters[0].name;
  const lines = sentencesOf(v.story);
  const photoCount = Number(v.photoCount) || 0;
  const seed = `${v.instruction || ''}|${v.story}`;
  const temple = v.temple?.name || '廟宇';
  const shots = Array.from({ length: n }, (_, i) => {
    const size = i === 0 ? '遠景' : SIZES[i % SIZES.length];
    const role = i === 0 ? '開場' : i === n - 1 ? '收尾' : ['鋪陳', '轉折', '高潮'][Math.min(2, Math.floor(((i - 1) / Math.max(1, n - 2)) * 3))];
    const narration = i % 2 === 1;
    const line = lines.length ? lines[i % lines.length] : `${temple}的故事`;
    return {
      index: i + 1,
      seconds: (base + (i < rem ? 1 : 0)) / 2,
      scene: size === '遠景' ? `${temple}全景` : `${temple}廟埕`,
      ...(photoCount ? { photoIndex: (i % photoCount) + 1 } : {}),
      shotSize: size,
      composition: size === '特寫' ? '主體置中、背景虛化' : '人物位於畫面右三分之一',
      camera: pick(CAMERAS, `${seed}|camera|${i}`),
      transition: i === 0 ? '淡入' : i === n - 1 ? '淡出' : '直接切',
      intent: role === '開場' ? '交代地點與氛圍' : role === '收尾' ? '邀請觀眾來訪' : '推進故事',
      narrativeRole: role,
      action: `${main}${pick(ACTIONS, `${seed}|action|${i}`)}`,
      line,
      speaker: narration ? '旁白' : main,
      subtitle: line,
      characters: [main],
    };
  });
  return {
    title: `${temple}：${lines[0] ? lines[0].slice(0, 12) : '地方故事'}`,
    logline: `${main}在${temple}前，把地方故事說給第一次來的人聽。`,
    adCopy: lines.join('。') + '。',
    characters,
    shots,
  };
}

function createFakeProviders({ mediaDir, output = { width: 1920, height: 1080, fps: 24 } } = {}) {
  const dir = path.join(mediaDir, 'gen');
  fs.mkdirSync(dir, { recursive: true });
  const calls = [];
  const failures = [];
  const record = (kind, args) => {
    calls.push({ kind, ...args });
    const i = failures.findIndex(f => f.kind === kind || f.kind === '*');
    if (i >= 0) { const f = failures.splice(i, 1)[0]; throw new Error(f.message); }
  };

  async function makeVideo(file, { firstFrame, seconds, audio }) {
    const { width, height, fps } = output;
    await ffmpeg([
      '-loop', '1', '-framerate', String(fps), '-i', firstFrame,
      '-f', 'lavfi', '-i', audio,
      '-t', String(seconds), '-vf', `scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height},format=yuv420p`,
      '-r', String(fps), '-c:v', 'libx264', '-preset', 'ultrafast', '-c:a', 'aac', '-ar', '44100', '-shortest', file,
    ]);
  }

  return {
    name: 'fake',
    models: { text: 'fake-text', image: 'fake-image', video: 'fake-video', voice: 'fake-voice', music: 'fake-music' },
    calls,
    failNext(kind, message = '假實作：模擬失敗') { failures.push({ kind, message }); },
    text: {
      async generate({ request, variables = {} }) {
        record('text', { request, variables });
        const json = request.promptId === 'story-script' ? fakeScript(variables)
          : request.promptId === 'copy-polish' ? fakePolish(variables)
          : request.promptId === 'character-design' ? fakeCharacterDesign(variables)
          : { text: request.messages[0].content.slice(0, 200) };
        return { json, text: JSON.stringify(json), model: 'fake-text' };
      },
    },
    image: {
      async generate({ request, refs = [], variant = '' }) {
        record('image', { request, refs, variant });
        const h = hash([request.system, request.messages, refs, variant]);
        const file = path.join(dir, `img-${h.slice(0, 16)}.png`);
        if (!fs.existsSync(file)) {
          const c1 = [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
          const c2 = c1.map(c => Math.min(255, c + 40));
          fs.writeFileSync(file, encodePng(320, 180, (x, y) => (Math.floor((x + y) / 20) % 2 ? c1 : c2)));
        }
        return { file, model: 'fake-image' };
      },
    },
    video: {
      async generate({ request, firstFrame, lastFrame, seconds, nativeVoice = false }) {
        record('video', { request, firstFrame, lastFrame, seconds, nativeVoice });
        const h = hash([request.messages, firstFrame, lastFrame, seconds, nativeVoice, output]);
        const file = path.join(dir, `vid-${h.slice(0, 16)}.mp4`);
        const audio = nativeVoice ? `sine=frequency=${300 + (parseInt(h.slice(0, 2), 16) % 200)}:sample_rate=44100` : 'anullsrc=r=44100:cl=stereo';
        if (!fs.existsSync(file)) await makeVideo(file, { firstFrame, seconds, audio });
        return { file, model: 'fake-video', hasVoice: nativeVoice };
      },
    },
    voice: {
      voices: [{ id: 'fake-a', label: '假聲音 A・女聲' }, { id: 'fake-b', label: '假聲音 B・男聲' }],
      async synthesize({ text, speaker = '', voice = '' }) {
        record('voice', { text, speaker, voice });
        const seconds = Math.max(0.5, Math.min(4, String(text).length * 0.2));
        const h = hash([text, speaker, voice]);
        const file = path.join(dir, `voice-${h.slice(0, 16)}.wav`);
        if (!fs.existsSync(file)) await ffmpeg(['-f', 'lavfi', '-i', `sine=frequency=${500 + (parseInt(h.slice(0, 2), 16) % 300)}:sample_rate=44100:duration=${seconds}`, '-af', 'volume=0.3', file]);
        return { file, seconds, model: 'fake-voice' };
      },
    },
    music: {
      async track(id, seconds) {
        record('music', { id, seconds });
        const h = hash([id, seconds]);
        const file = path.join(dir, `bgm-${h.slice(0, 16)}.m4a`);
        const f1 = 196 + (parseInt(h.slice(0, 2), 16) % 60);
        if (!fs.existsSync(file)) {
          await ffmpeg(['-f', 'lavfi', '-i', `aevalsrc=0.08*sin(2*PI*${f1}*t)+0.06*sin(2*PI*${f1 * 1.5}*t):s=44100:d=${seconds}`, '-c:a', 'aac', file]);
        }
        return { file, model: 'fake-music' };
      },
    },
  };
}

module.exports = { createFakeProviders, fakeScript, fakePolish };
