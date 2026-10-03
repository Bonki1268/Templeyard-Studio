// 寺廟搜尋：廟名、行政區、主祀神明；支援臺／台混用與財團法人前綴。
const path = require('node:path');
const { loadTemples } = require('./clean');
const { notFound } = require('../http');

const normalize = s => String(s || '')
  .replace(/臺/g, '台')
  .replace(/^財團法人(新北市|台灣省台北縣|台北縣)?/, '')
  .replace(/[\s()（）]/g, '')
  .toLowerCase();

function summary(t) {
  return {
    id: t.id, name: t.name, displayName: t.displayName,
    label: t.flags.duplicateName && t.district ? `${t.displayName}（${t.district}）` : t.displayName,
    district: t.district, deity: t.deity, religion: t.religion, address: t.address,
    builtYear: t.builtYear, flags: t.flags,
  };
}

function score(t, term) {
  const name = normalize(t.name);
  const display = normalize(t.displayName);
  if (display === term) return 100;
  if (display.startsWith(term)) return 80;
  if (name.includes(term)) return 60;
  if (normalize(t.deity) === term) return 50;
  if (normalize(t.deity).includes(term)) return 40;
  if (normalize(t.district).includes(term)) return 30;
  if (normalize(t.village).includes(term)) return 20;
  if (normalize(t.address).includes(term)) return 10;
  return 0;
}

function searchTemples(db, query, { includeInactive = false, limit = 50 } = {}) {
  const terms = String(query || '').split(/\s+/).map(normalize).filter(Boolean);
  const scored = [];
  for (const t of db.all) {
    let total = 0;
    for (const term of terms) {
      const s = score(t, term);
      if (!s) { total = 0; break; }
      total += s;
    }
    if (terms.length && !total) continue;
    scored.push({ t, total });
  }
  scored.sort((a, b) => b.total - a.total || a.t.displayName.localeCompare(b.t.displayName, 'zh-Hant'));
  const active = scored.filter(({ t }) => includeInactive || (!t.flags.abolished && !t.flags.unregistered));
  return {
    total: active.length,
    excluded: scored.length - active.length,
    items: active.slice(0, limit).map(({ t }) => summary(t)),
  };
}

function registerTempleRoutes(router, getDb) {
  router.get('/api/temples', ({ query }) => searchTemples(getDb(), query.q, {
    includeInactive: query.includeInactive === '1' || query.includeInactive === 'true',
    limit: Math.min(Number(query.limit) || 50, 1000),
  }));
  router.get('/api/temples/:id', ({ params }) => {
    const t = getDb().byId.get(params.id);
    if (!t) throw notFound('找不到寺廟');
    return { temple: { ...t, label: summary(t).label } };
  });
}

const DEFAULT_CSV = path.join(__dirname, '..', '..', '..', '新北市寺廟資料.csv');

function templeDb(csvPath = DEFAULT_CSV) {
  let db = null;
  return () => (db ||= loadTemples(csvPath));
}

module.exports = { searchTemples, registerTempleRoutes, templeDb, normalize };
