// 步驟確認的狀態機。步驟 1（系列設定）建立影片時即視為已確認；步驟 2～6 每支影片各走一次。
// 狀態：pending（未確認）、confirmed（已確認）、stale（前面的步驟被修改，需重新確認）。
const { HttpError } = require('../http');

const STEPS = [2, 3, 4, 5, 6];
const STEP_NAMES = { 1: '系列設定', 2: '新增影片', 3: '故事腳本', 4: '角色設計', 5: '精緻圖', 6: '影片生成' };

// 每一步確認時保存的內容（確認紀錄用）。
const STEP_FIELDS = {
  2: ['templeId', 'temple', 'templeHistory', 'photos', 'story'],
  3: ['script'],
  4: ['characters'],
  5: ['frames'],
  6: ['clips', 'final', 'audio'],
};

const text = v => (typeof v === 'string' ? v.trim() : '');

// 每一步的確認條件，回傳未滿足的條件說明。
const CONDITIONS = {
  2: v => [
    !v.templeId && '尚未選擇寺廟',
    !(v.photos || []).some(p => p.status === 'ready') && '至少要有 1 張照片完成去識別',
    !text(v.story?.adopted) && '故事不能空白',
  ].filter(Boolean),
  3: v => {
    const shots = v.script?.shots || [];
    if (!shots.length) return ['尚未產生分鏡腳本'];
    const unmet = [];
    const missing = shots.filter(s => !text(s.scene) || !text(s.action)).map(s => s.index);
    if (missing.length) unmet.push(`第 ${missing.join('、')} 格缺少說明`);
    const total = shots.reduce((sum, s) => sum + Number(s.seconds || 0), 0);
    if (Math.abs(total - v.series.duration) > 0.5) unmet.push(`分鏡總長度 ${total} 秒，與系列設定 ${v.series.duration} 秒不符`);
    return unmet;
  },
  4: v => {
    const chars = v.characters || [];
    if (!chars.length) return ['尚未產生角色'];
    return chars.filter(c => !c.versions?.some(x => x.version === c.selectedVersion)).map(c => `角色「${c.name}」尚未選定版本`);
  },
  5: v => {
    const shots = v.script?.shots || [];
    const missing = shots.filter(s => !v.frames?.[s.id]?.selected).map(s => s.index);
    return missing.length ? [`第 ${missing.join('、')} 格尚未選定精緻圖`] : [];
  },
  6: v => {
    const shots = v.script?.shots || [];
    const missing = shots.filter(s => !v.clips?.[s.id]?.selected).map(s => s.index);
    const unmet = missing.length ? [`第 ${missing.join('、')} 格尚未產生分鏡影片`] : [];
    if (!v.final?.file || v.final.status !== 'done') unmet.push('尚未合成成品');
    else if (v.final.stale) unmet.push('分鏡或聲音設定已變更，請重新合成成品');
    return unmet;
  },
};

function initialSteps() {
  const steps = { 1: { status: 'confirmed', rev: 1, confirmedRev: 1 } };
  for (const s of STEPS) steps[s] = { status: 'pending', rev: 0, confirmedRev: null };
  return steps;
}

function refresh(video) {
  const next = STEPS.find(s => video.steps[s].status !== 'confirmed');
  video.currentStep = next || 6;
  video.status = next ? 'in_progress' : 'done';
}

function canEnter(video, step) {
  return STEPS.filter(s => s < step).every(s => video.steps[s].status === 'confirmed');
}

function assertCanEnter(video, step) {
  const blocking = STEPS.find(s => s < step && video.steps[s].status !== 'confirmed');
  if (blocking) {
    throw new HttpError(409, 'previous_step_not_confirmed', `請先確認步驟 ${blocking}「${STEP_NAMES[blocking]}」`, { step: blocking });
  }
}

// 某一步的內容被修改：本步回到未確認，後面已確認的步驟標示需重新確認。
function touch(video, step) {
  const st = video.steps[step];
  st.rev += 1;
  if (st.status !== 'pending') st.status = 'pending';
  for (const s of STEPS.filter(s => s > step)) {
    if (video.steps[s].status === 'confirmed') video.steps[s].status = 'stale';
  }
  refresh(video);
}

function confirm(video, step, conditions = CONDITIONS) {
  assertCanEnter(video, step);
  const unmet = conditions[step]?.(video) || [];
  if (unmet.length) throw new HttpError(422, 'conditions_not_met', `步驟 ${step} 還不能確認：${unmet.join('；')}`, { unmet });
  const st = video.steps[step];
  st.status = 'confirmed';
  st.confirmedRev = st.rev;
  refresh(video);
  const content = Object.fromEntries((STEP_FIELDS[step] || []).map(k => [k, video[k] ?? null]));
  return { step, rev: st.rev, content };
}

module.exports = { STEPS, STEP_NAMES, STEP_FIELDS, CONDITIONS, initialSteps, touch, confirm, canEnter, assertCanEnter, refresh };
