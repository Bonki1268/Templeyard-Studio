// 本機 ffmpeg／ffprobe 呼叫。
const { spawn } = require('node:child_process');

function exec(cmd, args) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    const out = []; const err = [];
    p.stdout.on('data', d => out.push(d));
    p.stderr.on('data', d => err.push(d));
    p.on('error', reject);
    p.on('close', code => {
      if (code === 0) resolve(Buffer.concat(out).toString('utf8'));
      else reject(new Error(`${cmd} 失敗（${code}）：${Buffer.concat(err).toString('utf8').slice(-800)}`));
    });
  });
}

const ffmpeg = args => exec('ffmpeg', ['-y', '-hide_banner', '-loglevel', 'error', ...args]);

async function probe(file) {
  const json = JSON.parse(await exec('ffprobe', ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', file]));
  const video = json.streams.find(s => s.codec_type === 'video');
  const audio = json.streams.find(s => s.codec_type === 'audio');
  const [n, d] = (video?.r_frame_rate || '0/1').split('/').map(Number);
  return {
    width: video?.width, height: video?.height, fps: d ? n / d : 0,
    duration: Number(json.format.duration), hasVideo: Boolean(video), hasAudio: Boolean(audio),
    videoCodec: video?.codec_name, audioCodec: audio?.codec_name, format: json.format.format_name,
  };
}

module.exports = { ffmpeg, probe, exec };
