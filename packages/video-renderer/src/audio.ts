/**
 * 音频链路：配音归一化 → ffprobe 实测时长 → 按镜头补静音 → 氛围音 → 混音。
 *
 * 没有配置 TTS 时不伪造人声：镜头音轨是静音，整片铺一层本地合成的氛围音，
 * 任务结果与导出页会明确标注「未配音」。以后接上 TTS 或用户放进 WAV，
 * 同一条链路会自动把人声混进去，并把镜头时长撑到配音结束之后。
 */
import fs from 'node:fs';
import path from 'node:path';
import { ffmpeg, probeDuration } from './ffmpeg.js';

const SAMPLE_RATE = 48_000;
const CHANNELS = 2;

/** 把该镜头需要的 1..N 段配音串成一条 48k/立体声 WAV，并测出真实时长。 */
export const prepareShotVoice = async (
  voiceFiles: string[],
  targetWav: string,
): Promise<{ path: string; durationSec: number } | null> => {
  const files = voiceFiles.filter((f) => f && fs.existsSync(f));
  if (!files.length) return null;
  fs.mkdirSync(path.dirname(targetWav), { recursive: true });
  const inputs: string[] = [];
  for (const file of files) inputs.push('-i', file);
  const labels = files.map((_, i) => `[a${i}]`);
  const resample = files.map((_, i) =>
    `[${i}:a]aresample=${SAMPLE_RATE},aformat=sample_fmts=s16:channel_layouts=stereo${labels[i]}`).join(';');
  const chain = files.length === 1
    ? `${resample};${labels[0]}anull[out]`
    : `${resample};${labels.join('')}concat=n=${files.length}:v=0:a=1[out]`;
  await ffmpeg([
    '-y', ...inputs,
    '-filter_complex', chain,
    '-map', '[out]', '-ar', String(SAMPLE_RATE), '-ac', String(CHANNELS),
    '-c:a', 'pcm_s16le', targetWav,
  ], { timeoutMs: 120_000 });
  return { path: targetWav, durationSec: await probeDuration(targetWav) };
};

/** 单镜头音轨：有配音就补尾部静音到镜头时长，无配音则整段静音。 */
export const buildShotAudio = async (
  voiceWav: string | null,
  durationSec: number,
  targetWav: string,
): Promise<void> => {
  fs.mkdirSync(path.dirname(targetWav), { recursive: true });
  const duration = durationSec.toFixed(3);
  if (voiceWav && fs.existsSync(voiceWav)) {
    await ffmpeg([
      '-y', '-i', voiceWav,
      '-af', `apad,atrim=duration=${duration}`,
      '-ar', String(SAMPLE_RATE), '-ac', String(CHANNELS), '-c:a', 'pcm_s16le', targetWav,
    ], { timeoutMs: 120_000 });
  } else {
    await ffmpeg([
      '-y', '-f', 'lavfi', '-i', `anullsrc=channel_layout=stereo:sample_rate=${SAMPLE_RATE}`,
      '-t', duration,
      '-ar', String(SAMPLE_RATE), '-ac', String(CHANNELS), '-c:a', 'pcm_s16le', targetWav,
    ], { timeoutMs: 120_000 });
  }
};

/** 把各镜头音轨首尾相接，得到与画面时间轴完全同长的一条音轨。 */
export const concatAudio = async (segments: string[], targetWav: string): Promise<void> => {
  const dir = path.dirname(targetWav);
  const listFile = path.join(dir, 'audio-concat.txt');
  fs.writeFileSync(listFile, segments.map((f) => `file '${path.basename(f)}'`).join('\n') + '\n', 'utf8');
  await ffmpeg([
    '-y', '-f', 'concat', '-safe', '0', '-i', listFile,
    '-ar', String(SAMPLE_RATE), '-ac', String(CHANNELS), '-c:a', 'pcm_s16le', targetWav,
  ], { cwd: dir, timeoutMs: 120_000 });
};

/** 本地合成的柔和氛围音（A 大三和弦 + 缓慢呼吸包络），淡入淡出，不冒充人声配音。 */
export const buildAmbient = async (totalSec: number, targetWav: string): Promise<void> => {
  const duration = Math.max(1, totalSec).toFixed(3);
  const fadeOutStart = Math.max(0, totalSec - 1.6).toFixed(3);
  const expr = [
    '0.10*sin(2*PI*220*t)*(0.55+0.45*sin(2*PI*0.13*t))',
    '0.07*sin(2*PI*277.18*t)*(0.55+0.45*sin(2*PI*0.11*t))',
    '0.05*sin(2*PI*329.63*t)*(0.55+0.45*sin(2*PI*0.17*t))',
    '0.03*sin(2*PI*440*t)*(0.5+0.5*sin(2*PI*0.07*t))',
  ].join('+');
  await ffmpeg([
    '-y', '-f', 'lavfi', '-i', `aevalsrc=${expr}:s=${SAMPLE_RATE}:d=${duration}`,
    '-af', `lowpass=f=1500,afade=t=in:st=0:d=1.2,afade=t=out:st=${fadeOutStart}:d=1.6`,
    '-ar', String(SAMPLE_RATE), '-ac', String(CHANNELS), '-c:a', 'pcm_s16le', targetWav,
  ], { timeoutMs: 120_000 });
};

/** 混音：人声主轨 + 低音量氛围音，限制峰值避免削波。 */
export const mixAudio = async (
  voiceWav: string,
  ambientWav: string,
  targetWav: string,
  backgroundVolume: number,
): Promise<void> => {
  await ffmpeg([
    '-y', '-i', voiceWav, '-i', ambientWav,
    '-filter_complex',
    `[1:a]volume=${backgroundVolume}[bg];[0:a][bg]amix=inputs=2:duration=first:dropout_transition=0,alimiter=limit=0.94[out]`,
    '-map', '[out]', '-ar', String(SAMPLE_RATE), '-ac', String(CHANNELS),
    '-c:a', 'pcm_s16le', targetWav,
  ], { timeoutMs: 120_000 });
};

export { probeDuration };
