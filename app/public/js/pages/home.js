// 首頁：建立系列專案，並列出已建立的系列。
import { h, api, radios } from '../ui.js';

const STYLES = ['溫暖寫實・黃昏自然光', '明亮清新・白天', '紀錄片質感'];
const DIRECTIONS = ['在地歷史故事', '節慶宣傳', '景點導覽'];
const DURATIONS = [15, 20, 30];

export function choiceWithCustom(name, options, initial) {
  const isCustom = initial && !options.includes(initial);
  let choice = isCustom ? '自訂' : (initial || options[0]);
  const custom = h('input', { class: 'input', type: 'text', name: `${name}-custom`, 'aria-label': '自訂內容', placeholder: '輸入自訂內容', value: isCustom ? initial : '', style: { display: isCustom ? '' : 'none', marginTop: '8px' } });
  const el = h('div', {}, radios(name, [...options, '自訂'], choice, v => { choice = v; custom.style.display = v === '自訂' ? '' : 'none'; if (v === '自訂') custom.focus(); }), custom);
  return { el, value: () => (choice === '自訂' ? custom.value.trim() : choice) };
}

export function seriesForm({ initial = {}, submitLabel, onSubmit, withCharacter = true }) {
  const name = h('input', { id: 'series-name', class: 'input', type: 'text', value: initial.name || '', placeholder: '例如：淡水廟宇故事' });
  const style = choiceWithCustom('style', STYLES, initial.style);
  const styleNote = h('input', { id: 'style-note', class: 'input', type: 'text', value: initial.styleNote || '', placeholder: '例如：淺景深、柔和逆光，色調偏暖' });
  let duration = initial.duration || 30;
  const durationRadios = radios('duration', DURATIONS.map(d => ({ value: String(d), label: `${d} 秒` })), String(duration), v => { duration = Number(v); });
  const direction = choiceWithCustom('direction', DIRECTIONS, initial.direction);
  const charName = h('input', { id: 'char-name', class: 'input', type: 'text', placeholder: '例如：導覽員小晴' });
  const charDesc = h('textarea', { id: 'char-desc', class: 'input', placeholder: '外觀、年齡、服裝、說話方式' });
  const error = h('p', { class: 'error', role: 'alert' });
  const submit = h('button', { class: 'btn btn-primary', type: 'submit' }, submitLabel);

  const form = h('form', { class: 'card stack', style: 'gap:24px', onsubmit: async e => {
    e.preventDefault();
    error.textContent = '';
    const body = { name: name.value, style: style.value(), styleNote: styleNote.value, duration, direction: direction.value() };
    if (withCharacter && charName.value.trim()) body.characters = [{ name: charName.value, description: charDesc.value }];
    submit.disabled = true;
    try { await onSubmit(body); } catch (err) {
      error.textContent = err.data?.details ? err.data.details.map(d => d.message).join('；') : err.message;
    } finally { submit.disabled = false; }
  } },
    h('div', { class: 'field' }, h('label', { for: 'series-name' }, '系列名稱'), name),
    h('fieldset', { class: 'stack', style: 'gap:10px' }, h('legend', {}, '整體視覺風格'), style.el,
      h('label', { for: 'style-note', class: 'small muted' }, '補充描述（選填）'), styleNote),
    h('div', { class: 'row', style: 'align-items:flex-start;gap:24px' },
      h('fieldset', { style: 'flex:1 1 260px' }, h('legend', {}, '影片秒數'), durationRadios),
      h('div', { class: 'field', style: 'flex:1 1 260px' }, h('span', { class: 'label' }, '輸出規格'),
        h('p', { class: 'mono', style: 'line-height:44px' }, '16:9 · 1920×1080 · 24 fps'))),
    h('fieldset', {}, h('legend', {}, '影片方向'), direction.el),
    withCharacter && h('div', { class: 'stack', style: 'border-top:1px solid var(--line);padding-top:24px;gap:14px' },
      h('div', {}, h('div', { class: 'label' }, '共同角色（選填）'),
        h('p', { class: 'small muted' }, '現在先描述，或在第一支影片的角色設計步驟產生後，再設為系列角色。')),
      h('div', { class: 'row', style: 'align-items:flex-start;gap:16px' },
        h('div', { class: 'field', style: 'flex:1 1 200px' }, h('label', { for: 'char-name', class: 'small muted' }, '角色名稱'), charName),
        h('div', { class: 'field', style: 'flex:3 1 320px' }, h('label', { for: 'char-desc', class: 'small muted' }, '外觀描述'), charDesc))),
    error,
    h('div', { class: 'row', style: 'justify-content:flex-end' }, submit),
  );
  return form;
}

export async function homePage() {
  const { series } = await api('GET', '/api/series');
  return h('main', { class: 'main' },
    h('div', { class: 'page-head' }, h('div', {},
      h('h1', {}, '建立新的系列專案'),
      h('p', { style: 'max-width:680px' }, '先設定這個系列共用的風格、秒數、方向與角色。之後每支影片都沿用這些設定，只需要選一間寺廟、上傳照片與故事。'))),
    h('div', { class: 'layout' },
      h('div', { class: 'grow' }, seriesForm({
        submitLabel: '建立系列',
        onSubmit: async body => {
          const { series: created } = await api('POST', '/api/series', body);
          location.hash = `#/series/${created.id}`;
        },
      })),
      h('section', { class: 'side stack', 'aria-labelledby': 'existing', style: 'gap:14px' },
        h('h2', { id: 'existing' }, '已建立的系列'),
        series.length ? series.map(s => h('a', { class: 'listcard', href: `#/series/${s.id}`, 'data-testid': 'series-item' },
          h('span', { class: 'ph', style: 'width:96px;height:54px;border-radius:8px;flex:none;font-size:12px' },
            s.coverUrl ? h('img', { src: s.coverUrl, alt: '' }) : '封面'),
          h('span', { class: 'stack', style: 'gap:4px;min-width:0' },
            h('span', { style: 'font-size:16px;font-weight:500' }, s.name),
            h('span', { class: 'small muted' }, `${s.videoCount ? `${s.videoCount} 支影片` : '尚無影片'}・${s.duration} 秒・${s.direction}`))))
          : h('p', { class: 'muted small' }, '還沒有系列，先在左邊建立一個。'))));
}
