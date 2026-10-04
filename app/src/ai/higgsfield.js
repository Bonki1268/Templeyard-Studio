// 圖片與影片生成：Higgsfield API（https://docs.higgsfield.ai）。
// 流程：本機參考圖以預簽網址上傳 → 估價 → 送出生成（Idempotency-Key）→ 輪詢 status_url → 下載結果到 mediaDir/gen/。
// 只會上傳呼叫端給的參考圖（去識別後的照片、定裝圖、分鏡圖、精緻圖），原圖不會經過這裡。
const fs = require('node:fs');
const { videoTokens, tierFor } = require('../cost/prices');
const path = require('node:path');
const crypto = require('node:crypto');

const API = 'https://api.higgsfield.ai';
const CONTENT_TYPES = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.wav': 'audio/wav', '.mp4': 'video/mp4' };
const VIEWS = { front: '視角：正面全身', side: '視角：側面全身', back: '視角：背面全身', costume: '定裝圖：服裝與臉部細節特寫' };
const sleep = ms => new Promise(r => setTimeout(r, ms));

function resolutionFor(height) {
  if (height >= 2160) return '4k';
  if (height >= 1080) return '1080p';
  if (height >= 720) return '720p';
  return '480p';
}

function createHiggsfieldMedia({
  keyId, keySecret, fetchImpl = fetch, mediaDir, output = { width: 1920, height: 1080, fps: 24 }, videoHeight,
  imageModel = 'xai/grok-imagine-image-2.0', videoModel = 'bytedance/seedance-2.0/image-to-video',
  pollIntervalMs = 2000, maxPollIntervalMs = 10000, timeoutMs = 20 * 60 * 1000,
}) {
  const auth = { Authorization: `Key ${keyId}:${keySecret}` };
  const genDir = path.join(mediaDir, 'gen');
  const uploaded = new Map();

  async function errorFrom(res) {
    let detail = '';
    try { const body = await res.json(); detail = typeof body.detail === 'string' ? body.detail : JSON.stringify(body.detail ?? body); } catch { /* 沒有內容 */ }
    const reason = { 400: '參數錯誤或同時生成數已滿', 401: '憑證無效，請檢查 HF_API_KEY_ID／HF_API_KEY_SECRET', 403: '點數不足，請先儲值', 404: '找不到模型或請求', 422: '請求驗證失敗', 423: '模型暫時停用', 503: '模型目前無法使用' }[res.status] || '伺服器錯誤';
    return new Error(`Higgsfield ${reason}（${res.status}）${detail ? `：${detail.slice(0, 200)}` : ''}`);
  }

  async function upload(file) {
    const data = fs.readFileSync(file);
    const key = crypto.createHash('sha256').update(data).digest('hex');
    if (uploaded.has(key)) return uploaded.get(key);
    const contentType = CONTENT_TYPES[path.extname(file).toLowerCase()];
    if (!contentType) throw new Error(`不支援上傳的檔案類型：${path.basename(file)}`);
    const res = await fetchImpl(`${API}/files/generate-upload-url`, { method: 'POST', headers: { ...auth, 'Content-Type': 'application/json' }, body: JSON.stringify({ content_type: contentType }) });
    if (!res.ok) throw await errorFrom(res);
    const target = await res.json();
    // 預簽網址只帶 upload_headers，不可帶 Higgsfield 金鑰。
    const put = await fetchImpl(target.upload_url, { method: 'PUT', headers: target.upload_headers || { 'Content-Type': contentType }, body: data });
    if (!put.ok) throw new Error(`上傳參考圖失敗（${put.status}）`);
    uploaded.set(key, target.public_url);
    return target.public_url;
  }

  async function estimate(endpoint, body) {
    try {
      const res = await fetchImpl(`${API}/estimate/${endpoint}`, { method: 'POST', headers: { ...auth, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      if (!res.ok) return undefined;
      const data = await res.json();
      const usd = Number(data.usd);
      if (Number.isFinite(usd)) return usd;
      // Seedance 的估價只回傳 token 計價說明：依秒數與解析度換算。
      if (data.pricing_description && body.duration) {
        const height = { '480p': 480, '720p': 720, '1080p': 1080, '4k': 2160 }[body.resolution || '720p'] || 720;
        return +(videoTokens(body.duration, height) * tierFor(height).per1kTokens / 1000).toFixed(4);
      }
      return undefined;
    } catch { return undefined; }
  }

  // 送出生成；網路錯誤或 5xx 以同一個 Idempotency-Key 重試，避免重複生成。
  async function submit(endpoint, body) {
    const idempotencyKey = crypto.randomUUID();
    for (let attempt = 0; ; attempt++) {
      let res;
      try {
        res = await fetchImpl(`${API}/${endpoint}`, { method: 'POST', headers: { ...auth, 'Content-Type': 'application/json', 'Idempotency-Key': idempotencyKey }, body: JSON.stringify(body) });
      } catch (err) {
        if (attempt >= 2) throw new Error(`無法連線到 Higgsfield：${err.message}`);
        await sleep(pollIntervalMs * 2 ** attempt);
        continue;
      }
      if (res.status >= 500 && attempt < 2) { await sleep(pollIntervalMs * 2 ** attempt); continue; }
      if (!res.ok) throw await errorFrom(res);
      return res.json();
    }
  }

  async function poll(handle) {
    const deadline = Date.now() + timeoutMs;
    let delay = pollIntervalMs;
    for (;;) {
      let res;
      try { res = await fetchImpl(handle.status_url, { headers: auth }); } catch { res = null; }
      if (res && !res.ok && res.status < 500) throw await errorFrom(res);
      if (res && res.ok) {
        const result = await res.json();
        if (result.status === 'completed') return result;
        if (result.status === 'failed') throw new Error(`Higgsfield 生成失敗${result.error ? `：${result.error}` : ''}（請求 ${handle.request_id}，不會扣點）`);
        if (result.status === 'nsfw') throw new Error(`Higgsfield 內容審核未通過，請調整指令或參考圖（請求 ${handle.request_id}，不會扣點）`);
        if (result.status === 'canceled') throw new Error(`Higgsfield 請求已取消（${handle.request_id}）`);
      }
      if (Date.now() > deadline) throw new Error(`Higgsfield 生成逾時（請求 ${handle.request_id}）`);
      await sleep(delay + Math.random() * delay * 0.2);
      delay = Math.min(delay * 1.5, maxPollIntervalMs);
    }
  }

  async function download(url, requestId, ext) {
    const res = await fetchImpl(url);
    if (!res.ok) throw new Error(`下載生成結果失敗（${res.status}）`);
    fs.mkdirSync(genDir, { recursive: true });
    const file = path.join(genDir, `hf-${requestId}-${crypto.randomBytes(3).toString('hex')}${ext}`);
    fs.writeFileSync(file, Buffer.from(await res.arrayBuffer()));
    return file;
  }

  async function run(endpoint, body) {
    const cost = await estimate(endpoint, body);
    const handle = await submit(endpoint, body);
    const result = await poll(handle);
    return { result, cost, requestId: handle.request_id };
  }

  const promptOf = request => [request.system, request.messages?.[0]?.content].filter(Boolean).join('\n\n');
  const endpointFor = (request, fallback) => (String(request.target?.model || '').includes('/') ? request.target.model : fallback);

  return {
    imageModel,
    videoModel,
    ruleModels: { video: videoModel.includes('seedance-2.0') ? 'seedance-2.0' : undefined },
    image: {
      async generate({ request, refs = [], variant = '' }) {
        const endpoint = endpointFor(request, imageModel);
        const body = {
          prompt: [promptOf(request), VIEWS[variant]].filter(Boolean).join('\n'),
          aspect_ratio: request.target?.aspectRatio || '16:9',
          resolution: request.promptId === 'refined-frame' ? '2k' : '1k',
          quality: 'medium',
        };
        if (refs.length) body.image_urls = [];
        for (const ref of refs.slice(0, 10)) body.image_urls.push(await upload(ref));
        const { result, cost, requestId } = await run(endpoint, body);
        const url = result.images?.[0]?.url;
        if (!url) throw new Error(`Higgsfield 沒有回傳圖片（請求 ${requestId}）`);
        return { file: await download(url, requestId, path.extname(new URL(url).pathname) || '.png'), model: endpoint, cost };
      },
    },
    video: {
      async generate({ request, firstFrame, lastFrame, seconds, nativeVoice = false }) {
        const endpoint = endpointFor(request, videoModel);
        const body = {
          prompt: promptOf(request),
          image_url: await upload(firstFrame),
          // Seedance 每段至少 4 秒；合成時會裁到分鏡秒數。
          duration: Math.max(4, Math.min(15, Math.ceil(Number(seconds) || 4))),
          resolution: resolutionFor(videoHeight || output.height),
          generate_audio: Boolean(nativeVoice),
        };
        if (lastFrame) body.end_image_url = await upload(lastFrame);
        const { result, cost, requestId } = await run(endpoint, body);
        const url = result.video?.url;
        if (!url) throw new Error(`Higgsfield 沒有回傳影片（請求 ${requestId}）`);
        return { file: await download(url, requestId, '.mp4'), model: endpoint, hasVoice: Boolean(nativeVoice), cost };
      },
    },
  };
}

module.exports = { createHiggsfieldMedia, resolutionFor };
