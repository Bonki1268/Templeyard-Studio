// Prompt 組裝：沿用 prompt-studio 的指令檔與組裝邏輯。
// 預設在本機直接讀 prompt-studio/prompts/ 的 JSON 檔；設定 studioUrl（PROMPT_STUDIO_URL）時改呼叫
// Prompt Studio 的 POST /api/prompts/:id/render。兩種方式結果相同。
const fs = require('node:fs');
const path = require('node:path');
const { validate, render } = require('../../../prompt-studio/lib/prompt');
const { HttpError, notFound } = require('../http');

const PROMPT_DIR = path.join(__dirname, '..', '..', '..', 'prompt-studio', 'prompts');

const missingError = missing => new HttpError(422, 'missing_variables', `缺少必要變數：${missing.join('、')}`, { missing });

function createPromptService({ promptDir = process.env.PROMPT_DIR_APP || PROMPT_DIR, studioUrl = process.env.PROMPT_STUDIO_URL } = {}) {
  function load(id) {
    const file = path.join(promptDir, `${id}.json`);
    if (!/^[a-z0-9-]+$/.test(id) || !fs.existsSync(file)) throw notFound(`找不到 prompt：${id}`);
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  }

  async function renderLocal(id, variables, options) {
    const p = load(id);
    const errors = validate(p);
    if (errors.length) throw new HttpError(500, 'invalid_prompt', `prompt ${id} 未通過驗證`, { details: errors });
    const { missing, request } = render(p, variables, options);
    if (missing.length) throw missingError(missing);
    return request;
  }

  async function renderRemote(id, variables, options) {
    const res = await fetch(`${studioUrl.replace(/\/$/, '')}/api/prompts/${id}/render`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ variables, model: options.model }),
    });
    const body = await res.json();
    if (res.status === 422 && body.error?.code === 'missing_variables') throw missingError(body.error.missing);
    if (!res.ok) throw new HttpError(502, 'prompt_studio_error', body.error?.message || 'Prompt Studio 組裝失敗');
    return body.request;
  }

  return {
    load,
    // 回傳要送給 AI 的請求內容（含 promptId、promptVersion）。
    render: (id, variables = {}, options = {}) => (studioUrl ? renderRemote : renderLocal)(id, variables, options),
  };
}

module.exports = { createPromptService, PROMPT_DIR };
