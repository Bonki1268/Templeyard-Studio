// 前端小工具：建立 DOM、呼叫 API、提示訊息。
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
