// 步驟 6（分鏡影片）：以第 5 步選定的精緻圖作為首格（需要時也作為末格）生成每格影片，只補動作。
// 在背景逐格生成；可單格依指令重生、選定版本、記錄品質檢查。
const path = require('node:path');
const { unprocessable, notFound, Reply } = require('../http');
const { seriesVars } = require('../videos/vars');
const { estimateCost, round, billedSeconds } = require('../cost/prices');
const wf = require('../videos/workflow');
const { text } = require('../util');

const CLIP_QUALITY = ['face', 'lipsync', 'hands', 'temple'];

function createStep6Service({ videos, generations, ledger, store, config, jobs }) {
  const media = rel => path.join(config.mediaDir, rel);
  const speaks = shot => Boolean(shot.line) && shot.speaker && shot.speaker !== '旁白';

  function markFinalStale(v) { if (v.final) v.final.stale = true; }

  async function generateOne(id, shotId, { instruction = '', lockLastFrame = false } = {}) {
    const v = videos.get(id);
    const shot = v.script.shots.find(s => s.id === shotId);
    const frames = v.frames[shotId];
    const frame = frames.candidates.find(c => c.id === frames.selected);
    videos.mutate(id, 6, video => { video.clips[shotId].status = 'running'; }, { touch: false });
    const firstFrame = media(frame.file);
    const variables = {
      shot: { index: shot.index, seconds: shot.seconds, action: shot.action, camera: shot.camera, shotSize: shot.shotSize,
        transition: shot.transition, speaker: speaks(shot) ? shot.speaker : '旁白', line: shot.line },
      series: { style: seriesVars(v).style }, instruction: text(instruction),
    };
    try {
      const { generation, result } = await generations.run({
        videoId: id, step: 6, promptId: 'shot-video', variables, instruction: text(instruction), consent: true,
        units: { seconds: shot.seconds, height: config.videoHeight }, meta: { shotId },
        call: (ai, request) => ai.video.generate({ request, firstFrame, lastFrame: lockLastFrame ? firstFrame : undefined, seconds: shot.seconds, nativeVoice: speaks(shot) }),
      });
      videos.mutate(id, 6, video => {
        const c = video.clips[shotId];
        const version = { id: store.newId(), file: path.relative(config.mediaDir, result.file), seconds: shot.seconds, hasVoice: Boolean(result.hasVoice),
          instruction: text(instruction), lockLastFrame, frameId: frame.id, generationId: generation.id };
        c.versions.push(version);
        c.selected = version.id;
        c.status = 'done';
        c.error = null;
        markFinalStale(video);
      });
    } catch (err) {
      videos.mutate(id, 6, video => { Object.assign(video.clips[shotId], { status: 'failed', error: err.message }); }, { touch: false });
    }
  }

  const ensureClip = (v, shotId) => (v.clips[shotId] ||= { versions: [], selected: null, status: 'idle', quality: {}, error: null });
  const pending = v => v.script.shots.filter(s => !v.clips[s.id]?.selected);

  function progress(v) {
    const list = v.script.shots.map(s => v.clips[s.id]?.status || 'idle');
    const count = st => list.filter(x => x === st).length;
    return { total: list.length, done: count('done'), running: count('running'), queued: count('queued'), failed: count('failed') };
  }

  return {
    progress,
    estimate(id) {
      const v = videos.get(id);
      const shots = pending(v).length ? pending(v) : v.script.shots;
      const seconds = round(shots.reduce((sum, s) => sum + s.seconds, 0));
      const clips = shots.map(s => s.seconds);
      return { action: 'clips', count: shots.length, seconds, billedSeconds: clips.reduce((sum, s) => sum + billedSeconds(s), 0),
        estimate: estimateCost('video', { clips, height: config.videoHeight }) };
    },

    generate(id, { consent = false } = {}) {
      const v = videos.get(id);
      wf.assertCanEnter(v, 6);
      const targets = pending(v).filter(s => !['queued', 'running'].includes(v.clips[s.id]?.status));
      ledger.check(id, estimateCost('video', { clips: targets.map(s => s.seconds), height: config.videoHeight }), consent);
      const saved = videos.mutate(id, 6, video => { for (const s of targets) ensureClip(video, s.id).status = 'queued'; }, { touch: false });
      jobs.start(async () => { for (const s of targets) await generateOne(id, s.id); });
      return saved;
    },

    regenerate(id, shotId, { instruction = '', lockLastFrame = false, consent = false } = {}) {
      const v = videos.get(id);
      wf.assertCanEnter(v, 6);
      const shot = v.script.shots.find(s => s.id === shotId);
      if (!shot) throw notFound('找不到分鏡');
      ledger.check(id, estimateCost('video', { seconds: shot.seconds, height: config.videoHeight }), consent);
      const saved = videos.mutate(id, 6, video => { ensureClip(video, shotId).status = 'queued'; }, { touch: false });
      jobs.start(() => generateOne(id, shotId, { instruction, lockLastFrame: Boolean(lockLastFrame) }));
      return saved;
    },

    update(id, shotId, { selected, quality }) {
      return videos.mutate(id, 6, v => {
        const c = v.clips[shotId];
        if (!c) throw notFound('這一格還沒有影片');
        if (selected !== undefined) {
          if (!c.versions.some(x => x.id === selected)) throw unprocessable('invalid_version', '沒有這個版本');
          c.selected = selected;
          markFinalStale(v);
        }
        if (quality) for (const k of CLIP_QUALITY) if (quality[k] !== undefined) c.quality[k] = Boolean(quality[k]);
      }, { touch: selected !== undefined });
    },
  };
}

function registerStep6Routes(router, { step6, present, videos }) {
  const base = '/api/videos/:id/clips';
  router.get(base, ({ params }) => {
    const v = videos.get(params.id);
    return { clips: present(v.clips), progress: v.script ? step6.progress(v) : null };
  });
  router.post(`${base}/generate`, async ({ params, json }) => new Reply(202, { video: present(step6.generate(params.id, await json())) }));
  router.post(`${base}/:shotId/regenerate`, async ({ params, json }) => new Reply(202, { video: present(step6.regenerate(params.id, params.shotId, await json())) }));
  router.patch(`${base}/:shotId`, async ({ params, json }) => ({ video: present(step6.update(params.id, params.shotId, await json())) }));
}

module.exports = { createStep6Service, registerStep6Routes, CLIP_QUALITY };
