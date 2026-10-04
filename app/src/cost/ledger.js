// 費用記帳：預估 → 預留 → 結算；失敗時退回預留。每支影片有上限，單筆超過門檻或累計超過上限需再次同意。
const { HttpError } = require('../http');
const { DEFAULTS, round } = require('./prices');

function createLedger({ store, capOf = () => DEFAULTS.costCap, threshold = DEFAULTS.threshold }) {
  const entries = videoId => store.list('ledger', e => e.videoId === videoId)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));

  function summary(videoId) {
    const list = entries(videoId);
    const spent = round(list.filter(e => e.status === 'settled').reduce((s, e) => s + e.actual, 0));
    const reserved = round(list.filter(e => e.status === 'reserved').reduce((s, e) => s + e.reserved, 0));
    const cap = capOf(videoId);
    return { cap, threshold, spent, reserved, available: round(cap - spent - reserved) };
  }

  // 不同意時丟出 402，附上預估金額與原因。
  function check(videoId, estimate, consent = false) {
    if (consent) return;
    const sum = summary(videoId);
    if (estimate > threshold) {
      throw new HttpError(402, 'cost_consent_required', `預估 US$${estimate.toFixed(2)}，超過單筆門檻 US$${threshold.toFixed(2)}，需要再次同意`, { reason: 'threshold', estimate, ...sum });
    }
    if (sum.spent + sum.reserved + estimate > sum.cap + 1e-9) {
      throw new HttpError(402, 'cost_consent_required', `預估 US$${estimate.toFixed(2)}，累計將超過費用上限 US$${sum.cap.toFixed(2)}，需要再次同意`, { reason: 'cap', estimate, ...sum });
    }
  }

  return {
    entries,
    summary,
    check,
    reserve: (videoId, estimate, info = {}) => store.insert('ledger', { videoId, ...info, estimate, reserved: estimate, actual: 0, status: 'reserved' }),
    settle: (id, actual) => store.update('ledger', id, e => { e.actual = round(actual); e.reserved = 0; e.status = 'settled'; }),
    refund: id => store.update('ledger', id, e => { e.reserved = 0; e.status = 'refunded'; }),
  };
}

module.exports = { createLedger };
