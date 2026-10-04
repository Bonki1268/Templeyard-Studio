// 生成等待動畫：粒子球（約 150 個點的球體由上往下一波波脹縮）。
// 移植自 Originkit「Particle Pulse」（https://www.originkit.dev/components/particle-pulse），
// 改為不需要 React 的 Canvas 2D 版本，拿掉拖曳旋轉；元素離開畫面後自動停止，
// 系統設定「減少動態效果」時只畫一張靜止畫面。
import { h } from './ui.js';

const TAU = Math.PI * 2;
const PERIOD = 3.6;
const SPREAD = 0.3;
const PERSPECTIVE = 3.5;
const MIN_RADIUS = 0.6;
const TILT = 0.36;

const clamp01 = x => (x < 0 ? 0 : x > 1 ? 1 : x);

// Fibonacci 球面：點分布均勻，沒有兩極聚集。
function fib(i, n) {
  const y = 1 - (i / Math.max(1, n - 1)) * 2;
  const r = Math.sqrt(Math.max(0, 1 - y * y));
  const th = 2.399963 * i;
  return [Math.cos(th) * r, y, Math.sin(th) * r];
}

function spin([x, y, z], yaw, pitch) {
  const rx = x * Math.cos(yaw) - z * Math.sin(yaw);
  let rz = x * Math.sin(yaw) + z * Math.cos(yaw);
  const ry = y * Math.cos(pitch) - rz * Math.sin(pitch);
  rz = y * Math.sin(pitch) + rz * Math.cos(pitch);
  return [rx, ry, rz];
}

// 每個點的脹縮相位依緯度延遲，波由上往下傳。
function dotsAt(t, n) {
  const out = [];
  for (let i = 0; i < n; i += 1) {
    const q = fib(i, n);
    const s = 1 + 0.13 * Math.sin(TAU * (t - 0.22 * (q[1] + 1)));
    out.push(spin([q[0] * s, q[1] * s, q[2] * s], TAU * t, TILT));
  }
  return out;
}

// 投影並由遠到近排序，近的點蓋住遠的點，看起來像有體積的球。
function project(points, size, dotScale) {
  const c = size / 2;
  const R = size * SPREAD;
  return points.map(([x, y, z]) => {
    const s = PERSPECTIVE / (PERSPECTIVE - z);
    const f = clamp01((z + 1.1) / 2.2);
    return { x: c + x * R * s, y: c + y * R * s, r: dotScale * (0.4 + 1.6 * f) * s * 0.85, a: (0.07 + 0.93 * Math.pow(f, 1.55)) * 0.9, z };
  }).sort((a, b) => a.z - b.z);
}

function dotScaleFor(size) {
  if (size <= 46) return 0.4;
  if (size <= 190) return 0.4 + ((size - 46) / 144) * 0.6;
  if (size <= 340) return 1 + ((size - 190) / 150) * 0.55;
  return 1.55;
}

// 取樣一圈的最大範圍，把球縮放到固定大小（結果依尺寸快取）。
const fitCache = new Map();
function autoFit(size, n) {
  const key = `${size}/${n}`;
  if (fitCache.has(key)) return fitCache.get(key);
  let ext = 0;
  for (let k = 0; k < 20; k += 1) {
    for (const d of project(dotsAt(k / 20, n), size, 1)) {
      if (d.a > 0.05) ext = Math.max(ext, Math.abs(d.x - size / 2) + d.r / 2, Math.abs(d.y - size / 2) + d.r / 2);
    }
  }
  const fit = ext > 1 ? Math.max(0.55, Math.min(1.7, (0.415 * size) / ext)) : 1;
  fitCache.set(key, fit);
  return fit;
}

function draw(ctx, size, t, { color, density, dotSize }) {
  const n = Math.max(24, Math.round(150 * density));
  const fit = autoFit(size, n);
  const half = size / 2;
  ctx.clearRect(0, 0, size, size);
  ctx.fillStyle = color;
  for (const d of project(dotsAt(t, n), size, dotScaleFor(size) * dotSize)) {
    let r = d.r * (0.55 + 0.45 * fit);
    let a = Math.min(1, d.a);
    if (r <= 0.05 || a <= 0.004) continue;
    // 太小的點 Canvas 會畫得太淡：放大到下限並依面積降低透明度。
    if (r < MIN_RADIUS) { a *= (r / MIN_RADIUS) ** 2; r = MIN_RADIUS; }
    ctx.globalAlpha = a;
    ctx.beginPath();
    ctx.arc(half + (d.x - half) * fit, half + (d.y - half) * fit, r, 0, TAU);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

const reducedMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

// 粒子球畫布。size 為 CSS 像素；speed 1 為一般速度（等待中可放慢）。
export function orb({ size = 96, color, speed = 1, density = 1, dotSize = 1.6 } = {}) {
  const canvas = h('canvas', { class: 'orb', width: size, height: size, 'aria-hidden': 'true', style: `width:${size}px;height:${size}px` });
  const ctx = canvas.getContext('2d');
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.round(size * dpr);
  canvas.height = Math.round(size * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const options = { color: color || getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#FF6A2B', density, dotSize };
  const still = reducedMotion();
  canvas.dataset.motion = still ? 'static' : 'live';
  if (still) { draw(ctx, size, 0.15, options); return canvas; }

  let phase = Math.random();
  let last = performance.now();
  let detachedAt = null;
  canvas.dataset.alive = '1';
  const frame = now => {
    // 不在頁面上時暫停（重繪時會短暫拿下再放回）；離開超過 2 秒就停止。
    if (!canvas.isConnected) {
      detachedAt ??= now;
      if (now - detachedAt > 2000) { canvas.dataset.alive = '0'; return; }
      requestAnimationFrame(frame);
      return;
    }
    detachedAt = null;
    phase = (phase + (Math.min(0.05, (now - last) / 1000) * speed) / PERIOD) % 1;
    last = now;
    draw(ctx, size, phase, options);
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
  return canvas;
}

// 帶文字的等待狀態：粒子球＋說明文字，role="status" 讓輔助工具讀出。
// 有 key 時重繪沿用同一個元素，輪詢更新畫面時動畫不會跳回起點。
const kept = new Map();
export function loader(label = '生成中', { size = 96, hint = '', speed = 1, testid, key, compact = false } = {}) {
  const id = key && `${key}|${label}|${size}`;
  const old = id && kept.get(id);
  if (old && old.querySelector('canvas').dataset.alive !== '0') return old;
  const ball = orb({ size, speed });
  const el = h('div', { class: `loader${compact ? ' loader-compact' : ''}`, role: 'status', 'aria-label': label, 'data-motion': ball.dataset.motion, 'data-testid': testid },
    ball,
    h('span', { class: 'loader-label' }, label),
    hint ? h('span', { class: 'loader-hint' }, hint) : null);
  if (id) kept.set(id, el);
  return el;
}
