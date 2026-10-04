// 去識別：偵測人臉與車牌（座標為 0～1 比例），再用 ffmpeg 把區塊馬賽克化。
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { ffmpeg, probe, exec } = require('./ffmpeg');

const OPENCV_SCRIPT = path.join(__dirname, '..', '..', 'tools', 'detect_opencv.py');

// 假偵測器：依檔名提示決定結果（face／人臉、plate／車牌、deity／神像），結果固定。
const fakeDetector = {
  name: 'fake',
  async detect(file, { filename = '' } = {}) {
    const hint = filename.toLowerCase();
    const regions = [];
    if (/face|人臉|路人/.test(hint)) regions.push({ kind: 'face', x: 0.1, y: 0.15, w: 0.15, h: 0.25 });
    if (/deity|神像/.test(hint)) regions.push({ kind: 'face', x: 0.42, y: 0.2, w: 0.16, h: 0.25 });
    if (/plate|車牌/.test(hint)) regions.push({ kind: 'plate', x: 0.3, y: 0.7, w: 0.18, h: 0.1 });
    return regions;
  },
};

const opencvDetector = {
  name: 'opencv',
  async detect(file) {
    return JSON.parse(await exec('python3', [OPENCV_SCRIPT, file]));
  },
};

let opencvAvailable;
function hasOpenCv() {
  if (opencvAvailable === undefined) opencvAvailable = spawnSync('python3', ['-c', 'import cv2']).status === 0;
  return opencvAvailable;
}

function createDetector(kind = 'auto') {
  if (kind === 'fake') return fakeDetector;
  if (kind === 'opencv') return opencvDetector;
  if (kind === 'auto') return hasOpenCv() ? opencvDetector : fakeDetector;
  throw new Error(`不認得的偵測器「${kind}」，可用：auto、opencv、fake`);
}

async function imageSize(file) {
  const info = await probe(file);
  if (!info.width || !info.height) throw new Error('無法讀取圖片尺寸');
  return { width: info.width, height: info.height };
}

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

// regions 中 enabled !== false 的區塊會被馬賽克；沒有區塊時只轉存為 JPEG。
async function maskImage(input, output, regions) {
  const { width, height } = await imageSize(input);
  const boxes = regions.filter(r => r.enabled !== false).map(r => {
    const x = clamp(Math.round(r.x * width), 0, width - 2);
    const y = clamp(Math.round(r.y * height), 0, height - 2);
    const w = clamp(Math.round(r.w * width), 2, width - x);
    const h = clamp(Math.round(r.h * height), 2, height - y);
    return { x, y, w, h };
  });
  if (!boxes.length) {
    await ffmpeg(['-i', input, '-frames:v', '1', '-q:v', '2', output]);
    return { width, height };
  }
  const n = boxes.length;
  const parts = [`[0:v]split=${n + 1}[base]${boxes.map((_, i) => `[c${i}]`).join('')}`];
  boxes.forEach((b, i) => {
    const sw = Math.max(2, Math.round(b.w / 12));
    const sh = Math.max(2, Math.round(b.h / 12));
    parts.push(`[c${i}]crop=${b.w}:${b.h}:${b.x}:${b.y},scale=${sw}:${sh},scale=${b.w}:${b.h}:flags=neighbor[p${i}]`);
  });
  let prev = 'base';
  boxes.forEach((b, i) => {
    const out = i === n - 1 ? 'out' : `o${i}`;
    parts.push(`[${prev}][p${i}]overlay=${b.x}:${b.y}[${out}]`);
    prev = out;
  });
  await ffmpeg(['-i', input, '-filter_complex', parts.join(';'), '-map', '[out]', '-frames:v', '1', '-q:v', '2', output]);
  return { width, height };
}

module.exports = { createDetector, maskImage, imageSize, hasOpenCv };
