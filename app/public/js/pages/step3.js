// 步驟 3：寺廟背景板（四格：正面全景、斜角／側面、廟埕與周邊環境、特色細節），確保影片中的寺廟一致。
import { h, api, toast, money, setBusy } from '../ui.js';
import { withConsent, actionBar, staleNotice } from './video.js';

const PANELS = [
  ['正面全景', '建築整體與比例'],
  ['斜角／側面', '屋頂層次與建築深度'],
  ['廟埕與周邊環境', '人物走位的地面與空間'],
  ['特色細節特寫', '屋脊剪黏、門神、石獅或匾額'],
];

export async function render({ video, refreshCost }) {
  const base = `/api/videos/${video.id}`;
  let v = video;
  const root = h('div');
  const est = await api('GET', `${base}/estimate/temple-board`).catch(() => ({ estimate: 0 }));

  async function run(button, fn) {
    setBusy(button, true);
    try {
      const r = await withConsent(fn);
      v = { ...r.video, viewStep: 3 };
      refreshCost();
      draw();
    } catch (err) {
      if (err.code !== 'cancelled') toast(err.message);
    } finally { setBusy(button, false); }
  }

  function draw() {
    const board = v.templeBoard;
    const version = board?.versions.find(x => x.version === board.selectedVersion);
    const photos = v.photos.filter(p => p.status === 'ready');
    const instruction = h('input', { id: 'board-instruction', class: 'input', placeholder: '例如：天色改成黃昏、廟埕再空曠一點' });
    const gen = h('button', { class: `btn${version ? '' : ' btn-primary'}`, onclick: () => run(gen, consent => api('POST', `${base}/temple-board/generate`, { instruction: instruction.value, consent })) },
      `${version ? '依指令重新產生' : '產生寺廟背景板'}（預估 ${money(est.estimate)}）`);
    const confirmBtn = h('button', { class: 'btn btn-primary', disabled: !version, onclick: async () => {
      try { await api('POST', `${base}/steps/3/confirm`); location.hash = `#/videos/${v.id}/4`; } catch (err) { toast(err.message); }
    } }, '確認背景板，產生故事腳本');

    root.replaceChildren(
      h('main', { class: 'main stack', style: 'gap:20px' },
        h('div', { class: 'page-head' }, h('div', {}, h('h1', {}, '寺廟背景板'),
          h('p', {}, `以 ${photos.length} 張去識別後的照片產生一張四格背景板；之後每格精緻圖都以它為場景參考，讓影片中的寺廟保持一致。`))),
        staleNotice(v, 3),
        h('section', { class: 'card stack', style: 'gap:16px' },
          board?.versions.length ? h('div', { class: 'row', style: 'gap:6px' }, board.versions.map(x => h('button', {
            class: `btn btn-sm${x.version === board.selectedVersion ? ' btn-primary' : ''}`, 'aria-pressed': String(x.version === board.selectedVersion),
            onclick: () => run(null, () => api('PATCH', `${base}/temple-board`, { selectedVersion: x.version })),
          }, `v${x.version}`))) : null,
          h('div', { class: 'row', style: 'gap:16px;align-items:flex-start' },
            h('div', { class: 'ph selected', style: 'flex:2 1 360px;max-width:640px;aspect-ratio:16/9;border-radius:12px' },
              version ? h('img', { src: version.image.url, alt: '寺廟背景板' }) : '寺廟背景板'),
            h('ol', { class: 'stack', style: 'flex:1 1 220px;gap:8px;margin:0;padding-left:20px', 'data-testid': 'temple-board-legend' },
              PANELS.map(([title, note]) => h('li', {}, h('strong', {}, title), h('div', { class: 'small muted' }, note))))),
          h('div', { class: 'field' }, h('label', { for: instruction.id }, '調整指令（選填）'), h('div', { class: 'row', style: 'flex-wrap:nowrap' }, instruction, gen)),
          h('p', { class: 'small muted', style: 'margin:0' }, '只送出去識別後的照片，畫面中不會出現人物。回到步驟 2 修改照片後，背景板需要重新確認。'))),
      actionBar(h('a', { class: 'btn', href: `#/videos/${v.id}/2` }, '上一步'),
        h('div', { class: 'row' }, h('span', { class: 'small muted' }, version ? `確認後以 v${version.version} 作為場景參考` : '先產生背景板'), confirmBtn)));
  }

  draw();
  return root;
}
