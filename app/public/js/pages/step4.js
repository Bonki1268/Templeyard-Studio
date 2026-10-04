// 步驟 4：角色設計（四格定妝板、版本、加入系列角色）。
import { h, api, toast, money } from '../ui.js';
import { withConsent, actionBar, staleNotice } from './video.js';
import { boardImage, boardView } from './board.js';


export async function render({ video, refreshCost }) {
  const base = `/api/videos/${video.id}`;
  let v = video;
  let current = v.characters[0]?.id || null;
  const root = h('div');

  async function run(button, fn) {
    if (button) button.disabled = true;
    try {
      const r = await withConsent(fn);
      v = { ...r.video, viewStep: 4 };
      if (!current || !v.characters.some(c => c.id === current)) current = v.characters[0]?.id || null;
      refreshCost();
      await draw();
    } catch (err) {
      if (err.code !== 'cancelled') toast(err.message);
    } finally { if (button) button.disabled = false; }
  }

  function costumeOf(c) {
    return boardImage(c.versions.find(x => x.version === c.selectedVersion)?.images);
  }

  function listItem(c) {
    const img = costumeOf(c);
    const status = c.reused ? '✓ 直接沿用系列角色' : c.lockedVersion ? `已鎖定 v${c.lockedVersion}` : '待確認';
    return h('button', { class: `listcard${c.id === current ? ' selected' : ''}`, 'data-testid': 'character-item', style: 'cursor:pointer;font:inherit;text-align:left;width:100%',
      onclick: () => { current = c.id; draw(); } },
      h('span', { class: 'ph', style: 'width:56px;height:72px;border-radius:8px;flex:none;font-size:12px' }, img ? h('img', { src: img.url, alt: '' }) : '定裝'),
      h('span', { class: 'stack', style: 'gap:2px' }, h('span', { style: 'font-size:16px;font-weight:500' }, c.name),
        h('span', { class: 'small muted' }, `${c.source === 'series' ? '系列角色' : '本支新角色'}・v${c.selectedVersion}`),
        h('span', { class: 'small', style: { color: c.reused ? 'var(--ok)' : 'var(--accent)' } }, status)));
  }

  function detail(c) {
    const version = c.versions.find(x => x.version === c.selectedVersion);
    const desc = h('textarea', { id: 'char-description', class: 'input' }, c.description || '');
    const instruction = h('input', { id: 'char-instruction', class: 'input', placeholder: '例如：換成灰色唐裝、戴老花眼鏡' });
    const regen = h('button', { class: 'btn', onclick: () => run(regen, consent => api('POST', `${base}/characters/${c.id}/regenerate`, { instruction: instruction.value, description: desc.value, consent })) }, '依指令重新生成');
    const seriesLocked = c.source === 'series';
    return h('section', { class: 'card stack', style: 'gap:16px' },
      h('div', { class: 'row', style: 'justify-content:space-between' }, h('h2', { style: 'font-size:22px' }, c.name),
        h('div', { class: 'row', style: 'gap:6px' }, c.versions.map(x => h('button', {
          class: `btn btn-sm${x.version === c.selectedVersion ? ' btn-primary' : ''}`, 'aria-pressed': String(x.version === c.selectedVersion),
          onclick: () => run(null, () => api('PATCH', `${base}/characters/${c.id}`, { selectedVersion: x.version })),
        }, `v${x.version}`)))),
      boardView(c.name, version?.images),
      c.reused ? h('p', { class: 'small muted' }, `沿用系列角色的定妝板 v${c.selectedVersion}，不重新產生；需要修改時可依指令重新生成。`) : null,
      h('div', { class: 'field' }, h('label', { for: 'char-description' }, '外觀描述（來自腳本，可修改）'), desc),
      h('div', { class: 'field' }, h('label', { for: 'char-instruction' }, '調整指令'), h('div', { class: 'row', style: 'flex-wrap:nowrap' }, instruction, regen)),
      h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: seriesLocked || c.addToSeries, disabled: seriesLocked,
        onchange: e => run(null, () => api('PATCH', `${base}/characters/${c.id}`, { addToSeries: e.target.checked })) }),
        seriesLocked ? '系列角色：確認後更新系列的定裝版本' : '確認後加入系列角色，之後的影片也能使用'));
  }

  async function draw() {
    if (!v.characters.length) {
      const est = await api('GET', `${base}/estimate/characters`);
      const btn = h('button', { class: 'btn btn-primary', onclick: () => run(btn, consent => api('POST', `${base}/characters/generate`, { consent })) },
        `產生角色（預估 ${money(est.estimate)}）`);
      root.replaceChildren(h('main', { class: 'main stack', style: 'gap:20px' }, h('h1', {}, '角色設計'), staleNotice(v, 4),
        h('div', { class: 'card stack' }, h('p', {}, `依分鏡腳本找出需要的角色：系列已鎖定的角色直接沿用，新角色由 AI 產生一張四格定妝板（需新產生 ${est.newCharacters} 位）。`), h('div', {}, btn))),
        actionBar(h('a', { class: 'btn', href: `#/videos/${v.id}/3` }, '上一步'), h('span')));
      return;
    }
    const c = v.characters.find(x => x.id === current) || v.characters[0];
    const confirmBtn = h('button', { class: 'btn btn-primary', onclick: async () => {
      try { await api('POST', `${base}/steps/4/confirm`); location.hash = `#/videos/${v.id}/5`; } catch (err) { toast(err.message); }
    } }, '確認角色，產生精緻圖');
    const summary = v.characters.map(x => `${x.name} v${x.selectedVersion}`).join('、');
    root.replaceChildren(
      h('main', { class: 'main' },
        h('div', { class: 'page-head' }, h('div', {}, h('h1', {}, '角色設計'),
          h('p', {}, `腳本需要 ${v.characters.length} 位角色：系列角色直接沿用，新角色由 AI 產生四格定妝板。`))),
        staleNotice(v, 4),
        h('div', { class: 'layout' },
          h('div', { class: 'side stack', style: 'flex:0 1 280px;gap:12px' }, v.characters.map(listItem)),
          h('div', { class: 'grow' }, detail(c)))),
      actionBar(h('a', { class: 'btn', href: `#/videos/${v.id}/3` }, '上一步'),
        h('div', { class: 'row' }, h('span', { class: 'small muted' }, `確認後鎖定為 ${summary}，精緻圖與影片都使用這個版本`), confirmBtn)));
  }

  await draw();
  return root;
}
