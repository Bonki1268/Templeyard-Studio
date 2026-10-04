// 短期網址：/media/<相對路徑>?exp=<到期秒數>&sig=<HMAC>。伺服器重啟後金鑰更換，舊網址失效。
const crypto = require('node:crypto');

function createSigner({ secret = crypto.randomBytes(32), ttlSeconds = 3600, clock = () => new Date() } = {}) {
  const sign = (rel, exp) => crypto.createHmac('sha256', secret).update(`${rel}\n${exp}`).digest('hex');
  return {
    url(rel) {
      const exp = Math.floor(clock().getTime() / 1000) + ttlSeconds;
      return `/media/${rel.split('/').map(encodeURIComponent).join('/')}?exp=${exp}&sig=${sign(rel, exp)}`;
    },
    verify(rel, exp, sig) {
      if (!exp || !sig || !/^[0-9a-f]{64}$/.test(sig)) return false;
      if (Number(exp) < clock().getTime() / 1000) return false;
      return crypto.timingSafeEqual(Buffer.from(sign(rel, exp), 'hex'), Buffer.from(sig, 'hex'));
    },
  };
}

module.exports = { createSigner };
