// 背景工作：生成精緻圖、分鏡影片等耗時工作在背景執行，前端以輪詢查看進度。
function createJobs() {
  const running = new Set();
  return {
    start(fn) {
      const p = Promise.resolve().then(fn).catch(err => console.error('背景工作失敗：', err));
      running.add(p);
      p.finally(() => running.delete(p));
      return p;
    },
    // 等所有背景工作結束（測試用）。
    async idle() {
      while (running.size) await Promise.allSettled([...running]);
    },
    get size() { return running.size; },
  };
}

module.exports = { createJobs };
