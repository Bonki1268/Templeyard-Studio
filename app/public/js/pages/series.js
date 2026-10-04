// 系列頁：系列設定、系列角色、影片列表、新增影片。
import { h, api, mount, formatDate, toast, money } from '../ui.js';
import { seriesForm } from './home.js';
import { withConsent } from './video.js';

const VIEWS = [['front', '正面'], ['side', '側面'], ['back', '背面'], ['costume', '定裝圖']];

// 系列角色：清單、新增角色（AI 撰寫描述）、產生三視圖與定裝圖、鎖定定裝版本。
async function charactersSection(series) {
  const base = `/api/series/${series.id}`;
  const est = await api('GET', `${base}/estimate/characters`).catch(() => ({ draft: 0, sheet: 0 }));
  const root = h('section', { class: 'card stack', 'aria-labelledby': 'chars-title' });
  let open = null; // 展開中的角色 id
  let adding = false;

  async function run(button, fn) {
    if (button) button.disabled = true;
    try { return await withConsent(fn); } catch (err) { if (err.code !== 'cancelled') toast(err.message); return null; } finally { if (button) button.disabled = false; }
  }
  const replace = c => { series.characters = series.characters.map(x => (x.id === c.id ? c : x)); draw(); };

  function item(c) {
    const locked = c.versions.find(v => v.version === c.lockedVersion);
    return h('div', { class: 'row', style: 'gap:14px;align-items:flex-start', 'data-testid': 'series-character' },
      h('span', { class: 'ph', style: 'width:72px;height:96px;border-radius:10px;flex:none;font-size:12px' },
        locked?.images?.costume ? h('img', { src: locked.images.costume.url, alt: `${c.name}定裝圖` }) : '定裝圖'),
      h('div', { class: 'stack', style: 'gap:4px;flex:1;min-width:0' },
        h('span', { style: 'font-size:16px' }, c.name),
        h('span', { class: 'small muted' }, locked ? `定裝版本 v${c.lockedVersion}・已鎖定` : c.versions.length ? `已有 ${c.versions.length} 個版本・尚未鎖定` : '尚未產生定裝圖'),
        c.description ? h('span', { class: 'small muted' }, c.description) : null,
        h('div', {}, h('button', { class: 'btn btn-sm', 'aria-expanded': String(open === c.id), onclick: () => { open = open === c.id ? null : c.id; draw(); } }, '定裝圖'))));
  }

  function panel(c) {
    const shown = c.selectedVersion ?? c.lockedVersion;
    const version = c.versions.find(x => x.version === shown);
    const desc = h('textarea', { id: `sc-desc-${c.id}`, class: 'input' }, c.description || '');
    const instruction = h('input', { id: `sc-inst-${c.id}`, class: 'input', placeholder: '例如：換成深藍色唐裝、戴老花眼鏡' });
    const gen = h('button', { class: 'btn btn-primary btn-sm', onclick: async () => {
      const r = await run(gen, consent => api('POST', `${base}/characters/${c.id}/generate`, { description: desc.value, instruction: instruction.value, consent }));
      if (r) replace(r.character);
    } }, `${c.versions.length ? '重新產生' : '產生定裝圖'}（預估 ${money(est.sheet)}）`);
    const lock = version && version.version !== c.lockedVersion ? h('button', { class: 'btn btn-sm', onclick: async () => {
      const r = await run(lock, () => api('PATCH', `${base}/characters/${c.id}`, { lockedVersion: version.version }));
      if (r) { replace(r.character); toast(`已鎖定 ${c.name} v${version.version}`); }
    } }, '鎖定此版本') : null;
    return h('div', { class: 'stack', style: 'gap:12px;border-top:1px solid var(--line);padding-top:12px', 'data-testid': 'series-character-panel' },
      h('div', { class: 'row', style: 'justify-content:space-between' }, h('strong', {}, c.name),
        h('div', { class: 'row', style: 'gap:6px' }, c.versions.map(x => h('button', {
          class: `btn btn-sm${x.version === shown ? ' btn-primary' : ''}`, 'aria-pressed': String(x.version === shown),
          onclick: async () => { const r = await run(null, () => api('PATCH', `${base}/characters/${c.id}`, { selectedVersion: x.version })); if (r) replace(r.character); },
        }, `v${x.version}${x.version === c.lockedVersion ? '・鎖定' : ''}`)))),
      version ? h('div', { class: 'grid', style: 'grid-template-columns:repeat(2,1fr);gap:8px' }, VIEWS.map(([key, label]) => h('figure', { style: 'margin:0', class: 'stack' },
        h('div', { class: 'ph', style: 'aspect-ratio:3/4;border-radius:10px' }, version.images?.[key] ? h('img', { src: version.images[key].url, alt: `${c.name} ${label}` }) : label),
        h('figcaption', { class: 'small muted' }, label)))) : null,
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
    return h('div', { class: 'stack', style: 'gap:10px;border-top:1px solid var(--line);padding-top:12px', 'data-testid': 'series-character-form' },
      h('div', { class: 'field' }, h('label', { for: name.id }, '角色名稱'), name),
      h('div', { class: 'field' }, h('label', { for: desc.id }, '構想或外觀描述'), desc),
      notes,
      h('div', { class: 'row', style: 'gap:8px' }, ai, add, h('button', { class: 'btn btn-sm', onclick: () => { adding = false; draw(); } }, '取消')));
  }

  function draw() {
    mount(root,
      h('div', { class: 'row', style: 'justify-content:space-between' }, h('h2', { id: 'chars-title' }, '系列角色'),
        adding ? null : h('button', { class: 'btn btn-sm', onclick: () => { adding = true; draw(); } }, '＋ 新增角色')),
      series.characters.length
        ? series.characters.map(c => [item(c), open === c.id ? panel(c) : null])
        : adding ? null : h('p', { class: 'small muted' }, '還沒有系列角色。可在這裡新增並由 AI 協助產生定裝圖，或在影片的角色設計步驟確認後加入。'),
      adding ? addForm() : null);
  }
  draw();
  return root;
}

const STEP_NAMES = { 1: '系列設定', 2: '新增影片', 3: '故事腳本', 4: '角色設計', 5: '精緻圖', 6: '影片生成' };

function videoBadge(v) {
  if (v.status === 'done') return h('span', { class: 'badge badge-ok' }, '已完成');
  return h('span', { class: 'badge badge-accent' }, `步驟 ${v.currentStep}／6 ${STEP_NAMES[v.currentStep] || ''}`);
}

export async function seriesPage(id) {
  const { series, videos } = await api('GET', `/api/series/${id}`);
  const settings = h('section', { class: 'card stack', 'aria-labelledby': 'settings-title' });
  const showSettings = () => settings.replaceChildren(
    h('div', { class: 'row', style: 'justify-content:space-between' }, h('h2', { id: 'settings-title' }, '系列設定'),
      h('button', { class: 'btn btn-sm', onclick: editSettings }, '編輯')),
    h('dl', { class: 'kv', style: 'margin:0' },
      h('dt', {}, '視覺風格'), h('dd', { 'data-testid': 'series-style' }, series.style, series.styleNote ? h('div', { class: 'small muted' }, series.styleNote) : null),
      h('dt', {}, '影片秒數'), h('dd', { 'data-testid': 'series-duration' }, `${series.duration} 秒`),
      h('dt', {}, '影片方向'), h('dd', {}, series.direction),
      h('dt', {}, '輸出規格'), h('dd', { class: 'mono' }, `${series.output.aspectRatio} · ${series.output.width}×${series.output.height}`),
      h('dt', {}, '費用上限'), h('dd', {}, `US$${series.costCap} ／支影片`)),
    h('p', { class: 'small muted' }, '修改設定只影響之後新增的影片。'));
  function editSettings() {
    settings.replaceChildren(h('h2', { id: 'settings-title' }, '編輯系列設定'), seriesForm({
      initial: series, submitLabel: '儲存設定', withCharacter: false,
      onSubmit: async body => {
        const { series: updated } = await api('PUT', `/api/series/${id}`, body);
        Object.assign(series, updated);
        toast('已儲存系列設定');
        showSettings();
      },
    }));
  }
  showSettings();

  const characters = await charactersSection(series);

  const newVideo = async () => {
    const { video } = await api('POST', `/api/series/${id}/videos`, {});
    location.hash = `#/videos/${video.id}/2`;
  };

  return h('main', { class: 'main' },
    h('nav', { class: 'crumbs', style: 'margin-bottom:16px' }, h('a', { href: '#/' }, '首頁'), ' › ', series.name),
    h('div', { class: 'page-head' },
      h('div', {}, h('h1', {}, series.name), h('p', {}, `${videos.length} 支影片・最近更新 ${formatDate(series.updatedAt)}`)),
      h('button', { class: 'btn btn-primary', onclick: newVideo }, '＋ 新增影片')),
    h('div', { class: 'layout' },
      h('div', { class: 'side stack', style: 'gap:16px;flex:1 1 300px' }, settings, characters),
      h('section', { class: 'grow stack', 'aria-labelledby': 'videos-title', style: 'gap:12px' },
        h('h2', { id: 'videos-title' }, '影片'),
        videos.length ? videos.map(v => h('a', { class: 'listcard', href: `#/videos/${v.id}/${v.status === 'done' ? 6 : v.currentStep}`, 'data-testid': 'video-item' },
          h('span', { class: 'ph', style: 'width:160px;height:90px;border-radius:8px;flex:none' }, v.status === 'done' ? '成品' : `步驟 ${v.currentStep}`),
          h('span', { class: 'stack', style: 'gap:4px;flex:1;min-width:0' },
            h('span', { style: 'font-size:17px' }, v.title || '未命名影片'),
            h('span', { class: 'small muted' }, v.temple ? `${v.temple.label}・${v.temple.district || ''}・${v.temple.deity || ''}` : '尚未選擇寺廟')),
          h('span', { class: 'stack', style: 'align-items:flex-end;gap:6px' }, videoBadge(v), h('span', { class: 'small muted' }, formatDate(v.updatedAt)))))
          : h('p', { class: 'muted' }, '這個系列還沒有影片，按「新增影片」開始。'))));
}
