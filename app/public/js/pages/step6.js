// 步驟 6：精緻圖模擬。分鏡膠捲逐格顯示進度，完成一格就填上一格。
import { h, api, toast, money, setBusy } from '../ui.js';
import { withConsent, actionBar, staleNotice } from './video.js';
import { loader } from '../loader.js';

const QUALITY = [
  ['face', '角色臉、髮型、服裝與定妝板一致'],
  ['temple', '廟宇建築與照片一致'],
  ['hands', '手部與畫面中的文字沒有變形'],
  ['people', '沒有可辨識的真實民眾'],
];

export async function render({ video, refreshCost }) {
  const base = `/api/videos/${video.id}`;
  let v = video;
  let current = v.script.shots[0]?.id;
  const root = h('div');
  let polling = false;

  const busy = () => v.script.shots.some(s => ['queued', 'running'].includes(v.frames[s.id]?.status));
  async function poll() {
    if (polling) return;
    polling = true;
    while (root.isConnected && busy()) {
      await new Promise(r => setTimeout(r, 600));
      if (!root.isConnected) break;
      v = { ...(await api('GET', base)).video, viewStep: 6 };
      await draw();
    }
    polling = false;
    refreshCost();
  }

  async function run(button, fn) {
    setBusy(button, true);
    try {
      const r = await withConsent(fn);
      v = { ...r.video, viewStep: 6 };
      await draw();
      poll();
    } catch (err) {
      if (err.code !== 'cancelled') toast(err.message);
    } finally { setBusy(button, false); }
  }

  function strip() {
    return h('div', { class: 'filmstrip', style: 'display:grid;grid-template-columns:repeat(auto-fill,minmax(120px,1fr));gap:12px', role: 'list', 'aria-label': '分鏡膠捲' },
      v.script.shots.map(s => {
        const f = v.frames[s.id] || {};
        const sel = f.candidates?.find(c => c.id === f.selected);
        const inner = sel ? h('img', { src: sel.url, alt: `第 ${s.index} 格精緻圖` })
          : f.status === 'running' ? loader('生成中', { size: 34, compact: true, key: `frame-${s.id}` })
          : f.status === 'queued' ? loader('等待中', { size: 34, compact: true, speed: 0.35, key: `frame-${s.id}` })
          : f.status === 'failed' ? h('span', { style: 'color:var(--danger)' }, '失敗') : String(s.index);
        return h('button', { role: 'listitem', 'data-testid': 'strip-frame', style: 'background:none;border:0;padding:0;cursor:pointer;text-align:left;font:inherit', onclick: () => { current = s.id; draw(); } },
          h('div', { class: `ph${s.id === current ? ' selected' : ''}`, style: `aspect-ratio:16/9;border-radius:8px;${sel ? '' : 'border:1px dashed var(--line-strong);background:var(--panel-2)'}` }, inner),
          h('span', { class: 'small muted', style: 'display:block;margin-top:6px' }, `第 ${s.index} 格・${s.shotSize}`));
      }));
  }

  function detail() {
    const shot = v.script.shots.find(s => s.id === current) || v.script.shots[0];
    const f = v.frames[shot.id] || { candidates: [], quality: {} };
    const sel = f.candidates.find(c => c.id === f.selected);
    const instruction = h('input', { id: 'frame-instruction', class: 'input', placeholder: '例如：光線再暖一點，小晴往畫面左邊站' });
    const regen = (label, withInstruction) => {
      const b = h('button', { class: 'btn', onclick: () => run(b, consent => api('POST', `${base}/frames/${shot.id}/regenerate`, { instruction: withInstruction ? instruction.value : '', consent })) }, label);
      return b;
    };
    return h('section', { class: 'card stack', style: 'gap:14px' },
      h('div', { class: 'row', style: 'justify-content:space-between' }, h('h2', {}, `第 ${shot.index} 格：${shot.action}`),
        h('span', { class: 'small muted' }, `${shot.shotSize}${shot.photoIndex ? `・照片 ${shot.photoIndex}` : ''}・${shot.seconds} 秒`)),
      h('div', { class: 'ph', style: 'aspect-ratio:16/9;border-radius:12px' },
        sel ? h('img', { src: sel.url, alt: `第 ${shot.index} 格精緻圖（1920×1080）` })
          : f.status === 'running' ? loader('精緻圖生成中', { size: 120, key: `frame-detail-${shot.id}` })
          : f.status === 'queued' ? loader('等待生成', { size: 120, speed: 0.35, key: `frame-detail-${shot.id}` })
          : f.status === 'failed' ? `生成失敗：${f.error}` : '精緻圖（1920×1080）'),
      f.candidates.length ? h('div', { class: 'stack', style: 'gap:8px' }, h('span', { class: 'label' }, '候選版本'),
        h('div', { class: 'row' }, f.candidates.map((c, i) => h('button', {
          class: `btn btn-sm${c.id === f.selected ? ' selected' : ''}`, 'data-testid': 'candidate',
          onclick: () => run(null, () => api('PATCH', `${base}/frames/${shot.id}`, { selected: c.id })),
        }, `版本 ${i + 1}${c.id === f.selected ? '・已選' : ''}`)))) : null,
      h('div', { class: 'field' }, h('label', { for: 'frame-instruction' }, '調整指令'),
        h('div', { class: 'row', style: 'flex-wrap:nowrap' }, instruction, regen('依指令重生', true), regen('直接重生', false))));
  }

  function qualityCard() {
    const shot = v.script.shots.find(s => s.id === current) || v.script.shots[0];
    const f = v.frames[shot.id];
    const saved = h('span', { class: 'small', style: 'color:var(--ok);visibility:hidden', 'data-testid': 'quality-saved' }, '✓ 已儲存');
    return h('section', { class: 'card stack' }, h('h2', {}, '品質檢查'), h('p', { class: 'small muted' }, '逐項確認，不合格就重生這一格。'),
      QUALITY.map(([key, label]) => h('label', { class: 'check' }, h('input', {
        type: 'checkbox', checked: Boolean(f?.quality?.[key]), disabled: !f?.candidates?.length,
        onchange: async e => {
          try {
            const r = await api('PATCH', `${base}/frames/${shot.id}`, { quality: { [key]: e.target.checked } });
            v = { ...r.video, viewStep: 6 };
            saved.style.visibility = 'visible';
          } catch (err) { toast(err.message); }
        },
      }), label)), saved);
  }

  async function draw() {
    const anyFrames = v.script.shots.some(s => v.frames[s.id]);
    if (!anyFrames) {
      const est = await api('GET', `${base}/estimate/frames`);
      const btn = h('button', { class: 'btn btn-primary', onclick: () => run(btn, consent => api('POST', `${base}/frames/generate`, { consent })) }, `產生精緻圖（預估 ${money(est.estimate)}）`);
      root.replaceChildren(h('main', { class: 'main stack', style: 'gap:20px' }, h('h1', {}, '精緻圖模擬'), staleNotice(v, 5),
        h('div', { class: 'card stack' }, h('p', {}, `以你的照片為場景、定妝板為角色，為 ${est.count} 格分鏡逐格產生精緻圖。`), h('div', {}, btn))),
        actionBar(h('a', { class: 'btn', href: `#/videos/${v.id}/5` }, '上一步'), h('span')));
      return;
    }
    const p = { total: v.script.shots.length, done: 0, running: 0, failed: 0 };
    for (const s of v.script.shots) { const st = v.frames[s.id]?.status; if (st === 'done') p.done++; if (st === 'running' || st === 'queued') p.running++; if (st === 'failed') p.failed++; }
    const missing = v.script.shots.filter(s => !v.frames[s.id]?.selected).length;
    const retryAll = p.failed || (missing && !p.running)
      ? h('button', { class: 'btn btn-sm', onclick: e => run(e.target, consent => api('POST', `${base}/frames/generate`, { consent })) }, '產生缺少的格子') : null;
    const confirmBtn = h('button', { class: 'btn btn-primary', disabled: missing > 0, onclick: async () => {
      try { await api('POST', `${base}/steps/6/confirm`); location.hash = `#/videos/${v.id}/7`; } catch (err) { toast(err.message); }
    } }, '確認精緻圖，生成影片');
    root.replaceChildren(
      h('main', { class: 'main stack', style: 'gap:20px' },
        h('div', { class: 'page-head', style: 'margin:0' },
          h('div', {}, h('h1', {}, '精緻圖模擬'), h('p', {}, '以你的照片為場景、定妝板為角色，逐格產生；完成一格就填上一格。')),
          h('div', { class: 'row' }, h('span', { 'data-testid': 'progress' }, `${p.done}／${p.total} 格完成${p.running ? `・${p.running} 格生成中` : ''}${p.failed ? `・${p.failed} 格失敗` : ''}`), retryAll)),
        staleNotice(v, 5),
        strip(),
        h('div', { class: 'layout' }, h('div', { class: 'grow' }, detail()), h('div', { class: 'side' }, qualityCard()))),
      actionBar(h('a', { class: 'btn', href: `#/videos/${v.id}/5` }, '上一步'),
        h('div', { class: 'row' }, h('span', { class: 'small muted' }, missing ? `還有 ${missing} 格沒有精緻圖` : `${p.total} 格都已選定精緻圖`), confirmBtn)));
  }

  await draw();
  poll();
  return root;
}
