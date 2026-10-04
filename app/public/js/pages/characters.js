// 角色庫：一個系列的共同角色。新增（AI 撰寫描述）、刪除、產生四格定妝板、鎖定定裝版本。
import { h, api, mount, toast, money } from '../ui.js';
import { withConsent } from './video.js';
import { boardImage, boardView } from './board.js';

export async function charactersPage(id) {
  const base = `/api/series/${id}`;
  const [{ series }, est] = await Promise.all([
    api('GET', base),
    api('GET', `${base}/estimate/characters`).catch(() => ({ draft: 0, sheet: 0 })),
  ]);
  const list = h('section', { class: 'stack', style: 'gap:12px', 'aria-label': '角色清單' });
  let open = null; // 展開定妝板的角色 id
  let confirming = null; // 等待確認刪除的角色 id
  let adding = false;

  async function run(button, fn) {
    if (button) button.disabled = true;
    try { return await withConsent(fn); } catch (err) { if (err.code !== 'cancelled') toast(err.message); return null; } finally { if (button) button.disabled = false; }
  }
  const replace = c => { series.characters = series.characters.map(x => (x.id === c.id ? c : x)); draw(); };

  function deleteControls(c) {
    if (confirming !== c.id) return h('button', { class: 'btn btn-sm', onclick: () => { confirming = c.id; draw(); } }, '刪除');
    const yes = h('button', { class: 'btn btn-sm btn-primary', onclick: async () => {
      const r = await run(yes, () => api('DELETE', `${base}/characters/${c.id}`));
      if (!r) return;
      series.characters = r.series.characters;
      confirming = null;
      if (open === c.id) open = null;
      toast(`已刪除「${c.name}」`);
      draw();
    } }, '確認刪除');
    return h('span', { class: 'row', style: 'gap:6px' }, h('span', { class: 'small muted' }, '已建立的影片不受影響'), yes,
      h('button', { class: 'btn btn-sm', onclick: () => { confirming = null; draw(); } }, '取消'));
  }

  function item(c) {
    const locked = c.versions.find(v => v.version === c.lockedVersion);
    const thumb = boardImage(locked?.images);
    return h('article', { class: 'card stack', style: 'gap:12px', 'data-testid': 'library-character' },
      h('div', { class: 'row', style: 'gap:14px;align-items:flex-start;flex-wrap:nowrap' },
        h('span', { class: 'ph', style: 'width:72px;height:96px;border-radius:10px;flex:none;font-size:12px' },
          thumb ? h('img', { src: thumb.url, alt: `${c.name}定妝板` }) : '定妝板'),
        h('div', { class: 'stack', style: 'gap:4px;flex:1;min-width:0' },
          h('h2', { style: 'font-size:18px;margin:0' }, c.name),
          h('span', { class: 'small muted' }, locked ? `定裝版本 v${c.lockedVersion}・已鎖定` : c.versions.length ? `已有 ${c.versions.length} 個版本・尚未鎖定` : '尚未產生定妝板'),
          c.description ? h('span', { class: 'small muted' }, c.description) : null,
          h('div', { class: 'row', style: 'gap:6px' },
            h('button', { class: 'btn btn-sm', 'aria-expanded': String(open === c.id), onclick: () => { open = open === c.id ? null : c.id; draw(); } }, '定妝板'),
            deleteControls(c)))),
      open === c.id ? panel(c) : null);
  }

  function panel(c) {
    const shown = c.selectedVersion ?? c.lockedVersion;
    const version = c.versions.find(x => x.version === shown);
    const desc = h('textarea', { id: `sc-desc-${c.id}`, class: 'input' }, c.description || '');
    const instruction = h('input', { id: `sc-inst-${c.id}`, class: 'input', placeholder: '例如：換成深藍色唐裝、戴老花眼鏡' });
    const gen = h('button', { class: 'btn btn-primary btn-sm', onclick: async () => {
      const r = await run(gen, consent => api('POST', `${base}/characters/${c.id}/generate`, { description: desc.value, instruction: instruction.value, consent }));
      if (r) replace(r.character);
    } }, `${c.versions.length ? '重新產生' : '產生定妝板'}（預估 ${money(est.sheet)}）`);
    const lock = version && version.version !== c.lockedVersion ? h('button', { class: 'btn btn-sm', onclick: async () => {
      const r = await run(lock, () => api('PATCH', `${base}/characters/${c.id}`, { lockedVersion: version.version }));
      if (r) { replace(r.character); toast(`已鎖定 ${c.name} v${version.version}`); }
    } }, '鎖定此版本') : null;
    return h('div', { class: 'stack', style: 'gap:12px;border-top:1px solid var(--line);padding-top:12px', 'data-testid': 'library-character-panel' },
      c.versions.length ? h('div', { class: 'row', style: 'gap:6px' }, c.versions.map(x => h('button', {
        class: `btn btn-sm${x.version === shown ? ' btn-primary' : ''}`, 'aria-pressed': String(x.version === shown),
        onclick: async () => { const r = await run(null, () => api('PATCH', `${base}/characters/${c.id}`, { selectedVersion: x.version })); if (r) replace(r.character); },
      }, `v${x.version}${x.version === c.lockedVersion ? '・鎖定' : ''}`))) : null,
      version ? boardView(c.name, version.images) : null,
      h('div', { class: 'field' }, h('label', { for: desc.id }, '外觀描述'), desc),
      h('div', { class: 'field' }, h('label', { for: instruction.id }, '調整指令（選填）'), instruction),
      h('div', { class: 'row', style: 'gap:8px' }, gen, lock),
      h('p', { class: 'small muted', style: 'margin:0' }, '鎖定的版本會在之後新增的影片中直接沿用，不重新產生；已建立的影片不受影響。'));
  }

  function addForm() {
    const name = h('input', { id: 'sc-new-name', class: 'input', placeholder: '例如：廟公阿伯' });
    const desc = h('textarea', { id: 'sc-new-desc', class: 'input', placeholder: '一句構想即可，例如：在廟口顧了四十年的老廟公；也可以直接寫完整的外觀描述' });
    const notes = h('p', { class: 'small muted', style: 'margin:0' });
    const ai = h('button', { class: 'btn btn-sm', onclick: async () => {
      const r = await run(ai, consent => api('POST', `${base}/characters/draft`, { name: name.value, idea: desc.value, consent }));
      if (!r) return;
      if (!name.value.trim()) name.value = r.draft.name;
      desc.value = r.draft.description;
      notes.textContent = r.draft.notes ? `AI 說明：${r.draft.notes}（可再修改）` : '可再修改後加入。';
    } }, `AI 撰寫描述（預估 ${money(est.draft)}）`);
    const add = h('button', { class: 'btn btn-primary btn-sm', onclick: async () => {
      const r = await run(add, () => api('POST', `${base}/characters`, { name: name.value, description: desc.value }));
      if (!r) return;
      series.characters = [...series.characters, r.character];
      adding = false;
      open = r.character.id;
      toast(`已加入系列角色「${r.character.name}」`);
      draw();
    } }, '加入角色');
    return h('section', { class: 'card stack', style: 'gap:10px', 'aria-label': '新增角色' },
      h('div', { class: 'field' }, h('label', { for: name.id }, '角色名稱'), name),
      h('div', { class: 'field' }, h('label', { for: desc.id }, '構想或外觀描述'), desc),
      notes,
      h('div', { class: 'row', style: 'gap:8px' }, ai, add, h('button', { class: 'btn btn-sm', onclick: () => { adding = false; draw(); } }, '取消')));
  }

  const addButton = h('button', { class: 'btn btn-primary', onclick: () => { adding = true; draw(); } }, '＋ 新增角色');

  function draw() {
    addButton.hidden = adding;
    mount(list,
      adding ? addForm() : null,
      series.characters.length
        ? series.characters.map(item)
        : adding ? null : h('p', { class: 'muted' }, '還沒有系列角色。按「新增角色」建立，或在影片的角色設計步驟確認後加入。'));
  }
  draw();

  return h('main', { class: 'main' },
    h('nav', { class: 'crumbs', style: 'margin-bottom:16px' }, h('a', { href: '#/' }, '首頁'), ' › ', h('a', { href: `#/series/${id}` }, series.name), ' › 角色庫'),
    h('div', { class: 'page-head' },
      h('div', {}, h('h1', {}, '角色庫'), h('p', {}, `${series.name} 的共同角色，鎖定定裝版本後之後的影片會直接沿用。`)),
      addButton),
    list);
}
