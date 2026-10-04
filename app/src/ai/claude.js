// 文字生成：Claude（官方 @anthropic-ai/sdk）。依 prompt 檔的 output.schema 以結構化輸出取得 JSON。
// 憑證由 SDK 從 ANTHROPIC_API_KEY（或 ant auth login 的設定檔）讀取，程式不經手金鑰。
const Anthropic = require('@anthropic-ai/sdk');

// 每百萬 token 的美元價格（輸入、輸出）。
const PRICES = { 'claude-opus-5-5': [4, 20], 'claude-sonnet-5-5': [2, 10], 'claude-haiku-4-5': [1, 5] };
const UNSUPPORTED = ['minimum', 'maximum', 'exclusiveMinimum', 'exclusiveMaximum', 'multipleOf', 'minLength', 'maxLength', 'minItems', 'maxItems', 'uniqueItems', 'pattern'];

// 結構化輸出的 JSON schema：每個物件都要 additionalProperties: false，並移除不支援的數值與長度限制。
function strictSchema(schema) {
  if (Array.isArray(schema)) return schema.map(strictSchema);
  if (!schema || typeof schema !== 'object') return schema;
  const out = {};
  for (const [k, v] of Object.entries(schema)) {
    if (UNSUPPORTED.includes(k)) continue;
    out[k] = k === 'properties' ? Object.fromEntries(Object.entries(v).map(([p, s]) => [p, strictSchema(s)])) : strictSchema(v);
  }
  if (out.type === 'object') {
    out.additionalProperties = false;
    out.properties ||= {};
  }
  return out;
}

function createClaudeText({ client, model, effort = 'high', maxTokens = 16000 } = {}) {
  const anthropic = client || new Anthropic();
  const defaultModel = model || 'claude-opus-5-5';
  return {
    model: defaultModel,
    async generate({ request }) {
      const useModel = /^claude-/.test(request.target?.model || '') ? request.target.model : defaultModel;
      const params = {
        model: useModel,
        max_tokens: maxTokens,
        system: request.system,
        messages: request.messages,
        output_config: { effort },
        // 安全分類器拒絕時，由伺服器依拒絕類別自動改用建議的備援模型。
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
      };
      if (request.output?.format === 'json' && request.output.schema) {
        params.output_config.format = { type: 'json_schema', schema: strictSchema(request.output.schema) };
      }
      let response;
      try {
        response = await anthropic.beta.messages.create(params);
      } catch (err) {
        if (err instanceof Anthropic.AuthenticationError) throw new Error('Claude 憑證無效，請檢查 ANTHROPIC_API_KEY');
        if (err instanceof Anthropic.RateLimitError) throw new Error('Claude 請求過於頻繁，請稍後再試');
        if (err instanceof Anthropic.APIError) throw new Error(`Claude API 錯誤（${err.status}）：${err.message}`);
        throw err;
      }
      if (response.stop_reason === 'refusal') {
        throw new Error(`Claude 拒絕了這個請求${response.stop_details?.category ? `（${response.stop_details.category}）` : ''}，請調整內容後再試`);
      }
      if (response.stop_reason === 'max_tokens') throw new Error('Claude 的輸出被截斷（超過長度上限），請重新產生');
      const text = response.content.filter(b => b.type === 'text').map(b => b.text).join('');
      let json;
      if (params.output_config.format) {
        try { json = JSON.parse(text); } catch { throw new Error('Claude 回傳的內容不是合法的 JSON，請重新產生'); }
      }
      const [inPrice, outPrice] = PRICES[response.model] || PRICES[useModel] || PRICES['claude-opus-5-5'];
      const usage = response.usage || {};
      const cost = +(((usage.input_tokens || 0) * inPrice + (usage.output_tokens || 0) * outPrice) / 1e6).toFixed(4);
      return { json, text, model: response.model || useModel, cost };
    },
  };
}

module.exports = { createClaudeText, strictSchema };
