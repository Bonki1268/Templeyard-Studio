// 燒錄字幕（ASS）：繁中白字、下方置中（規格書：影片規格與品質標準）。
// 依系列風格選樣式（可手動改選），標點依電影字幕慣例處理，長句拆段依字數分配時間，每段淡入淡出。
// 字型使用專案內附的 Noto 字型（SIL OFL），每台電腦的成品都一樣。
const path = require('node:path');

const FONT_DIR = path.join(__dirname, '..', '..', 'public', 'fonts');
const MAX_CHARS = 16;
const FADE_MS = 150;

// 尺寸以畫面高度的比例表示，依輸出解析度換算。顏色是 ASS 的 &HAABBGGRR。
const SUBTITLE_STYLES = {
  cinema: {
    label: '電影感黑體', font: 'Noto Sans TC Medium', fontFile: 'NotoSansTC-Medium.otf',
    size: 0.05, spacing: 0.0028, borderStyle: 1, outline: 0.002, shadow: 0.0014, marginV: 0.072, blur: 4,
    outlineColour: '&H8C000000', backColour: '&H96000000',
  },
  serif: {
    label: '人文宋體', font: 'Noto Serif TC SemiBold', fontFile: 'NotoSerifTC-SemiBold.otf',
    size: 0.052, spacing: 0.0037, borderStyle: 1, outline: 0.002, shadow: 0.0014, marginV: 0.074, blur: 4,
    outlineColour: '&H96000000', backColour: '&HA0000000',
  },
  documentary: {
    label: '紀錄片底條', font: 'Noto Sans TC Medium', fontFile: 'NotoSansTC-Medium.otf',
    size: 0.043, spacing: 0.0019, borderStyle: 3, outline: 0.013, shadow: 0, marginV: 0.065, blur: 0,
    outlineColour: '&H73000000', backColour: '&H00000000',
  },
};

// 依系列風格自動選樣式：溫暖寫實用宋體、紀錄片質感用底條，其他用電影感黑體。
function subtitleStyleFor(seriesStyle = '') {
  if (/紀錄/.test(seriesStyle)) return 'documentary';
  if (/溫暖|懷舊|歷史/.test(seriesStyle)) return 'serif';
  return 'cinema';
}

// 電影字幕慣例：逗號、頓號、分號、冒號改成全形空格；句尾的句號與驚嘆號拿掉；刪節號與問號保留。
function formatSubtitle(text) {
  return String(text || '')
    .trim()
    .replace(/\s*[，、；：,;:]\s*/g, '　')
    .replace(/[。！!．.]+(?=　|$)/g, '')
    .replace(/　{2,}/g, '　')
    .replace(/^　+|　+$/g, '')
    .trim();
}

// 長字幕拆段：優先在空格（原本的標點）斷開，每段不超過 max 個字；沒有斷點時平均硬切。
function splitSubtitle(text, max = MAX_CHARS) {
  const len = s => [...s].length;
  const hardSplit = s => {
    const chars = [...s];
    const n = Math.ceil(chars.length / max);
    const size = Math.ceil(chars.length / n);
    return Array.from({ length: n }, (_, i) => chars.slice(i * size, (i + 1) * size).join(''));
  };
  const parts = [];
  let cur = '';
  for (const piece of text.split('　').filter(Boolean)) {
    for (const token of len(piece) > max ? hardSplit(piece) : [piece]) {
      const next = cur ? `${cur}　${token}` : token;
      if (len(next) <= max) cur = next;
      else { if (cur) parts.push(cur); cur = token; }
    }
  }
  if (cur) parts.push(cur);
  return parts;
}

function assTime(sec) {
  const cs = Math.round(sec * 100);
  const h = Math.floor(cs / 360000);
  const m = Math.floor((cs % 360000) / 6000);
  const s = Math.floor((cs % 6000) / 100);
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(cs % 100).padStart(2, '0')}`;
}

// items：[{ text, start, end }]（秒）。
function assDocument(items, { width, height, style = 'cinema' }) {
  const st = SUBTITLE_STYLES[style] || SUBTITLE_STYLES.cinema;
  const px = r => Math.max(0, +(height * r).toFixed(1));
  const blur = st.blur ? `\\blur${+(st.blur * height / 1080).toFixed(1)}` : '';
  const tags = `{\\fad(${FADE_MS},${FADE_MS})${blur}}`;
  const lines = [];
  for (const { text, start, end } of items) {
    const parts = splitSubtitle(formatSubtitle(text));
    const weights = parts.map(p => p.replace(/　/g, '').length);
    const total = weights.reduce((a, b) => a + b, 0);
    let t = start;
    parts.forEach((p, i) => {
      const e = i === parts.length - 1 ? end : t + (end - start) * weights[i] / total;
      lines.push(`Dialogue: 0,${assTime(t)},${assTime(e)},Default,,0,0,0,,${tags}${p}`);
      t = e;
    });
  }
  const margin = Math.round(height * st.marginV);
  const side = Math.round(width * 0.06);
  return [
    '[Script Info]', 'ScriptType: v4.00+', `PlayResX: ${width}`, `PlayResY: ${height}`, 'WrapStyle: 2', 'ScaledBorderAndShadow: yes', '',
    '[V4+ Styles]',
    'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
    `Style: Default,${st.font},${Math.round(height * st.size)},&H00FFFFFF,&H000000FF,${st.outlineColour},${st.backColour},0,0,0,0,100,100,${px(st.spacing)},0,${st.borderStyle},${px(st.outline)},${px(st.shadow)},2,${side},${side},${margin},1`,
    '', '[Events]', 'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
    ...lines, '',
  ].join('\n');
}

// ffmpeg 的 subtitles 濾鏡：字型資料夾以相對路徑 fonts 指定（合成時在工作資料夾連到 FONT_DIR）。
const subtitleFilter = file => `subtitles=${file}:fontsdir=fonts`;

module.exports = { SUBTITLE_STYLES, FONT_DIR, subtitleStyleFor, formatSubtitle, splitSubtitle, assDocument, assTime, subtitleFilter };
