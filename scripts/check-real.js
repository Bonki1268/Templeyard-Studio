#!/usr/bin/env node
// 檢查真實服務的憑證是否可用（手動執行，不在驗證閘門中）。
//   Claude：送一次很短的請求（約 US$0.01 以下）。
//   Higgsfield：只呼叫免費的估價端點，不會生成、不扣點。
// 用法（在專案根目錄）：node --env-file-if-exists=.env scripts/check-real.js
const Anthropic = require('../app/node_modules/@anthropic-ai/sdk');

async function main() {
  const { HF_API_KEY_ID, HF_API_KEY_SECRET } = process.env;
  let ok = true;

  try {
    const client = new Anthropic();
    const r = await client.messages.create({ model: process.env.CLAUDE_MODEL || 'claude-opus-5-5', max_tokens: 64, output_config: { effort: 'low' }, messages: [{ role: 'user', content: '只回答「OK」。' }] });
    console.log(`✓ Claude 可用（${r.model}）`);
  } catch (err) {
    ok = false;
    console.log(`✗ Claude 無法使用：${err instanceof Anthropic.AuthenticationError ? '憑證無效或未設定 ANTHROPIC_API_KEY' : err.message}`);
  }

  if (!HF_API_KEY_ID || !HF_API_KEY_SECRET) {
    ok = false;
    console.log('✗ Higgsfield：未設定 HF_API_KEY_ID／HF_API_KEY_SECRET');
  } else {
    const auth = { Authorization: `Key ${HF_API_KEY_ID}:${HF_API_KEY_SECRET}`, 'Content-Type': 'application/json' };
    for (const [name, endpoint, body] of [
      ['圖片 Grok Imagine Image 2.0', process.env.HIGGSFIELD_IMAGE_MODEL || 'xai/grok-imagine-image-2.0', { prompt: '廟宇', aspect_ratio: '16:9' }],
      ['影片 Seedance 2.0（4 秒）', process.env.HIGGSFIELD_VIDEO_MODEL || 'bytedance/seedance-2.0/image-to-video', { image_url: 'https://example.com/a.jpg', duration: 4, resolution: '1080p' }],
    ]) {
      const res = await fetch(`https://api.higgsfield.ai/estimate/${endpoint}`, { method: 'POST', headers: auth, body: JSON.stringify(body) });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.usd) console.log(`✓ Higgsfield ${name}：每次約 US$${data.usd}（${data.credits} 點）`);
      else if (res.ok) console.log(`✓ Higgsfield ${name}：${data.pricing_description || JSON.stringify(data)}`);
      else { ok = false; console.log(`✗ Higgsfield ${name}：${res.status} ${JSON.stringify(data.detail ?? data)}`); }
    }
  }
  process.exit(ok ? 0 : 1);
}

main();
