// 寺廟資料清理：讀入「新北市寺廟資料.csv」，換算紀年、正規化電話、補里別、標記狀態。
// 資料庫只讀不寫。
const fs = require('node:fs');

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  const src = text.replace(/^﻿/, '');
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (quoted) {
      if (c === '"' && src[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && src[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.some(f => f !== '')) rows.push(row);
      row = [];
    } else field += c;
  }
  if (field !== '' || row.length) { row.push(field); if (row.some(f => f !== '')) rows.push(row); }
  const [header, ...body] = rows;
  return body.map(r => Object.fromEntries(header.map((h, i) => [h.trim(), (r[i] ?? '').trim()])));
}

// 年號元年的西元年。
const ERAS = {
  康熙: 1662, 雍正: 1723, 乾隆: 1736, 嘉慶: 1796, 道光: 1821, 咸豐: 1851, 同治: 1862, 光緒: 1875, 宣統: 1909,
  明治: 1868, 大正: 1912, 昭和: 1926,
};

function toWesternYear(raw) {
  const text = String(raw ?? '').trim();
  const m = text.match(/^(民國|民前|民|[一-鿿]{2})\s*(\d+)/);
  if (!m) return null;
  const n = Number(m[2]);
  if (!n) return null;
  if (m[1] === '民國' || m[1] === '民') return 1911 + n;
  if (m[1] === '民前') return 1912 - n;
  if (ERAS[m[1]]) return ERAS[m[1]] + n - 1;
  return null; // 日據、不詳等無法判斷的紀年
}

// 新北市市話區碼為 02；保留原始值另存。
function normalizePhone(raw) {
  const main = String(raw ?? '').split(/轉|分機|#|ext/i)[0];
  const digits = main.replace(/\D/g, '');
  if (!digits) return null;
  if (digits.startsWith('0')) return digits.length >= 9 ? digits : null;
  if (digits.length === 8) return '02' + digits;
  return null;
}

const NAME_PREFIX = /^財團法人(新北市|臺灣省臺北縣|台灣省台北縣|臺北縣|台北縣)?/;
const NAME_SUFFIX = /[（(](已廢止|尚未取得正式寺廟登記證)[)）]\s*$/;

function displayNameOf(name) {
  return name.replace(NAME_SUFFIX, '').replace(NAME_PREFIX, '').trim() || name;
}

function villageFromAddress(address, district) {
  let rest = String(address || '').replace(/^新北市/, '');
  if (district && rest.startsWith(district)) rest = rest.slice(district.length);
  else rest = rest.replace(/^[^\d]{1,3}?區/, '');
  const m = rest.match(/^([^\d\s鄰路街巷弄號段]{1,4}里)/);
  return m ? m[1] : null;
}

function cleanRecord(r) {
  const name = r.tep_name || '';
  const district = r.tep_area || null;
  let village = r.tep_village || null;
  let villageFromAddr = false;
  if (!village) {
    village = villageFromAddress(r.tep_address, district);
    villageFromAddr = Boolean(village);
  }
  const rebuiltRaw = r.tep_rebuildtime && r.tep_rebuildtime !== '0' ? r.tep_rebuildtime : null;
  return {
    id: r.tep_id,
    name,
    displayName: displayNameOf(name),
    address: r.tep_address || null,
    district,
    village,
    villageFromAddress: villageFromAddr,
    phone: normalizePhone(r.tep_phone),
    phoneRaw: r.tep_phone || null,
    deity: r.tep_god || null,
    religion: r.tep_class || null,
    builtYear: toWesternYear(r.tep_buildtime),
    builtRaw: r.tep_buildtime || null,
    rebuiltYear: rebuiltRaw ? toWesternYear(/^\d+$/.test(rebuiltRaw) ? `民國${rebuiltRaw}` : rebuiltRaw) : null,
    rebuiltRaw,
    flags: {
      foundation: name.startsWith('財團法人'),
      abolished: /已廢止/.test(name),
      unregistered: /尚未取得/.test(name),
      duplicateName: false,
    },
  };
}

function loadTemples(csvPath) {
  const all = parseCsv(fs.readFileSync(csvPath, 'utf8')).map(cleanRecord);
  const counts = new Map();
  for (const t of all) counts.set(t.displayName, (counts.get(t.displayName) || 0) + 1);
  for (const t of all) t.flags.duplicateName = counts.get(t.displayName) > 1;
  const valid = all.filter(t => !t.flags.abolished && !t.flags.unregistered);
  return { all, valid, byId: new Map(all.map(t => [t.id, t])) };
}

module.exports = { parseCsv, toWesternYear, normalizePhone, cleanRecord, loadTemples, displayNameOf };
