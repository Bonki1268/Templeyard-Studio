// 步驟 4：故事腳本與分鏡。
import { h, api, toast, money } from '../ui.js';
import { withConsent, actionBar, staleNotice } from './video.js';

const SIZES = ['遠景', '中景', '特寫'];

export async function render({ video, refreshCost }) {
  const base = `/api/videos/${video.id}`;
  let v = video;
  let editing = null;
  const root = h('div');

  async function run(button, fn) {
    if (button) button.disabled = true;
    try {
      const r = await withConsent(fn);
      v = { ...r.video, viewStep: 4 };
      refreshCost();
      draw();
    } catch (err) {
      if (err.code !== 'cancelled') toast(err.message);
    } finally { if (button) button.disabled = false; }
  }

  async function drawEmpty() {
    const est = await api('GET', `${base}/estimate/script`);
    const btn = h('button', { class: 'btn btn-primary', onclick: () => run(btn, consent => api('POST', `${base}/script/generate`, { consent })) },
      `產生腳本與分鏡圖（預估 ${money(est.estimate)}）`);
    root.replaceChildren(h('main', { class: 'main stack', style: 'gap:20px' },
      h('h1', {}, '故事腳本'), staleNotice(v, 3),
      h('div', { class: 'card stack' },
        h('p', {}, `AI 會以廣告編劇的角度，依採用的故事、寺廟資料與系列設定（${v.series.duration} 秒・${v.series.direction}），寫出廣告腳本並拆成 ${est.shotCount} 格分鏡，每格附分鏡圖。`),
        h('div', {}, btn))),
      actionBar(h('a', { class: 'btn', href: `#/videos/${v.id}/3` }, '上一步'), h('span')));
  }

  function shotCard(shot) {
    const regen = h('button', { class: 'btn btn-sm', onclick: () => run(regen, consent => api('POST', `${base}/script/shots/${shot.id}/regenerate`, { consent })) }, '重生此格');
    const photo = shot.photoIndex ? `（照片 ${shot.photoIndex}）` : '';
    return h('article', { class: `card stack${editing === shot.id ? ' selected' : ''}`, style: 'padding:12px;gap:8px', 'data-testid': 'shot' },
      h('div', { class: 'ph', style: 'aspect-ratio:16/9;border-radius:10px' }, shot.storyboard?.url ? h('img', { src: shot.storyboard.url, alt: `分鏡圖 ${shot.index}` }) : `分鏡圖 ${shot.index}`),
      h('div', { class: 'row', style: 'justify-content:space-between' }, h('strong', {}, `第 ${shot.index} 格`), h('span', { class: 'small muted' }, `${shot.shotSize}・${shot.seconds} 秒`)),
      h('p', { style: 'font-size:15px;line-height:1.6' }, `${shot.scene}${photo}：${shot.action}`),
      h('p', { class: 'small muted' }, shot.line ? `${shot.speaker}：${shot.line}` : '無台詞'),
      h('div', { class: 'row', style: 'margin-top:auto' },
        h('button', { class: 'btn btn-sm', onclick: () => { editing = shot.id; draw(); } }, '編輯'), regen));
  }

  function editPanel() {
    const shot = v.script.shots.find(s => s.id === editing);
    if (!shot) {
      return h('aside', { class: 'card stack', style: 'position:sticky;top:16px' },
        h('h2', {}, '編輯分鏡'), h('p', { class: 'small muted' }, '點任一格的「編輯」修改分鏡說明；也可以在下方輸入指令重新產生整份腳本。'), wholeScript());
    }
    const field = (label, key, el) => { el.id = `f-${key}`; return h('div', { class: 'field' }, h('label', { for: el.id, class: 'small muted' }, label), el); };
    const input = key => h('input', { class: 'input', value: shot[key] ?? '' });
    const area = key => h('textarea', { class: 'input', style: 'min-height:64px' }, shot[key] ?? '');
    const els = {
      shotSize: h('select', { class: 'input' }, SIZES.map(s => h('option', { value: s, selected: s === shot.shotSize }, s))),
      seconds: h('input', { class: 'input', type: 'number', step: '0.5', min: '0.5', max: '10', value: shot.seconds }),
      camera: input('camera'), transition: input('transition'),
      photoIndex: h('select', { class: 'input' }, h('option', { value: '' }, '不對應照片'),
        v.photos.filter(p => p.status === 'ready').map((p, i) => h('option', { value: i + 1, selected: shot.photoIndex === i + 1 }, `照片 ${i + 1}：${p.description || p.filename}`))),
      scene: input('scene'), composition: input('composition'), intent: input('intent'), narrativeRole: input('narrativeRole'),
      action: area('action'), speaker: input('speaker'), line: area('line'), subtitle: area('subtitle'),
    };
    const instruction = h('input', { class: 'input', placeholder: '例如：改成黃昏的屋脊特寫', 'aria-label': '這一格的重生指令' });
    const save = h('button', { class: 'btn btn-primary', onclick: () => run(save, () => api('PATCH', `${base}/script/shots/${shot.id}`, Object.fromEntries(Object.entries(els).map(([k, el]) => [k, k === 'seconds' ? Number(el.value) : el.value])))) }, '儲存此格');
    const regen = h('button', { class: 'btn', onclick: () => run(regen, consent => api('POST', `${base}/script/shots/${shot.id}/regenerate`, { instruction: instruction.value, consent })) }, '依指令重生此格');
    const pair = (a, b) => h('div', { style: 'display:grid;grid-template-columns:1fr 1fr;gap:12px' }, a, b);
    return h('aside', { class: 'card stack', style: 'gap:12px' },
      h('div', { class: 'row', style: 'justify-content:space-between' }, h('h2', {}, `編輯第 ${shot.index} 格`), h('button', { class: 'btn btn-sm', onclick: () => { editing = null; draw(); } }, '關閉')),
      pair(field('景別', 'shotSize', els.shotSize), field('秒數', 'seconds', els.seconds)),
      pair(field('運鏡', 'camera', els.camera), field('轉場', 'transition', els.transition)),
      field('對應照片', 'photoIndex', els.photoIndex),
      field('場景', 'scene', els.scene),
      pair(field('構圖', 'composition', els.composition), field('鏡頭意圖', 'intent', els.intent)),
      pair(field('敘事角色', 'narrativeRole', els.narrativeRole), field('說話角色', 'speaker', els.speaker)),
      field('角色動作', 'action', els.action),
      field('台詞或旁白', 'line', els.line),
      field('字幕', 'subtitle', els.subtitle),
      h('div', { class: 'row' }, save),
      h('div', { class: 'stack', style: 'border-top:1px solid var(--line);padding-top:12px;gap:8px' }, instruction, h('div', {}, regen)));
  }

  function wholeScript() {
    const instruction = h('input', { id: 'script-instruction', class: 'input', placeholder: '例如：開頭節奏再快一點' });
    const btn = h('button', { class: 'btn', style: 'width:100%', onclick: () => run(btn, consent => api('POST', `${base}/script/generate`, { instruction: instruction.value, consent })) }, '依指令重新產生腳本');
    return h('div', { class: 'stack', style: 'border-top:1px solid var(--line);padding-top:12px;gap:8px' },
      h('label', { for: 'script-instruction', class: 'small muted' }, '要 AI 怎麼改整份腳本？'), instruction, btn);
  }

  function draw() {
    if (!v.script) return drawEmpty();
    const s = v.script;
    const total = s.shots.reduce((sum, x) => sum + Number(x.seconds), 0);
    const ok = Math.abs(total - v.series.duration) <= 0.5;
    const missing = s.shots.filter(x => !x.scene || !x.action).length;
    const confirmBtn = h('button', { class: 'btn btn-primary', disabled: !ok || missing > 0, onclick: async () => {
      try { await api('POST', `${base}/steps/4/confirm`); location.hash = `#/videos/${v.id}/5`; } catch (err) { toast(err.message); }
    } }, '確認腳本，進入角色設計');
    root.replaceChildren(
      h('main', { class: 'main' },
        h('div', { class: 'page-head' },
          h('div', {}, h('h1', {}, `故事腳本：${s.title}`), h('p', {}, s.logline)),
          h('div', { class: 'stack', style: 'gap:6px;min-width:240px' },
            h('span', { class: 'small muted', 'data-testid': 'total' }, `總長度 ${total}／${v.series.duration} 秒・${s.shots.length} 格`),
            h('div', { style: `height:6px;border-radius:3px;background:${ok ? 'var(--accent)' : '#E8B4AA'}` }),
            h('span', { class: 'small muted', 'data-testid': 'script-version' }, `腳本第 ${s.version} 版${s.instruction ? `・指令：${s.instruction}` : ''}`))),
        staleNotice(v, 3),
        h('details', { class: 'card', style: 'margin-bottom:16px' }, h('summary', { style: 'cursor:pointer;font-weight:500' }, '廣告腳本全文'), h('p', { style: 'margin-top:10px;line-height:1.8' }, s.adCopy)),
        h('div', { class: 'layout' },
          h('div', { class: 'grow grid grid-3' }, s.shots.map(shotCard)),
          h('div', { class: 'side', style: 'flex:1 1 340px' }, editPanel()))),
      actionBar(h('a', { class: 'btn', href: `#/videos/${v.id}/3` }, '上一步'),
        h('div', { class: 'row' }, h('span', { class: 'small', style: { color: ok && !missing ? 'var(--ok)' : 'var(--accent)' } },
          ok && !missing ? `✓ 每格都有說明・總長度 ${total} 秒` : `${missing ? `${missing} 格缺少說明・` : ''}總長度 ${total} 秒，需為 ${v.series.duration} 秒`), confirmBtn)));
  }

  await draw();
  return root;
}
