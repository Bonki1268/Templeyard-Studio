// 步驟 2：選擇寺廟、上傳照片（去識別）、故事與 AI 潤飾。
import { h, api, toast } from '../ui.js';
import { withConsent, actionBar, staleNotice } from './video.js';

const KIND = { face: '人臉', plate: '車牌' };

export async function render({ video, refreshCost }) {
  const base = `/api/videos/${video.id}`;
  let v = video;
  const update = next => { v = { ...next, viewStep: 2 }; renderAll(); };

  // ---- 1 選擇寺廟 ----
  const search = h('input', { id: 'temple-search', class: 'input', type: 'search', placeholder: '例如：淡水、鄞山寺、媽祖', 'aria-label': '搜尋廟名、行政區或主祀神明' });
  const results = h('div', { class: 'stack', style: 'gap:8px;max-height:420px;overflow-y:auto;padding:2px', role: 'list' });
  const count = h('p', { class: 'small muted', 'data-testid': 'temple-count' });
  const detail = h('div', { class: 'stack', style: 'background:#F7F8FA;border-radius:12px;padding:20px;gap:10px', 'data-testid': 'temple-detail' });
  let timer;
  search.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(doSearch, 200); });
  async function doSearch() {
    const q = search.value.trim();
    if (!q) { results.replaceChildren(); count.textContent = ''; return; }
    const r = await api('GET', `/api/temples?q=${encodeURIComponent(q)}&limit=100`);
    count.textContent = `找到 ${r.total} 間${r.total > 100 ? '（顯示前 100 間）' : ''}・已排除已廢止與未登記的寺廟${r.excluded ? `（${r.excluded} 間）` : ''}`;
    results.replaceChildren(...r.items.map(t => h('button', {
      class: `listcard${t.id === v.templeId ? ' selected' : ''}`, type: 'button', role: 'listitem', 'data-testid': 'temple-result',
      style: 'flex-direction:column;align-items:flex-start;gap:2px;text-align:left;cursor:pointer;font:inherit',
      onclick: async () => { update((await api('PUT', `${base}/temple`, { templeId: t.id })).video); doSearch(); },
    }, h('span', { style: 'font-size:16px;font-weight:500' }, t.label),
      h('span', { class: 'small muted' }, [t.district, t.deity, t.builtYear ? `創建於 ${t.builtYear} 年` : '創建年不詳'].filter(Boolean).join('・')))));
  }
  const history = h('textarea', { id: 'temple-history', class: 'input', placeholder: '貼上你查到的歷史或簡介。AI 只會引用這裡與資料庫中的內容，不會自行補寫歷史。' });
  history.addEventListener('change', async () => update((await api('PUT', `${base}/temple-history`, { text: history.value })).video));

  function renderDetail() {
    const t = v.temple;
    if (!t) { detail.replaceChildren(h('p', { class: 'muted' }, '從左邊搜尋並選擇一間寺廟。')); return; }
    const row = (k, val) => [h('dt', {}, k), h('dd', {}, val || '—')];
    history.value = v.templeHistory || '';
    detail.replaceChildren(
      h('div', { class: 'row', style: 'align-items:baseline;gap:10px' }, h('h3', { style: 'font-size:20px' }, t.label), h('span', { class: 'small muted' }, '資料來自新北市寺廟登記資料')),
      h('dl', { class: 'kv', style: 'margin:0' },
        row('地址', t.address), row('主祀神明', t.deity), row('教別', t.religion),
        row('創建年', t.builtYear ? `${t.builtYear} 年（${t.builtRaw}）` : `不詳${t.builtRaw ? `（${t.builtRaw}）` : ''}`),
        row('電話', t.phone)),
      h('label', { for: 'temple-history', class: 'label' }, '歷史與簡介（選填，自己貼上）'), history);
  }

  // ---- 2 上傳照片 ----
  const fileInput = h('input', { type: 'file', accept: 'image/jpeg,image/png,image/webp', multiple: true, 'data-testid': 'photo-input', style: 'display:none' });
  fileInput.addEventListener('change', async () => {
    for (const file of fileInput.files) {
      try {
        const res = await fetch(`${base}/photos`, { method: 'POST', headers: { 'Content-Type': file.type, 'X-Filename': encodeURIComponent(file.name) }, body: file });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error?.message);
      } catch (err) { toast(`上傳失敗：${err.message}`); }
    }
    fileInput.value = '';
    update((await api('GET', base)).video);
  });
  const photoGrid = h('div', { class: 'grid grid-4' });
  const photoCount = h('span', { class: 'small muted', 'data-testid': 'photo-count' });

  function photoCard(p, i) {
    const regions = h('div', { class: 'stack', style: 'gap:6px;display:none' });
    const frame = h('div', { class: 'ph', style: 'position:relative;aspect-ratio:16/9;border-radius:10px' },
      h('img', { src: p.url, alt: `照片 ${i + 1}` }),
      h('span', { class: 'badge badge-ok', style: 'position:absolute;top:8px;left:8px' }, '已去識別'));
    const overlay = h('div', { style: 'position:absolute;inset:0;display:none;cursor:crosshair' });
    frame.append(overlay);
    const drawBoxes = () => overlay.replaceChildren(...p.regions.map(r => h('div', { style: {
      position: 'absolute', left: `${r.x * 100}%`, top: `${r.y * 100}%`, width: `${r.w * 100}%`, height: `${r.h * 100}%`,
      border: `2px ${r.enabled ? 'solid' : 'dashed'} ${r.enabled ? '#A8321F' : '#8A909A'}`, borderRadius: '4px' } })));
    // 在照片上拖曳即可手動加框
    let start = null;
    overlay.addEventListener('mousedown', e => { const b = overlay.getBoundingClientRect(); start = { x: (e.clientX - b.left) / b.width, y: (e.clientY - b.top) / b.height }; });
    overlay.addEventListener('mouseup', async e => {
      if (!start) return;
      const b = overlay.getBoundingClientRect();
      const end = { x: (e.clientX - b.left) / b.width, y: (e.clientY - b.top) / b.height };
      const box = { x: Math.min(start.x, end.x), y: Math.min(start.y, end.y), w: Math.abs(end.x - start.x), h: Math.abs(end.y - start.y) };
      start = null;
      if (box.w < 0.02 || box.h < 0.02) return;
      await api('POST', `${base}/photos/${p.id}/regions`, box);
      update((await api('GET', base)).video);
    });
    const toggle = h('button', { class: 'btn btn-sm', type: 'button', onclick: () => {
      const show = regions.style.display === 'none';
      regions.style.display = show ? '' : 'none';
      overlay.style.display = show ? '' : 'none';
      drawBoxes();
    } }, '對照遮蔽區塊');
    const counters = {};
    regions.append(
      h('p', { class: 'small muted' }, '紅框為遮蔽區塊；取消勾選可還原誤判（例如神像），在照片上拖曳可手動加框。'),
      ...p.regions.map(r => {
        counters[r.kind] = (counters[r.kind] || 0) + 1;
        return h('label', { class: 'check small' }, h('input', { type: 'checkbox', checked: r.enabled, onchange: async e => {
          await api('PATCH', `${base}/photos/${p.id}/regions/${r.id}`, { enabled: e.target.checked });
          update((await api('GET', base)).video);
        } }), `${KIND[r.kind] || r.kind} ${counters[r.kind]}`);
      }));
    const desc = h('input', { class: 'input', style: 'min-height:36px;font-size:14px', value: p.description, placeholder: '照片說明，例如：廟宇正面', 'aria-label': `照片 ${i + 1} 說明` });
    desc.addEventListener('change', async () => { await api('PATCH', `${base}/photos/${p.id}`, { description: desc.value }); });
    return h('div', { class: 'stack', style: 'gap:8px', 'data-testid': 'photo' },
      frame,
      h('div', { class: 'row', style: 'justify-content:space-between;gap:6px' }, h('span', { class: 'small' }, p.summary), toggle),
      regions, desc,
      h('button', { class: 'btn btn-sm', type: 'button', style: 'align-self:flex-start', onclick: async () => {
        await api('DELETE', `${base}/photos/${p.id}`); update((await api('GET', base)).video);
      } }, '移除'));
  }

  function renderPhotos() {
    const photos = v.photos.filter(p => p.status !== 'removed');
    photoCount.textContent = `${photos.length}／5 張・上傳後自動遮蔽人臉與車牌，神像不遮`;
    photoGrid.replaceChildren(...photos.map(photoCard),
      photos.length < 5 ? h('button', { class: 'ph', type: 'button', style: 'aspect-ratio:16/9;border-radius:10px;border:1px dashed #8A909A;background:#fff;cursor:pointer;font:inherit', onclick: () => fileInput.click() },
        `↑ 上傳照片（還可以 ${5 - photos.length} 張）`) : null);
  }

  // ---- 3 故事 ----
  const story = h('textarea', { id: 'story', class: 'input', style: 'min-height:150px', placeholder: '想說的故事或情節，例如老一輩口耳相傳的故事。' });
  story.addEventListener('change', async () => update((await api('PUT', `${base}/story`, { text: story.value })).video));
  const polishInstruction = h('input', { class: 'input', placeholder: '（選填）潤飾指令，例如：語氣再口語一點', 'aria-label': '潤飾指令' });
  const polishBtn = h('button', { class: 'btn', type: 'button', onclick: async () => {
    polishBtn.disabled = true;
    try {
      if (story.value.trim() !== (v.story.original || '')) await api('PUT', `${base}/story`, { text: story.value });
      const r = await withConsent(consent => api('POST', `${base}/story/polish`, { instruction: polishInstruction.value, consent }));
      update(r.video); refreshCost();
    } catch (err) { toast(err.message); } finally { polishBtn.disabled = false; }
  } }, '✦ AI 潤飾');
  const polishedBox = h('div', { class: 'stack', style: 'background:#F7F8FA;border-radius:12px;padding:20px;gap:10px' });
  const choice = h('p', { class: 'small', 'data-testid': 'story-choice' });

  function renderStory() {
    if (document.activeElement !== story) story.value = v.story.original || '';
    const CHOICES = { original: '目前採用原文', polished: '已採用潤飾版', edited: '已採用修改後的潤飾版' };
    choice.textContent = v.story.adopted ? CHOICES[v.story.choice] || '' : '';
    if (!v.story.polished) {
      polishedBox.replaceChildren(h('span', { class: 'label' }, 'AI 潤飾版'), h('p', { class: 'small muted' }, '按「AI 潤飾」後，這裡會出現依系列規範修飾的版本。潤飾只使用寺廟資料與你的輸入，不添加歷史事實。'), choice);
      return;
    }
    const edit = h('textarea', { class: 'input', 'data-testid': 'polished', 'aria-label': 'AI 潤飾版' }, v.story.choice === 'edited' ? v.story.adopted : v.story.polished.text);
    polishedBox.replaceChildren(h('span', { class: 'label' }, 'AI 潤飾版（可直接修改）'), edit,
      h('p', { class: 'small muted' }, v.story.polished.notes),
      h('div', { class: 'row' },
        h('button', { class: 'btn btn-primary', type: 'button', onclick: async () => {
          const changed = edit.value.trim() !== v.story.polished.text;
          update((await api('POST', `${base}/story/adopt`, changed ? { choice: 'edited', text: edit.value } : { choice: 'polished' })).video);
        } }, '採用潤飾版'),
        h('button', { class: 'btn', type: 'button', onclick: async () => update((await api('POST', `${base}/story/adopt`, { choice: 'original' })).video) }, '保留原文')),
      choice);
  }

  // ---- 確認列 ----
  const conditions = h('div', { class: 'row small', 'data-testid': 'conditions', style: 'gap:16px' });
  const confirmBtn = h('button', { class: 'btn btn-primary', type: 'button', onclick: async () => {
    confirmBtn.disabled = true;
    try {
      await api('POST', `${base}/steps/2/confirm`);
      location.hash = `#/videos/${v.id}/3`;
    } catch (err) { toast(err.message); confirmBtn.disabled = false; }
  } }, '確認，產生寺廟背景板');
  function renderConditions() {
    const ready = v.photos.filter(p => p.status === 'ready').length;
    const items = [
      [Boolean(v.templeId), '已選寺廟', '尚未選擇寺廟'],
      [ready > 0, `${ready} 張照片已去識別`, '至少要有 1 張照片完成去識別'],
      [Boolean((v.story.adopted || '').trim()), '故事已填寫', '故事不能空白'],
    ];
    conditions.replaceChildren(...items.map(([ok, yes, no]) => h('span', { style: { color: ok ? 'var(--ok)' : 'var(--accent)' } }, ok ? `✓ ${yes}` : `✗ ${no}`)));
    confirmBtn.disabled = !items.every(([ok]) => ok);
  }

  function renderAll() { renderDetail(); renderPhotos(); renderStory(); renderConditions(); }
  renderAll();

  const section = (n, title, extra, ...children) => h('section', { class: 'card stack', style: 'gap:16px' },
    h('div', { class: 'row', style: 'justify-content:space-between' }, h('h2', {}, `${n}　${title}`), extra), ...children);

  return h('div', {},
    h('main', { class: 'main stack', style: 'gap:24px' },
      h('div', { class: 'page-head', style: 'margin:0' }, h('h1', {}, '新增影片')),
      staleNotice(v, 2),
      section(1, '選擇寺廟', null, h('div', { class: 'layout' },
        h('div', { class: 'grow stack', style: 'flex:1 1 360px' }, h('label', { for: 'temple-search', class: 'small muted' }, '搜尋廟名、行政區或主祀神明'), search, count, results),
        h('div', { class: 'side', style: 'flex:1 1 420px' }, detail))),
      section(2, '上傳照片', photoCount, photoGrid, fileInput),
      section(3, '故事', null, h('div', { class: 'layout' },
        h('div', { class: 'grow stack', style: 'flex:1 1 360px' }, h('label', { for: 'story', class: 'label' }, '你想說的故事'), story, polishInstruction, h('div', {}, polishBtn)),
        h('div', { class: 'side', style: 'flex:1 1 420px' }, polishedBox)))),
    actionBar(conditions, confirmBtn));
}
