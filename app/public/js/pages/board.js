// 四格定妝板：一張圖鎖住一個角色。角色設計步驟與角色庫共用。
import { h } from '../ui.js';

export const BOARD_PANELS = [
  ['正面・不要頭', '只鎖身體與服裝，頭交給第 4 格'],
  ['側面', '側身輪廓與厚度，轉身時不變形'],
  ['背面', '背影與走開的鏡頭有依據'],
  ['頭部特寫', '大頭像，臉佔滿一格，抓準五官'],
];

// 版本的參考圖：四格定妝板；舊版本（四張分開產生）則用定裝圖。
export const boardImage = images => images?.board || images?.costume || null;

// 定妝板圖片與四格說明；舊版本仍顯示原本的四張圖。
export function boardView(name, images) {
  if (images && !images.board && images.costume) {
    return h('div', { class: 'grid grid-4' }, [['front', '正面'], ['side', '側面'], ['back', '背面'], ['costume', '定裝圖']].map(([key, label]) =>
      h('figure', { style: 'margin:0', class: 'stack' },
        h('div', { class: 'ph', style: 'aspect-ratio:3/4;border-radius:10px' }, images[key] ? h('img', { src: images[key].url, alt: `${name} ${label}` }) : label),
        h('figcaption', { class: 'small muted' }, `${label}（舊版）`))));
  }
  return h('div', { class: 'row', style: 'gap:16px;align-items:flex-start' },
    h('div', { class: 'ph selected', style: 'flex:2 1 360px;max-width:640px;aspect-ratio:16/9;border-radius:12px' },
      images?.board ? h('img', { src: images.board.url, alt: `${name} 定妝板` }) : '定妝板'),
    h('ol', { class: 'stack', style: 'flex:1 1 220px;gap:8px;margin:0;padding-left:20px', 'data-testid': 'board-legend' },
      BOARD_PANELS.map(([title, note]) => h('li', {}, h('strong', {}, title), h('div', { class: 'small muted' }, note)))));
}
