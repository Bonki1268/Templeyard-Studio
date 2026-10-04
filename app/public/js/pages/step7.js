// 步驟 7：影片生成（分鏡影片、聲音與字幕、成品合成、確認與下載）。
import { h, api, toast, money } from '../ui.js';
import { withConsent, actionBar, staleNotice } from './video.js';

const CLIP_QUALITY = [['face', '角色沒有變臉'], ['lipsync', '台詞口型對得上'], ['hands', '手部與文字沒有變形'], ['temple', '廟宇建築與照片一致']];
const FINAL_QUALITY = [['face', '每格角色都沒有變臉'], ['lipsync', '台詞口型對得上'], ['subtitles', '字幕與台詞一致'], ['duration', '總長度 30 秒以內']];
const STATUS = { done: '已完成', running: '生成中', queued: '等待中', failed: '失敗', idle: '未生成' };

const fmt = sec => `${String(Math.floor(sec / 60)).padStart(2, '0')}:${(sec % 60).toFixed(1).padStart(4, '0')}`;

export async function render({ video, refreshCost }) {
  const base = `/api/videos/${video.id}`;
  let v = video;
  let current = v.script.shots[0]?.id;
  let tracks = (await api('GET', `${base}/music`)).tracks;
  let subs = await api('GET', `${base}/subtitles`); // 字幕樣式選項與每格排版後的段落
  const root = h('div');
  let polling = false;

  const busy = () => v.script.shots.some(s => ['queued', 'running'].includes(v.clips[s.id]?.status)) || v.final?.status === 'composing';
  async function poll() {
    if (polling) return;
    polling = true;
    while (root.isConnected && busy()) {
      await new Promise(r => setTimeout(r, 600));
      if (!root.isConnected) break;
      v = { ...(await api('GET', base)).video, viewStep: 7 };
      await draw();
    }
    polling = false;
    refreshCost();
  }

  async function run(button, fn) {
    if (button) button.disabled = true;
    try {
      const r = await withConsent(fn);
      if (r.video) v = { ...r.video, viewStep: 7 };
      if (r.track) tracks = (await api('GET', `${base}/music`)).tracks;
      await draw();
      poll();
      refreshCost();
    } catch (err) {
      if (err.code !== 'cancelled') toast(err.message);
    } finally { if (button) button.disabled = false; }
  }

  const selectedClip = shot => { const c = v.clips[shot.id]; return c?.versions.find(x => x.id === c.selected); };

  function preview() {
    const shot = v.script.shots.find(s => s.id === current);
    const final = v.final?.status === 'done' && !v.final.stale ? v.final : null;
    const clip = shot && selectedClip(shot);
    const src = final ? final.url : clip?.url;
    return h('div', { class: 'stack', 'data-testid': 'preview' },
      h('div', { style: 'position:relative;background:var(--ink);border-radius:16px;aspect-ratio:16/9;overflow:hidden;display:flex;align-items:center;justify-content:center;color:#C9CDD3' },
        src ? h('video', { src, controls: true, style: 'width:100%;height:100%', preload: 'metadata' }) : '成品預覽',
        !final && clip && subs.segments[shot.id]?.length && v.audio?.subtitles !== false
          ? h('div', { class: `sub-preview sub-${subs.resolved}`, 'data-testid': 'subtitle-preview' }, h('span', {}, subs.segments[shot.id][0])) : null),
      h('p', { class: 'small muted', 'data-testid': 'final-info' },
        final ? `成品 ${fmt(final.duration)}・${final.width}×${final.height}・${Math.round(final.fps)} fps`
          : v.final?.status === 'composing' ? '成品合成中…'
          : v.final?.status === 'failed' ? `合成失敗：${v.final.error}`
          : v.final?.stale ? '分鏡或聲音設定已變更，請重新合成成品' : `正在預覽第 ${shot?.index ?? ''} 格`));
  }

  function clipGrid() {
    return h('div', { class: 'grid', style: 'grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:12px' }, v.script.shots.map(s => {
      const c = v.clips[s.id];
      const st = c?.status || 'idle';
      const frame = v.frames[s.id]?.candidates.find(x => x.id === v.frames[s.id].selected);
      return h('button', { class: `card${s.id === current ? ' selected' : ''}`, 'data-testid': 'clip', style: 'padding:8px;cursor:pointer;text-align:left;font:inherit', onclick: () => { current = s.id; draw(); } },
        h('div', { class: 'ph', style: 'aspect-ratio:16/9;border-radius:8px' }, frame ? h('img', { src: frame.url, alt: '' }) : `第 ${s.index} 格`),
        h('div', { class: 'row small', style: 'justify-content:space-between;margin-top:6px' }, h('span', {}, `${s.seconds}s`),
          h('span', { style: { color: st === 'failed' ? 'var(--accent)' : st === 'done' ? 'var(--ok)' : 'var(--muted)' } }, STATUS[st])));
    }));
  }

  function shotPanel() {
    const shot = v.script.shots.find(s => s.id === current);
    if (!shot) return null;
    const c = v.clips[shot.id];
    const instruction = h('input', { id: 'clip-instruction', class: 'input', placeholder: '例如：轉頭的動作慢一點，口型對準台詞' });
    const lockLast = h('input', { type: 'checkbox' });
    const regen = (label, withInstruction) => {
      const b = h('button', { class: 'btn', onclick: () => run(b, consent => api('POST', `${base}/clips/${shot.id}/regenerate`, {
        instruction: withInstruction ? instruction.value : '', lockLastFrame: lockLast.checked, consent })) }, label);
      return b;
    };
    return h('section', { class: 'card stack' },
      h('div', { class: 'row', style: 'justify-content:space-between' }, h('strong', {}, `第 ${shot.index} 格・${shot.shotSize}・${shot.seconds} 秒`),
        c?.versions.length ? h('div', { class: 'row', style: 'gap:6px' }, c.versions.map((x, i) => h('button', {
          class: `btn btn-sm${x.id === c.selected ? ' btn-primary' : ''}`, 'aria-pressed': String(x.id === c.selected),
          onclick: () => run(null, () => api('PATCH', `${base}/clips/${shot.id}`, { selected: x.id })),
        }, `v${i + 1}`))) : null),
      c?.status === 'failed' ? h('p', { class: 'error' }, `生成失敗：${c.error}`) : null,
      h('label', { for: 'clip-instruction', class: 'label' }, `第 ${shot.index} 格的調整指令`),
      h('div', { class: 'row', style: 'flex-wrap:nowrap' }, instruction, regen('依指令重生', true), regen('直接重生', false)),
      h('label', { class: 'check small' }, lockLast, '精緻圖同時作為末格（鎖定首尾畫格）'),
      c?.versions.length ? h('div', { class: 'row small', style: 'gap:16px' }, CLIP_QUALITY.map(([k, label]) => h('label', { class: 'check small' },
        h('input', { type: 'checkbox', checked: Boolean(c.quality?.[k]), onchange: e => run(null, () => api('PATCH', `${base}/clips/${shot.id}`, { quality: { [k]: e.target.checked } })) }), label))) : null);
  }

  async function sidePanel() {
    const audio = v.audio || {};
    const music = h('select', { id: 'music', class: 'input', onchange: e => run(null, () => api('PUT', `${base}/audio`, { music: e.target.value })) },
      tracks.map(t => h('option', { value: t.id, selected: t.id === audio.music }, t.uploaded ? `${t.name}（上傳）` : t.name)));
    const upload = h('input', { type: 'file', accept: 'audio/mpeg,audio/mp4,audio/x-m4a,audio/aac,audio/wav', style: 'display:none', onchange: async e => {
      const file = e.target.files[0];
      if (!file) return;
      await run(null, async () => {
        const res = await fetch(`${base}/music`, { method: 'POST', headers: { 'Content-Type': file.type, 'X-Filename': encodeURIComponent(file.name) }, body: file });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error?.message);
        return data;
      });
    } });
    const styleLabel = id => subs.styles.find(x => x.id === id)?.label || id;
    const subtitleStyle = h('select', { id: 'subtitle-style', class: 'input', disabled: audio.subtitles === false,
      onchange: e => run(null, () => api('PUT', `${base}/audio`, { subtitleStyle: e.target.value })) },
      h('option', { value: 'auto', selected: subs.current === 'auto' }, `自動（依系列風格：${styleLabel(subs.auto)}）`),
      subs.styles.map(x => h('option', { value: x.id, selected: subs.current === x.id }, x.label)));
    const voice = (value, label) => h('label', { class: 'opt', style: 'width:100%' },
      h('input', { type: 'radio', name: 'voiceMode', value, checked: (audio.voiceMode || 'native') === value, onchange: () => run(null, () => api('PUT', `${base}/audio`, { voiceMode: value })) }), label);
    const allClips = v.script.shots.every(s => selectedClip(s));
    const est = allClips ? await api('GET', `${base}/estimate/compose`) : null;
    const composeBtn = h('button', { class: 'btn btn-primary', disabled: !allClips || v.final?.status === 'composing', onclick: () => run(composeBtn, consent => api('POST', `${base}/compose`, { consent })) },
      `合成成品${est ? `（預估 ${money(est.estimate)}）` : ''}`);
    const final = v.final?.status === 'done' ? v.final : null;
    return h('div', { class: 'stack', style: 'gap:16px' },
      h('section', { class: 'card stack' }, h('h2', {}, '聲音與字幕'),
        h('span', { class: 'small muted' }, '台詞語音'), voice('native', '模型原生語音，對上口型'), voice('tts', '語音合成（旁白）'),
        h('label', { for: 'music', class: 'small muted' }, '背景音樂'), music,
        h('button', { class: 'btn btn-sm', style: 'align-self:flex-start', onclick: () => upload.click() }, '上傳自己的音樂'), upload,
        h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: audio.subtitles !== false, onchange: e => run(null, () => api('PUT', `${base}/audio`, { subtitles: e.target.checked })) }), '燒錄繁中字幕（下方置中、白字）'),
        h('label', { for: 'subtitle-style', class: 'small muted' }, '字幕樣式'), subtitleStyle,
        composeBtn),
      h('section', { class: 'card stack' }, h('h2', {}, '成品檢查'),
        FINAL_QUALITY.map(([k, label]) => h('label', { class: 'check' }, h('input', { type: 'checkbox', disabled: !final, checked: Boolean(final?.quality?.[k]),
          onchange: e => run(null, () => api('PATCH', `${base}/final`, { quality: { [k]: e.target.checked } })) }), label))));
  }

  async function draw() {
    subs = await api('GET', `${base}/subtitles`);
    const anyClips = v.script.shots.some(s => v.clips[s.id]);
    if (!anyClips) {
      const est = await api('GET', `${base}/estimate/clips`);
      const btn = h('button', { class: 'btn btn-primary', onclick: () => run(btn, consent => api('POST', `${base}/clips/generate`, { consent })) }, `生成分鏡影片（預估 ${money(est.estimate)}）`);
      root.replaceChildren(h('main', { class: 'main stack', style: 'gap:20px' }, h('h1', {}, '影片生成'), staleNotice(v, 6),
        h('div', { class: 'card stack' }, h('p', {}, `每格以確認的精緻圖作為首格生成分鏡影片（共 ${est.count} 格、${est.seconds} 秒），再加上台詞、背景音樂與字幕。`), h('div', {}, btn))),
        actionBar(h('a', { class: 'btn', href: `#/videos/${v.id}/6` }, '上一步'), h('span')));
      return;
    }
    const total = v.script.shots.reduce((s, x) => s + Number(x.seconds), 0);
    const confirmed = v.steps[7].status === 'confirmed';
    const finalReady = v.final?.status === 'done' && !v.final.stale;
    const missing = v.script.shots.filter(s => !selectedClip(s)).length;
    const confirmBtn = h('button', { class: 'btn', disabled: confirmed || !finalReady, onclick: async () => {
      try { v = { ...(await api('POST', `${base}/steps/7/confirm`)).video, viewStep: 7 }; toast('已確認成品，可以下載了'); await draw(); } catch (err) { toast(err.message); }
    } }, confirmed ? '已確認成品' : '確認成品');
    const download = confirmed
      ? h('a', { class: 'btn btn-primary', href: `${base}/download`, download: '' }, '下載 MP4')
      : h('span', { class: 'btn btn-primary', 'aria-disabled': 'true', style: 'opacity:.5;cursor:not-allowed', title: '確認成品後才能下載' }, '下載 MP4');
    root.replaceChildren(
      h('main', { class: 'main' },
        h('div', { class: 'page-head' },
          h('div', {}, h('h1', {}, '影片生成'), h('p', {}, '每格以確認的精緻圖作為首格生成分鏡影片，再加上台詞、背景音樂與字幕。')),
          h('span', { class: 'mono small' }, `${fmt(total)} · ${v.series.output.width}×${v.series.output.height} · ${v.series.output.fps} fps`)),
        staleNotice(v, 6),
        h('div', { class: 'layout' },
          h('div', { class: 'grow stack', style: 'gap:16px' }, preview(), clipGrid(),
            missing && !busy() ? h('button', { class: 'btn btn-sm', style: 'align-self:flex-start', onclick: e => run(e.target, consent => api('POST', `${base}/clips/generate`, { consent })) }, '生成缺少的格子') : null,
            shotPanel()),
          h('div', { class: 'side' }, await sidePanel()))),
      actionBar(h('a', { class: 'btn', href: `#/videos/${v.id}/6` }, '上一步'),
        h('div', { class: 'row' }, h('span', { class: 'small muted' }, confirmed ? '✓ 影片已完成' : finalReady ? '確認成品後可以下載' : '合成成品後才能確認'), confirmBtn, download)));
  }

  await draw();
  poll();
  return root;
}
