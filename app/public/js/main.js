// 前端路由：#/、#/series/:id、#/videos/:id/:step
import { h, mount } from './ui.js';
import { homePage } from './pages/home.js';
import { seriesPage } from './pages/series.js';
import { videoPage } from './pages/video.js';

const routes = [
  [/^#?\/?$/, () => homePage()],
  [/^#\/series\/([^/]+)$/, m => seriesPage(m[1])],
  [/^#\/videos\/([^/]+)\/([2-6])$/, m => videoPage(m[1], m[2])],
];

async function render() {
  const root = document.getElementById('app');
  const hash = location.hash || '#/';
  for (const [regex, fn] of routes) {
    const m = hash.match(regex);
    if (!m) continue;
    try {
      mount(root, await fn(m));
    } catch (err) {
      mount(root, h('main', { class: 'main' }, h('p', { class: 'error' }, `載入失敗：${err.message}`), h('a', { href: '#/' }, '回首頁')));
    }
    window.scrollTo(0, 0);
    return;
  }
  mount(root, h('main', { class: 'main' }, h('p', {}, '找不到頁面'), h('a', { href: '#/' }, '回首頁')));
}

window.addEventListener('hashchange', render);
window.addEventListener('templeyard:refresh', render);
render();
