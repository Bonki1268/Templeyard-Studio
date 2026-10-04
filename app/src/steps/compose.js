// 成品合成：串接分鏡影片、台詞（模型原生語音或語音合成）、背景音樂與燒錄繁中字幕，
// 輸出 16:9、設定的解析度與 fps、30 秒以內的 MP4。使用者確認成品後才能下載。
const fs = require('node:fs');
const path = require('node:path');
const { HttpError, unprocessable, notFound, Reply, sendFile } = require('../http');
const { ffmpeg, probe } = require('../media/ffmpeg');
const { estimateCost, round } = require('../cost/prices');
const wf = require('../videos/workflow');

const MAX_SECONDS = 30;
const TRACKS = [
  { id: 'warm-piano', name: '溫暖鋼琴・慢板' },
  { id: 'temple-drums', name: '廟會鼓聲・輕快' },
  { id: 'gentle-strings', name: '柔和弦樂' },
  { id: 'none', name: '不加背景音樂' },
];
const MUSIC_TYPES = { 'audio/mpeg': '.mp3', 'audio/mp4': '.m4a', 'audio/x-m4a': '.m4a', 'audio/aac': '.m4a', 'audio/wav': '.wav', 'audio/x-wav': '.wav' };
const DEFAULT_AUDIO = { voiceMode: 'native', music: 'warm-piano', subtitles: true };

function timeline(shots) {
  let t = 0;
  return shots.map(s => { const item = { shot: s, start: t, end: t + Number(s.seconds) }; t = item.end; return item; });
}

