// Prompt 檔案的驗證、編譯與組裝。
// 一個 prompt = 一個 JSON 檔；template 以 {{變數}} 標記插入點。

const PLACEHOLDER = /\{\{\s*([a-zA-Z_][\w.]*)\s*\}\}/g;
const TARGET_KINDS = ['text', 'image', 'video'];
const ID_PATTERN = /^[a-z0-9][a-z0-9-]{1,63}$/;

function placeholders(text) {
  const names = new Set();
  for (const m of String(text || '').matchAll(PLACEHOLDER)) names.add(m[1]);
  return [...names];
}

// 回傳錯誤訊息陣列；空陣列代表通過。
function validate(p) {
  const errors = [];
  if (!p || typeof p !== 'object' || Array.isArray(p)) return ['內容必須是 JSON 物件'];
  if (!ID_PATTERN.test(p.id || '')) errors.push('id 只能用小寫英數與連字號，2～64 字');
  if (!p.name || typeof p.name !== 'string') errors.push('name（名稱）必填');
  if (!Number.isInteger(p.step) || p.step < 1 || p.step > 6) errors.push('step 必須是 1～6 的整數');
  if (!p.target || !TARGET_KINDS.includes(p.target.kind)) errors.push(`target.kind 必須是 ${TARGET_KINDS.join('、')} 其中之一`);
  if (typeof p.system !== 'string') errors.push('system 必須是文字');
  if (!p.template || typeof p.template !== 'string') errors.push('template（指令內容）必填');
  if (!Array.isArray(p.variables)) {
    errors.push('variables 必須是陣列');
  } else {
    const seen = new Set();
    p.variables.forEach((v, i) => {
      if (!v || !/^[a-zA-Z_][\w.]*$/.test(v.name || '')) errors.push(`第 ${i + 1} 個變數名稱不合法`);
      else if (seen.has(v.name)) errors.push(`變數 ${v.name} 重複`);
      else seen.add(v.name);
    });
    const used = [...placeholders(p.system), ...placeholders(p.template)];
    for (const name of used) {
      if (!seen.has(name)) errors.push(`指令用到 {{${name}}}，但變數清單沒有宣告`);
    }
  }
  if (p.output !== undefined && p.output !== null) {
    if (typeof p.output !== 'object' || !['text', 'json'].includes(p.output.format)) {
      errors.push('output.format 必須是 text 或 json');
    }
  }
  return errors;
}

function lookup(vars, path) {
  return path.split('.').reduce((obj, key) => (obj == null ? undefined : obj[key]), vars);
}

function present(value) {
  return !(value === undefined || value === null || (typeof value === 'string' && value.trim() === ''));
}

function stringify(value) {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return JSON.stringify(value, null, 2);
}

function fill(text, vars) {
  return String(text || '').replace(PLACEHOLDER, (_, name) => {
    const value = lookup(vars, name);
    return present(value) ? stringify(value) : '';
  });
}

// 依 prompt 檔與輸入變數，組出要送給 AI 的請求內容。
function render(p, vars = {}) {
  const missing = p.variables
    .filter(v => v.required && !present(lookup(vars, v.name)))
    .map(v => v.name);
  const request = {
    promptId: p.id,
    promptVersion: p.version,
    step: p.step,
    target: p.target,
    system: fill(p.system, vars).trim(),
    messages: [{ role: 'user', content: fill(p.template, vars).trim() }],
  };
  if (p.output) request.output = p.output;
  return { missing, request };
}

// 把 prompt 檔轉成等價的 JavaScript 函式原始碼，方便檢視插入點。
// 只用於顯示；實際組裝走 render()，不執行任何字串程式碼。
function compileToJs(p) {
  const literal = text => '`' + String(text || '')
    .replace(/\\/g, '\\\\')
    .replace(/`/g, '\\`')
    .replace(/\$\{/g, '\\${')
    .replace(PLACEHOLDER, (_, name) => '${v(' + JSON.stringify(name) + ')}') + '`';
  const required = p.variables.filter(v => v.required).map(v => v.name);
  return [
    `// ${p.name}（步驟 ${p.step}，第 ${p.version} 版）— 由 prompts/${p.id}.json 產生`,
    `export function build(input) {`,
    `  const v = path => path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), input) ?? '';`,
    `  const required = ${JSON.stringify(required)};`,
    `  const missing = required.filter(name => v(name) === '');`,
    `  if (missing.length) throw new Error('缺少必要變數：' + missing.join('、'));`,
    `  return {`,
    `    target: ${JSON.stringify(p.target)},`,
    `    system: ${literal(p.system)},`,
    `    messages: [{ role: 'user', content: ${literal(p.template)} }],`,
    p.output ? `    output: ${JSON.stringify(p.output)},` : null,
    `  };`,
    `}`,
  ].filter(line => line !== null).join('\n');
}

module.exports = { validate, render, compileToJs, placeholders };
