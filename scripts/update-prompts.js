#!/usr/bin/env node
// 一次性更新 prompt-studio/prompts/ 的指令檔：改為 16:9、補齊分鏡欄位、統一內容與宗教規則、加入模型專用規則。
// 透過 Prompt Studio 的儲存 API 寫入，所以版本會加一、舊版保存在 prompts/.history/。
// 已更新過（有 16:9 且含規則）的檔案會略過，可以重複執行。
const { server } = require('../prompt-studio/server');

const RULES = '內容與宗教規則：只使用下方提供的寺廟資料與使用者輸入，不可自行補寫歷史年代、人物或傳說；不得對神明不敬，不得出現不敬的動作、台詞或畫面；畫面中不可出現可辨識的真實民眾。';
const v = (name, label, required, example) => ({ name, label, required, example });

const updates = {
  'copy-polish': p => ({
    ...p,
    system: `你是地方觀光文案編輯，擅長把口語的地方故事整理成清楚、有畫面感的繁體中文短文。\n${RULES}`,
    template: '請潤飾以下故事，保留原意與所有事實，不增加新的事實。\n\n寺廟：{{temple.name}}（{{temple.district}}，主祀{{temple.deity}}，創建於{{temple.builtYear}}）\n寺廟歷史與簡介（使用者提供）：{{temple.history}}\n系列風格：{{series.style}}\n影片方向：{{series.direction}}\n字數上限：{{maxChars}} 字\n使用者調整指令：{{instruction}}\n\n使用者故事：\n{{story}}',
    variables: [...p.variables.filter(x => !['temple.history', 'instruction'].includes(x.name)),
      v('temple.history', '寺廟歷史與簡介（使用者貼上）', false, '清道光年間由汀州移民興建。'),
      v('instruction', '使用者調整指令', false, '語氣再口語一點')],
  }),
  'story-script': p => ({
    ...p,
    system: `你是觀光廣告編劇，負責把地方故事寫成 16:9 橫式短影音廣告腳本並拆成分鏡。每個分鏡要能用一張圖與一段短影片呈現；遠景（廟宇全景）、中景（角色與場景）、特寫（臉部、手部、照片與物件）交錯使用。\n${RULES}`,
    template: '請為以下內容寫一支 {{series.duration}} 秒的 16:9 橫式觀光短影音廣告腳本，並拆成 {{shotCount}} 格分鏡。\n\n寺廟：{{temple.name}}（{{temple.district}}，主祀{{temple.deity}}，創建於{{temple.builtYear}}）\n寺廟地址：{{temple.address}}\n寺廟歷史與簡介（使用者提供）：{{temple.history}}\n系列風格：{{series.style}}\n影片方向：{{series.direction}}\n系列共同角色：{{characters}}\n使用者上傳的照片：{{photos}}\n\n故事：\n{{story}}\n\n要求：\n1. 先寫完整的廣告腳本（adCopy），再拆成分鏡（shots）。\n2. 各分鏡秒數加總等於 {{series.duration}} 秒，每格約 2～4 秒。\n3. 每格寫出：場景、對應照片編號（photoIndex，從 1 起算，沒有對應時省略）、景別（遠景／中景／特寫）、構圖、運鏡、轉場、鏡頭意圖、敘事角色（開場／鋪陳／轉折／高潮／收尾）、角色動作、台詞或旁白（line）、說話角色（speaker，旁白填「旁白」）、繁體中文字幕（subtitle）。\n4. 列出腳本需要的角色（characters）；系列共同角色沿用原名稱。\n5. 使用者調整指令：{{instruction}}',
    variables: [...p.variables.filter(x => !['temple.address', 'temple.history', 'shotCount', 'instruction'].includes(x.name)),
      v('temple.address', '寺廟地址', false, '新北市淡水區鄧公里鄧公路15號'),
      v('temple.history', '寺廟歷史與簡介（使用者貼上）', false, '清道光年間由汀州移民興建。'),
      v('shotCount', '分鏡格數', false, '8'),
      v('instruction', '使用者調整指令', false, '開頭節奏再快一點')],
    output: {
      format: 'json',
      schema: {
        type: 'object',
        required: ['title', 'adCopy', 'characters', 'shots'],
        properties: {
          title: { type: 'string' },
          logline: { type: 'string' },
          adCopy: { type: 'string', description: '完整廣告腳本' },
          characters: { type: 'array', items: { type: 'object', required: ['name'], properties: { name: { type: 'string' }, description: { type: 'string' } } } },
          shots: {
            type: 'array',
            items: {
              type: 'object',
              required: ['index', 'seconds', 'scene', 'shotSize', 'action', 'camera', 'subtitle'],
              properties: {
                index: { type: 'integer' },
                seconds: { type: 'number' },
                scene: { type: 'string', description: '場景' },
                photoIndex: { type: 'integer', description: '對應照片編號' },
                shotSize: { type: 'string', enum: ['遠景', '中景', '特寫'], description: '景別' },
                composition: { type: 'string', description: '構圖' },
                camera: { type: 'string', description: '運鏡' },
                transition: { type: 'string', description: '轉場' },
                intent: { type: 'string', description: '鏡頭意圖' },
                narrativeRole: { type: 'string', description: '敘事角色' },
                action: { type: 'string', description: '角色動作' },
                line: { type: 'string', description: '台詞或旁白' },
                speaker: { type: 'string', description: '說話角色' },
                subtitle: { type: 'string', description: '字幕' },
                characters: { type: 'array', items: { type: 'string' } },
              },
            },
          },
        },
      },
    },
  }),
  'storyboard-image': p => ({
    ...p,
    target: { ...p.target, aspectRatio: '16:9' },
    system: `Storyboard sketch, clean line art with light gray tones, cinematic composition, horizontal 16:9 frame. Draw a rough frame for planning, not a final image. No text, no logos.\n${RULES}`,
    template: '分鏡 {{shot.index}}：{{shot.scene}}\n景別與構圖：{{shot.shotSize}}，{{shot.composition}}\n角色與動作：{{shot.action}}\n鏡頭：{{shot.camera}}\n出場角色：{{characters}}\n系列風格參考：{{series.style}}\n使用者調整指令：{{instruction}}',
    variables: [...p.variables.filter(x => !['shot.shotSize', 'shot.composition'].includes(x.name)),
      v('shot.shotSize', '景別', false, '中景'), v('shot.composition', '構圖', false, '人物位於右三分之一')],
  }),
  'character-sheet': p => ({
    ...p,
    target: { ...p.target, aspectRatio: '16:9' },
    system: `Character design sheet on a pure white background: front, side and back full-body views of the same character with consistent proportions and costume, plus a costume detail (定裝) panel. Same face, hairstyle and outfit in every view. No text, no logos.\n${RULES}`,
  }),
  'refined-frame': p => ({
    ...p,
    target: { ...p.target, aspectRatio: '16:9' },
    system: `Photorealistic horizontal 16:9 (1920×1080) frame for a cinematic tourism short. Natural light, shallow depth of field. Use the supplied location photo as the real background and keep its architecture accurate. Keep the character identical to the supplied character sheet. No text, no logos.\n${RULES}`,
    template: '分鏡 {{shot.index}}：{{shot.scene}}\n景別與構圖：{{shot.shotSize}}，{{shot.composition}}\n角色與動作：{{shot.action}}\n鏡頭：{{shot.camera}}\n角色定裝參考：{{character.reference}}\n實景照片：{{photo.description}}\n系列視覺風格：{{series.style}}\n使用者調整指令：{{instruction}}',
    variables: [...p.variables.filter(x => !['shot.shotSize', 'shot.composition'].includes(x.name)),
      v('shot.shotSize', '景別', false, '中景'), v('shot.composition', '構圖', false, '人物位於右三分之一')],
  }),
  'shot-video': p => ({
    ...p,
    target: { ...p.target, aspectRatio: '16:9' },
    system: `Image-to-video for a horizontal 16:9 cinematic tourism short. The supplied refined frame is the first frame (and the last frame when supplied); only add motion. Keep the background architecture and the character's face, hairstyle and outfit unchanged. Smooth, natural motion. When a line is given, the speaking character says it in Mandarin Chinese with accurate lip sync.\n${RULES}`,
    template: '分鏡 {{shot.index}}，長度 {{shot.seconds}} 秒\n景別：{{shot.shotSize}}\n角色與動作：{{shot.action}}\n鏡頭運動：{{shot.camera}}\n轉場：{{shot.transition}}\n台詞（{{shot.speaker}}）：{{shot.line}}\n系列視覺風格：{{series.style}}\n使用者調整指令：{{instruction}}',
    variables: [...p.variables.filter(x => !['shot.shotSize', 'shot.transition', 'shot.speaker', 'shot.line'].includes(x.name)),
      v('shot.shotSize', '景別', false, '中景'), v('shot.transition', '轉場', false, '直接切'),
      v('shot.speaker', '說話角色', false, '小晴'), v('shot.line', '台詞或旁白', false, '這座廟，藏著老一輩才知道的故事。')],
    modelRules: {
      'seedance-2.0': 'Seedance 寫法：先寫主體，再寫一個主要動作與一個鏡頭運動，避免同一格描述多個動作；台詞寫成「角色說：『…』」並要求中文口型同步；參考圖依序為首格、角色定裝圖。',
      'kling-2.1': 'Kling 寫法：以簡短英文句子描述動作，鏡頭運動放在句尾（例如 slow push in）；不支援口型時改為旁白，不讓角色開口。',
    },
  }),
};

const done = p => p.system.includes('內容與宗教規則') && (p.target.kind === 'text' || p.target.aspectRatio === '16:9');

async function main() {
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}/api/prompts`;
  try {
    for (const [id, change] of Object.entries(updates)) {
      const { prompt } = await (await fetch(`${base}/${id}`)).json();
      if (done(prompt)) { console.log(`略過 ${id}（已更新）`); continue; }
      const next = change(structuredClone(prompt));
      const res = await fetch(`${base}/${id}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: next, expectedVersion: prompt.version }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(`${id}：${JSON.stringify(body.error)}`);
      console.log(`已更新 ${id} → 第 ${body.prompt.version} 版`);
    }
  } finally {
    server.close();
  }
}

main().catch(err => { console.error(err.message); process.exit(1); });
