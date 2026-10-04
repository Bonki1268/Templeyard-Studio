// 系列頁：系列設定、系列角色、影片列表、新增影片。
import { h, api, formatDate, toast } from '../ui.js';
import { seriesForm } from './home.js';

const STEP_NAMES = { 1: '系列設定', 2: '新增影片', 3: '寺廟背景板', 4: '故事腳本', 5: '角色設計', 6: '精緻圖', 7: '影片生成' };

function videoBadge(v) {
  if (v.status === 'done') return h('span', { class: 'badge badge-ok' }, '已完成');
  return h('span', { class: 'badge badge-accent' }, `步驟 ${v.currentStep}／7 ${STEP_NAMES[v.currentStep] || ''}`);
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

  // 系列角色只列名稱預覽；新增、刪除、定妝板都在角色庫。
  const characters = h('section', { class: 'card stack', 'aria-labelledby': 'chars-title' },
    h('div', { class: 'row', style: 'justify-content:space-between' }, h('h2', { id: 'chars-title' }, '系列角色'),
      h('a', { class: 'btn btn-sm', href: `#/series/${id}/characters` }, '角色庫 ›')),
    series.characters.length
      ? h('ul', { class: 'row', style: 'gap:8px;list-style:none;margin:0;padding:0' },
        series.characters.map(c => h('li', { class: 'badge', 'data-testid': 'series-character' }, c.name)))
      : h('p', { class: 'small muted', style: 'margin:0' }, '還沒有系列角色，到角色庫新增。'));

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
        videos.length ? videos.map(v => h('a', { class: 'listcard', href: `#/videos/${v.id}/${v.status === 'done' ? 7 : v.currentStep}`, 'data-testid': 'video-item' },
          h('span', { class: 'ph', style: 'width:160px;height:90px;border-radius:8px;flex:none' }, v.status === 'done' ? '成品' : `步驟 ${v.currentStep}`),
          h('span', { class: 'stack', style: 'gap:4px;flex:1;min-width:0' },
            h('span', { style: 'font-size:17px' }, v.title || '未命名影片'),
            h('span', { class: 'small muted' }, v.temple ? `${v.temple.label}・${v.temple.district || ''}・${v.temple.deity || ''}` : '尚未選擇寺廟')),
          h('span', { class: 'stack', style: 'align-items:flex-end;gap:6px' }, videoBadge(v), h('span', { class: 'small muted' }, formatDate(v.updatedAt)))))
          : h('p', { class: 'muted' }, '這個系列還沒有影片，按「新增影片」開始。'))));
}
