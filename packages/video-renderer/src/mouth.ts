/**
 * 对白镜头的口型驱动（服务端部分）：WAV 能量 → 四档嘴型 → 逐帧画面序列。
 *
 * 主导出链路以前是「每镜头一张静帧 + FFmpeg 推近」，人物嘴完全不动；
 * 真正会动嘴的只有 scripts/demo_animation.py 那条独立 Python 链路。
 * 这里把口型接回主链路，并保持与 demo 相同的判定口径：
 *   RMS 包络 → 88 分位归一 → 3 帧滑动平均 → closed / small / open / wide。
 *
 * 帧序列用硬链接复用 4 张口型底图：30fps × 4s = 120 帧，但磁盘上仍只有 4 张 PNG。
 *
 * 纯计算（阈值、文本节奏、类型）放在 mouthCore.ts，浏览器预览直接复用，
 * 本文件只保留需要读盘 / 写盘的部分，前端不会把 node:fs 打进 bundle。
 */
import fs from 'node:fs';
import path from 'node:path';
import {
  MOUTH_SHAPES, levelsToTimeline, textMouthTimeline,
} from './mouthCore.js';
import type { MouthShape, MouthTimelineInput } from './mouthCore.js';

export * from './mouthCore.js';

type Wav = {
  buffer: Buffer;
  sampleRate: number;
  channels: number;
  bits: number;
  offset: number;
  length: number;
};

/** 只认 PCM WAV（prepareShotVoice 输出的就是 48k/16bit/立体声），其它格式交给文本节奏兜底。 */
const openWav = (file: string): Wav | null => {
  try {
    const buffer = fs.readFileSync(file);
    if (buffer.length < 44
      || buffer.toString('ascii', 0, 4) !== 'RIFF'
      || buffer.toString('ascii', 8, 12) !== 'WAVE') return null;
    let cursor = 12;
    let channels = 1;
    let sampleRate = 48_000;
    let bits = 16;
    while (cursor + 8 <= buffer.length) {
      const id = buffer.toString('ascii', cursor, cursor + 4);
      const size = buffer.readUInt32LE(cursor + 4);
      const body = cursor + 8;
      if (id === 'fmt ' && size >= 16) {
        channels = buffer.readUInt16LE(body + 2);
        sampleRate = buffer.readUInt32LE(body + 4);
        bits = buffer.readUInt16LE(body + 14);
      } else if (id === 'data') {
        return { buffer, sampleRate, channels, bits, offset: body, length: Math.min(size, buffer.length - body) };
      }
      cursor = body + size + (size % 2);
    }
  } catch { /* 缺文件 / 非 PCM：回退文本节奏 */ }
  return null;
};

/**
 * 按视频帧取 RMS 能量，返回与帧数等长的归一化 level（0..1）。
 * 返回 null 表示没有可用人声，调用方应改用台词节奏，避免「有配音文件但是静音 → 全程闭嘴」。
 */
export const voiceLevels = (wavPath: string | null | undefined, fps: number, frames: number): number[] | null => {
  if (!wavPath) return null;
  const wav = openWav(wavPath);
  if (!wav || wav.bits !== 16 || wav.channels < 1 || wav.sampleRate < 8000) return null;
  const frameBytes = 2 * wav.channels;
  const totalSamples = Math.floor(wav.length / frameBytes);
  const window = Math.max(1, Math.round(wav.sampleRate / Math.max(1, fps)));
  const rms: number[] = [];
  for (let k = 0; k < frames; k += 1) {
    const start = Math.min(totalSamples, Math.floor((k * wav.sampleRate) / Math.max(1, fps)));
    const end = Math.min(totalSamples, start + window);
    let sum = 0;
    for (let s = start; s < end; s += 1) {
      const v = wav.buffer.readInt16LE(wav.offset + s * frameBytes) / 32768;
      sum += v * v;
    }
    rms.push(end > start ? Math.sqrt(sum / (end - start)) : 0);
  }
  if (!rms.some((v) => v > 0.001)) return null;
  const sorted = [...rms].sort((a, b) => a - b);
  const ref = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.88))] || 1;
  const levels = rms.map((v) => Math.min(1, v / ref));
  // 3 帧滑动平均，嘴型不抖
  return levels.map((_, i) => {
    const from = Math.max(0, i - 1);
    const to = Math.min(levels.length, i + 2);
    return levels.slice(from, to).reduce((sum, v) => sum + v, 0) / (to - from);
  });
};

/** 该镜头实际用到的嘴型：只截这几张图，不必每张镜头都截四张。 */
export const usedShapes = (timeline: MouthShape[]): MouthShape[] =>
  MOUTH_SHAPES.filter((shape) => timeline.includes(shape));

/**
 * 生成与视频帧一一对应的嘴型序列。
 * 有配音 → 跟真实音量走；没有配音 → 按台词长度做确定性开合，句尾闭嘴。
 * 后者不是伪造人声，只是让「对话镜头」的画面不呆住，音轨仍如实标注未配音。
 */
export const mouthTimeline = ({ frames, fps, voiceWav = null, text = '' }: MouthTimelineInput): MouthShape[] => {
  const n = Math.max(1, Math.floor(frames));
  const rate = Math.max(1, fps);
  const levels = voiceLevels(voiceWav, rate, n);
  if (levels && levels.some((v) => v > 0.02)) return levelsToTimeline(levels);
  return textMouthTimeline({ frames: n, fps: rate, text });
};

/** 把 4 张口型底图按时间轴铺成 f00001.png… 的帧序列，返回 ffmpeg 的 image2 pattern。 */
export const writeFrameSequence = (input: {
  dir: string;
  shapePngs: Partial<Record<MouthShape, string>>;
  timeline: MouthShape[];
}): string => {
  const { dir, shapePngs, timeline } = input;
  const fallback = shapePngs.closed ?? Object.values(shapePngs).find((v): v is string => Boolean(v));
  if (!fallback) throw new Error('口型画面缺失：没有生成任何可用的底图 PNG');
  if (!timeline.length) throw new Error('口型时间轴为空');
  fs.mkdirSync(dir, { recursive: true });
  for (let k = 0; k < timeline.length; k += 1) {
    const src = shapePngs[timeline[k]] ?? fallback;
    if (!fs.existsSync(src)) throw new Error(`口型底图缺失：${src}`);
    const dst = path.join(dir, `f${String(k + 1).padStart(5, '0')}.png`);
    try { fs.linkSync(src, dst); } catch { fs.copyFileSync(src, dst); }
  }
  return path.join(dir, 'f%05d.png');
};
