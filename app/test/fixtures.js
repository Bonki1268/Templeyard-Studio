// 測試用圖片：用 ffmpeg 的測試畫面產生，不需要真實照片。
const fs = require('node:fs');
const path = require('node:path');
const { ffmpeg, exec } = require('../src/media/ffmpeg');
const { tempDir } = require('./helpers');

async function makeImage(name = 'photo.jpg', { width = 640, height = 360 } = {}) {
  const file = path.join(tempDir('img-'), name);
  // 8px 棋盤格：任何被馬賽克的區塊都會明顯變成灰色。
  await ffmpeg(['-f', 'lavfi', '-i', `color=c=black:s=${width}x${height}`, '-vf',
    "format=yuv444p,geq=lum='if(mod(floor(X/8)+floor(Y/8),2),220,30)':cb=128:cr=128", '-frames:v', '1', '-q:v', '2', file]);
  return { file, buffer: fs.readFileSync(file) };
}

// 讀出 RGB 像素，用來比較遮蔽前後。
async function rgb(file, width, height) {
  const out = await new Promise((resolve, reject) => {
    const { spawn } = require('node:child_process');
    const p = spawn('ffmpeg', ['-v', 'error', '-i', file, '-vf', `scale=${width}:${height}`, '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-']);
    const chunks = [];
    p.stdout.on('data', d => chunks.push(d));
    p.on('close', code => (code === 0 ? resolve(Buffer.concat(chunks)) : reject(new Error('ffmpeg 失敗'))));
  });
  return { data: out, width, height };
}

// 區域內的平均像素差（0～255）。
function regionDiff(a, b, { x, y, w, h }) {
  let sum = 0; let n = 0;
  for (let yy = Math.floor(y * a.height); yy < Math.floor((y + h) * a.height); yy++) {
    for (let xx = Math.floor(x * a.width); xx < Math.floor((x + w) * a.width); xx++) {
      const i = (yy * a.width + xx) * 3;
      sum += Math.abs(a.data[i] - b.data[i]) + Math.abs(a.data[i + 1] - b.data[i + 1]) + Math.abs(a.data[i + 2] - b.data[i + 2]);
      n += 3;
    }
  }
  return sum / n;
}

module.exports = { makeImage, rgb, regionDiff, exec };
