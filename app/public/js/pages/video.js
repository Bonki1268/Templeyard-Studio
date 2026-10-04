// 影片頁外框：麵包屑、步驟列、費用，並依步驟載入內容。
import { h, api, money, ApiError } from '../ui.js';

export const STEP_NAMES = { 1: '系列設定', 2: '新增影片', 3: '故事腳本', 4: '角色設計', 5: '精緻圖', 6: '影片生成' };

const stepModules = {
  2: () => import('./step2.js'),
  3: () => import('./step3.js'),
  4: () => import('./step4.js'),
  5: () => import('./step5.js'),
  6: () => import('./step6.js'),
};

// 付費生成前的再次同意：伺服器回 402 時顯示費用與原因，同意後帶 consent 重送。
export async function withConsent(run) {
  try {
    return await run(false);
  } catch (err) {
    if (!(err instanceof ApiError) || err.code !== 'cost_consent_required') throw err;
    const ok = await confirmDialog(err.message, `預估費用 ${money(err.data.estimate)}・已用 ${money(err.data.spent)}／上限 ${money(err.data.cap)}`);
    if (!ok) throw new ApiError(0, { code: 'cancelled', message: '已取消生成' });
    return run(true);
  }
}

export function confirmDialog(title, detail) {
  return new Promise(resolve => {
    const close = v => { back.remove(); resolve(v); };
    const back = h('div', { class: 'modal-back' }, h('div', { class: 'modal', role: 'dialog', 'aria-label': '費用確認' },
      h('h2', {}, '需要再次同意費用'), h('p', {}, title), detail ? h('p', { class: 'small muted' }, detail) : null,
      h('div', { class: 'row', style: 'justify-content:flex-end' },
        h('button', { class: 'btn', onclick: () => close(false) }, '取消'),
        h('button', { class: 'btn btn-primary', onclick: () => close(true) }, '同意並繼續'))));
    document.body.append(back);
  });
}

function stepper(video) {
  const items = [1, 2, 3, 4, 5, 6].map(n => {
    const st = video.steps[n]?.status;
    const reachable = n === 1 || [2, 3, 4, 5, 6].filter(s => s < n).every(s => video.steps[s].status === 'confirmed');
    const cls = n === video.viewStep ? 'current' : st === 'confirmed' ? 'done' : st === 'stale' ? 'stale' : '';
    const dot = h('span', { class: 'dot' }, st === 'confirmed' && n !== video.viewStep ? '✓' : String(n));
    const label = [dot, STEP_NAMES[n], st === 'stale' ? h('span', { class: 'badge badge-warn' }, '需重新確認') : null];
    const href = n === 1 ? `#/series/${video.seriesId}` : `#/videos/${video.id}/${n}`;
    return h('li', { class: cls, 'aria-current': n === video.viewStep ? 'step' : null },
      reachable ? h('a', { href }, label) : h('span', { style: 'display:flex;align-items:center;gap:8px;opacity:.7' }, label));
  });
  return h('ol', { class: 'stepper', 'aria-label': '製作步驟' }, items);
}

export async function videoPage(id, step) {
  step = Number(step);
  const { video, cost } = await api('GET', `/api/videos/${id}`);
  video.viewStep = step;
  const costEl = h('span', { class: 'small muted mono', 'data-testid': 'cost' });
  const setCost = c => { costEl.textContent = `本支影片費用 ${money(c.spent)}${c.reserved ? `（預留 ${money(c.reserved)}）` : ''} ／ 上限 ${money(c.cap)}`; };
  setCost(cost);
  const title = video.title || (video.temple ? `${video.temple.label}` : '新影片');
  const header = h('div', { class: 'subbar' }, h('div', { class: 'subbar-inner' },
    h('div', { class: 'row', style: 'justify-content:space-between' },
      h('nav', { class: 'crumbs' }, h('a', { href: '#/' }, '首頁'), ' › ', h('a', { href: `#/series/${video.seriesId}` }, video.series.name), ' › ', title),
      costEl),
    stepper(video)));

  const blocked = [2, 3, 4, 5, 6].find(s => s < step && video.steps[s].status !== 'confirmed');
  let body;
  if (blocked) {
    body = h('main', { class: 'main' }, h('p', { class: 'notice' }, `請先確認步驟 ${blocked}「${STEP_NAMES[blocked]}」。`),
      h('p', {}, h('a', { href: `#/videos/${id}/${blocked}` }, `前往步驟 ${blocked}`)));
  } else {
    const mod = await stepModules[step]().catch(() => null);
    const refreshCost = async () => setCost((await api('GET', `/api/videos/${id}/cost`)).cost);
    body = mod ? await mod.render({ video, refreshCost, reload: () => window.dispatchEvent(new Event('templeyard:refresh')) })
      : h('main', { class: 'main' }, h('p', {}, `步驟 ${step}「${STEP_NAMES[step]}」尚未完成。`));
  }
  return h('div', {}, header, body);
}

export function actionBar(...children) {
  return h('div', { class: 'actionbar' }, h('div', { class: 'actionbar-inner' }, children));
}

export function staleNotice(video, step) {
  return video.steps[step]?.status === 'stale'
    ? h('p', { class: 'notice', style: 'margin-bottom:16px' }, '前面的步驟已修改，這一步的內容需要重新確認。')
    : null;
}