function assTime(sec) {
  const cs = Math.round(sec * 100);
  const h = Math.floor(cs / 360000);
  const m = Math.floor((cs % 360000) / 6000);
  const s = Math.floor((cs % 6000) / 100);
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(cs % 100).padStart(2, '0')}`;
}

// 繁中字幕：白字、黑色描邊、下方置中（Alignment 2）。
function assSubtitles(shots, { width, height }) {
  const size = Math.round(height * 0.055);
  const margin = Math.round(height * 0.06);
  const outline = Math.max(1, Math.round(height / 360));
  const lines = timeline(shots)
    .filter(({ shot }) => (shot.subtitle || '').trim())
    .map(({ shot, start, end }) => `Dialogue: 0,${assTime(start)},${assTime(end)},Default,,0,0,0,,${shot.subtitle.trim().replace(/\n/g, '\\N')}`);
  return [
    '[Script Info]', 'ScriptType: v4.00+', `PlayResX: ${width}`, `PlayResY: ${height}`, 'WrapStyle: 0', '',
    '[V4+ Styles]',
    'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
    `Style: Default,PingFang TC,${size},&H00FFFFFF,&H000000FF,&H00000000,&H64000000,0,0,0,0,100,100,0,0,1,${outline},0,2,${margin},${margin},${margin},1`,
    '', '[Events]', 'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
    ...lines, '',
  ].join('\n');
}

function createComposeService({ videos, generations, ledger, store, config, jobs, ai }) {
  const media = rel => path.join(config.mediaDir, rel);
  const audioOf = v => ({ ...DEFAULT_AUDIO, ...(v.audio || {}) });
  const speaks = shot => Boolean(shot.line) && shot.speaker && shot.speaker !== '旁白';

  // 需要語音合成的台詞：旁白一律合成；選「語音合成」時角色台詞也合成。
  const ttsShots = v => v.script.shots.filter(s => s.line && (audioOf(v).voiceMode === 'tts' || !speaks(s)));

  function tracks(v) {
    return [...TRACKS, ...(v.musicUploads || []).map(u => ({ id: u.id, name: u.name, uploaded: true }))];
  }

  async function musicFile(v, id, seconds) {
    if (id === 'none') return null;
    const upload = (v.musicUploads || []).find(u => u.id === id);
    if (upload) return media(upload.file);
    const { result } = await generations.runDirect({
      videoId: v.id, step: 7, kind: 'music', input: { track: id, seconds }, consent: true,
      call: provider => provider.music.track(id, seconds),
    });
    return result.file;
  }

  async function render(id) {
    const v = videos.get(id);
    const { width, height, fps } = config.output;
    const audio = audioOf(v);
    const shots = v.script.shots;
    const total = Math.min(MAX_SECONDS, round(shots.reduce((s, x) => s + Number(x.seconds), 0)));
    const work = path.join(config.mediaDir, 'videos', id, 'work');
    fs.mkdirSync(work, { recursive: true });
    const args = [];
    const filters = [];
    let input = 0;
    const addInput = (...a) => { args.push(...a); return input++; };

    const clips = shots.map(s => {
      const c = v.clips[s.id];
      return { shot: s, file: media(c.versions.find(x => x.id === c.selected).file) };
    });
    for (const [i, c] of clips.entries()) {
      const info = await probe(c.file);
      const vi = addInput('-i', c.file);
      const sec = Number(c.shot.seconds);
      filters.push(`[${vi}:v]scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=${fps},trim=duration=${sec},setpts=PTS-STARTPTS[v${i}]`);
      if (audio.voiceMode === 'native' && speaks(c.shot) && info.hasAudio) {
        filters.push(`[${vi}:a]aresample=44100,aformat=channel_layouts=stereo,apad,atrim=duration=${sec},asetpts=PTS-STARTPTS[a${i}]`);
      } else {
        filters.push(`anullsrc=r=44100:cl=stereo,atrim=duration=${sec}[a${i}]`);
      }
    }
    filters.push(`${clips.map((_, i) => `[v${i}][a${i}]`).join('')}concat=n=${clips.length}:v=1:a=1[vc][ac]`);

    if (audio.subtitles) {
      fs.writeFileSync(path.join(work, 'subs.ass'), assSubtitles(shots, { width, height }));
      filters.push('[vc]subtitles=subs.ass[vout]');
    } else filters.push('[vc]null[vout]');

    const mix = ['[ac]'];
    const starts = new Map(timeline(shots).map(t => [t.shot.id, t.start]));
    for (const [j, s] of ttsShots(v).entries()) {
      const { result } = await generations.runDirect({
        videoId: id, step: 7, kind: 'voice', input: { text: s.line, speaker: s.speaker }, units: { count: 1 }, consent: true, meta: { shotId: s.id },
        call: provider => provider.voice.synthesize({ text: s.line, speaker: s.speaker }),
      });
      const ti = addInput('-i', result.file);
      const ms = Math.round(starts.get(s.id) * 1000);
      filters.push(`[${ti}:a]aresample=44100,aformat=channel_layouts=stereo,adelay=${ms}|${ms}[t${j}]`);
      mix.push(`[t${j}]`);
    }
    const bgm = await musicFile(v, audio.music, Math.ceil(total));
    if (bgm) {
      const bi = addInput('-stream_loop', '-1', '-i', bgm);
      filters.push(`[${bi}:a]aresample=44100,aformat=channel_layouts=stereo,volume=0.25,atrim=duration=${total}[bg]`);
      mix.push('[bg]');
    }
    filters.push(mix.length > 1 ? `${mix.join('')}amix=inputs=${mix.length}:duration=first:normalize=0[aout]` : '[ac]anull[aout]');

    const version = (v.finals?.length || 0) + (v.final?.file ? 1 : 0) + 1;
    const rel = `videos/${id}/final-v${version}.mp4`;
    await ffmpeg([...args, '-filter_complex', filters.join(';'), '-map', '[vout]', '-map', '[aout]', '-t', String(total),
      '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p', '-r', String(fps),
      '-c:a', 'aac', '-b:a', '160k', '-movflags', '+faststart', media(rel)], { cwd: work });
    const info = await probe(media(rel));
    return { file: rel, duration: round(info.duration), width: info.width, height: info.height, fps: info.fps, music: audio.music, voiceMode: audio.voiceMode, subtitles: audio.subtitles };
  }

  return {
    tracks,
    estimate(id) {
      const v = videos.get(id);
      const count = ttsShots(v).length;
      return { action: 'compose', voiceCount: count, estimate: estimateCost('voice', { count }) };
    },

    setAudio(id, patch) {
      return videos.mutate(id, 7, v => {
        const a = audioOf(v);
        if (patch.voiceMode !== undefined) {
          if (!['native', 'tts'].includes(patch.voiceMode)) throw unprocessable('invalid_voice_mode', '台詞語音必須是 native 或 tts');
          a.voiceMode = patch.voiceMode;
        }
        if (patch.music !== undefined) {
          if (!tracks(v).some(t => t.id === patch.music)) throw unprocessable('invalid_music', '沒有這首背景音樂');
          a.music = patch.music;
        }
        if (patch.subtitles !== undefined) a.subtitles = Boolean(patch.subtitles);
        v.audio = a;
        if (v.final) v.final.stale = true;
      });
    },

    uploadMusic(id, { buffer, filename, contentType }) {
      const ext = MUSIC_TYPES[(contentType || '').split(';')[0].trim()];
      if (!ext) throw new HttpError(415, 'unsupported_type', '只接受 MP3、M4A／AAC 或 WAV 音樂檔');
      const trackId = `upload-${store.newId()}`;
      const rel = `videos/${id}/music/${trackId}${ext}`;
      fs.mkdirSync(path.dirname(media(rel)), { recursive: true });
      fs.writeFileSync(media(rel), buffer);
      const track = { id: trackId, name: filename || `上傳的音樂${ext}`, file: rel };
      const video = videos.mutate(id, 7, v => {
        (v.musicUploads ||= []).push(track);
        v.audio = { ...audioOf(v), music: trackId };
        if (v.final) v.final.stale = true;
      });
      return { video, track: { id: track.id, name: track.name, uploaded: true } };
    },

    compose(id, { consent = false } = {}) {
      const v = videos.get(id);
      wf.assertCanEnter(v, 7);
      const missing = v.script.shots.filter(s => !v.clips[s.id]?.selected).map(s => s.index);
      if (missing.length) throw unprocessable('clips_missing', `第 ${missing.join('、')} 格還沒有分鏡影片`);
      if (v.final?.status === 'composing') throw new HttpError(409, 'composing', '成品正在合成中');
      ledger.check(id, this.estimate(id).estimate, consent);
      const saved = videos.mutate(id, 7, video => {
        if (video.final?.file) (video.finals ||= []).push(video.final);
        video.final = { status: 'composing', stale: false };
      });
      jobs.start(async () => {
        try {
          const result = await render(id);
          videos.mutate(id, 7, video => { video.final = { ...result, status: 'done', stale: false, quality: {}, composedAt: new Date().toISOString() }; }, { touch: false });
        } catch (err) {
          videos.mutate(id, 7, video => { video.final = { status: 'failed', error: err.message.slice(0, 500), stale: false }; }, { touch: false });
        }
      });
      return saved;
    },

    setQuality(id, quality = {}) {
      return videos.mutate(id, 7, v => {
        if (!v.final?.file) throw unprocessable('no_final', '還沒有成品');
        v.final.quality ||= {};
        for (const k of ['face', 'lipsync', 'subtitles', 'duration']) if (quality[k] !== undefined) v.final.quality[k] = Boolean(quality[k]);
      }, { touch: false });
    },

    downloadable(id) {
      const v = videos.get(id);
      if (v.steps[wf.LAST].status !== 'confirmed' || !v.final?.file) throw new HttpError(409, 'not_confirmed', '請先確認成品，才能下載');
      return { file: media(v.final.file), name: `${(v.title || '廟埕影室成品').replace(/[\\/:*?"<>|]/g, '_')}.mp4` };
    },
  };
}

