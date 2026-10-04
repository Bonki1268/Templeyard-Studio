// 前端小工具：建立 DOM、呼叫 API、提示訊息、忙碌狀態。
import { orb, loader } from './loader.js';

export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'class') el.className = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k === 'value') el.value = v;
    else if (k === 'checked' || k === 'disabled' || k === 'selected') el[k] = Boolean(v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  append(el, children);
  return el;
}

function append(el, children) {
  for (const c of children.flat(Infinity)) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
}

export function mount(target, ...children) {
  target.replaceChildren();
  append(target, children);
}

export class ApiError extends Error {
  constructor(status, error) {
    super(error?.message || `HTTP ${status}`);
    this.status = status;
    this.code = error?.code;
    this.data = error;
  }
}

export async function api(method, url, body) {
  const init = { method, headers: {} };
  if (body instanceof Blob) { init.body = body; init.headers['Content-Type'] = body.type || 'application/octet-stream'; }
  else if (body !== undefined) { init.body = JSON.stringify(body); init.headers['Content-Type'] = 'application/json'; }
  const res = await fetch(url, init);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, data.error);
  return data;
}

export function toast(message) {
  const el = h('div', { class: 'toast', role: 'status' }, message);
  document.body.append(el);
  setTimeout(() => el.remove(), 2500);
}

export function radios(name, options, selected, onChange) {
  return h('div', { class: 'row', style: 'gap:8px' }, options.map(o => {
    const value = typeof o === 'string' ? o : o.value;
    const label = typeof o === 'string' ? o : o.label;
    return h('label', { class: 'opt' },
      h('input', { type: 'radio', name, value, checked: value === selected, onchange: () => onChange?.(value) }), label);
  }));
}

export function formatDate(iso) {
  const d = new Date(iso);
  return `${d.getMonth() + 1} 月 ${d.getDate()} 日`;
}

export function money(n) { return `US$${Number(n || 0).toFixed(2)}`; }

// 忙碌狀態：按鈕停用並加上小粒子球；生成類的動作（產生、生成、合成、潤飾、試聽、AI）
// 超過 0.4 秒時，畫面中央再顯示「生成中」的粒子動畫。按鈕離開畫面（例如換頁）時自動收掉。
const GENERATING = /產生|生成|合成|潤飾|試聽|AI/;
const busyButtons = new Set();
let overlay = null;
let watcher = null;

const label = button => button.textContent.replace(/（[^）]*）/g, '').trim();

function syncOverlay() {
  for (const b of busyButtons) if (!b.isConnected) busyButtons.delete(b);
  const waiting = [...busyButtons].filter(b => b.dataset.busyOverlay === 'shown');
  if (!waiting.length) {
    overlay?.remove(); overlay = null;
    if (!busyButtons.size) { clearInterval(watcher); watcher = null; }
    return;
  }
  if (overlay) return;
  overlay = h('div', { class: 'busy-overlay', 'data-testid': 'busy-overlay' },
    h('div', { class: 'busy-card' }, loader('生成中', { size: 132, hint: `正在${label(waiting[0])}。使用真實服務時約需數十秒，請稍候。` })));
  document.body.append(overlay);
}

export function setBusy(button, on) {
  if (!button) return;
  if (on) {
    button.disabled = true;
    button.setAttribute('aria-busy', 'true');
    if (!button.querySelector('.btn-orb')) { const mini = orb({ size: 18, dotSize: 1.1, density: 0.6 }); mini.classList.add('btn-orb'); button.prepend(mini); }
    busyButtons.add(button);
    if (GENERATING.test(label(button)) && !/^確認/.test(label(button))) {
      button.dataset.busyOverlay = 'pending';
      setTimeout(() => { if (busyButtons.has(button) && button.dataset.busyOverlay === 'pending') { button.dataset.busyOverlay = 'shown'; syncOverlay(); } }, 400);
    }
    watcher ??= setInterval(syncOverlay, 500);
  } else {
    button.disabled = false;
    button.removeAttribute('aria-busy');
    button.querySelector('.btn-orb')?.remove();
    delete button.dataset.busyOverlay;
    busyButtons.delete(button);
    syncOverlay();
  }
}
