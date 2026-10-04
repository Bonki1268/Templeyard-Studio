// 組 prompt 變數：AI 只能看到寺廟資料庫的欄位、使用者輸入與系列設定。
function templeVars(video) {
  const t = video.temple || {};
  return {
    name: t.displayName || t.name, district: t.district, deity: t.deity, religion: t.religion,
    builtYear: t.builtYear, address: t.address, history: video.templeHistory || '',
  };
}

function seriesVars(video) {
  const s = video.series;
  return { style: [s.style, s.styleNote].filter(Boolean).join('；'), direction: s.direction, duration: s.duration };
}

function photosText(video) {
  return video.photos.filter(p => p.status === 'ready')
    .map((p, i) => `${i + 1}. ${p.description || p.filename.replace(/\.[^.]+$/, '')}`).join('；');
}

module.exports = { templeVars, seriesVars, photosText };