function registerComposeRoutes(router, { compose, present, videos }) {
  const base = '/api/videos/:id';
  router.get(`${base}/music`, ({ params }) => ({ tracks: compose.tracks(videos.get(params.id)) }));
  router.post(`${base}/music`, async ({ params, req, raw }) => {
    videos.get(params.id);
    const { video, track } = compose.uploadMusic(params.id, {
      buffer: await raw(40_000_000), filename: decodeURIComponent(req.headers['x-filename'] || ''), contentType: req.headers['content-type'],
    });
    return new Reply(201, { video: present(video), track });
  });
  router.put(`${base}/audio`, async ({ params, json }) => ({ video: present(compose.setAudio(params.id, await json())) }));
  router.post(`${base}/compose`, async ({ params, json }) => new Reply(202, { video: present(compose.compose(params.id, await json())) }));
  router.patch(`${base}/final`, async ({ params, json }) => ({ video: present(compose.setQuality(params.id, (await json()).quality)) }));
  router.get(`${base}/download`, ({ params, res }) => {
    const { file, name } = compose.downloadable(params.id);
    sendFile(res, file, { 'Content-Disposition': `attachment; filename="video.mp4"; filename*=UTF-8''${encodeURIComponent(name)}` });
  });
}

module.exports = { createComposeService, registerComposeRoutes, assSubtitles, timeline, TRACKS, DEFAULT_AUDIO };
