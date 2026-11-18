/**
 * 真实 MP4 合成：镜头帧 → Ken Burns 动效片段 → concat → 音频对齐 → H.264/AAC 封装。
 *
 * 时长铁律：每段帧数 = round(durationSec * fps)，音频段裁到同一个时长，
 * 最终容器按总帧数定长。server 侧已用 computeTimeline 把每个镜头撑到
 * 「配音实测时长 + 尾部留白」以上，所以视频不会早于配音结束。
 */
import fs from 'node:fs';
import path from 'node:path';
import { ffmpeg } from './ffmpeg.js';
import { buildAmbient, buildShotAudio, concatAudio, mixAudio } from './audio.js';

export type RenderSegment = {
  id: string;
  framePng: string;
  /**
   * 逐帧口型画面序列（ffmpeg image2 pattern，如 .../f%05d.png）。
   * 有值就替代「单张 PNG 循环」，帧数仍由 durationSec × fps 决定。
   */
  frameSequence?: string;
  durationSec: number;
  /** 该镜头的配音 WAV（已归一化）；null = 无配音 */
  voiceWav: string | null;
  /** 片头片尾不做推近动效 */
  motion?: boolean;
};

export type RenderInput = {
  workDir: string;
  outputFile: string;
  segments: RenderSegment[];
  fps: number;
  width: number;
  height: number;
  backgroundVolume?: number;
  onProgress?: (percent: number, note: string) => void;
};

export type RenderResult = {
  file: string;
  durationSec: number;
  sizeBytes: number;
  totalFrames: number;
  hasVoiceOver: boolean;
  warnings: string[];
};

/**
 * 异步清理中间产物，fire-and-forget。
 * 关键：绝不能用同步递归删除 —— Edge 缓存目录有上百 MB、上千个小文件，
 * 同步删除会长时间阻塞 Node 事件循环，让进度轮询请求看起来「渲染卡死」。
 * 也不用 fs.rmSync：部分受管环境会拦截递归删除。
 */
export const scheduleCleanup = (dir: string): void => {
  const walk = async (current: string): Promise<void> => {
    let entries: fs.Dirent[];
    try { entries = await fs.promises.readdir(current, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      const full = path.join(current, entry.name);
      try {
        if (entry.isDirectory()) await walk(full);
        else await fs.promises.unlink(full);
      } catch { /* 被占用/受保护的文件跳过 */ }
    }
    try { await fs.promises.rmdir(current); } catch { /* 删不掉就留着，不影响成片 */ }
  };
  void walk(dir);
};

const videoFilter = (w: number, h: number, fps: number, motion: boolean): string => {
  const base = `scale=${w}:${h}:flags=lanczos`;
  const zoom = motion
    ? `,zoompan=z='min(zoom+0.00030,1.05)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=1:s=${w}x${h}:fps=${fps}`
    : `,zoompan=z='1':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=1:s=${w}x${h}:fps=${fps}`;
  return `${base}${zoom},fade=t=in:st=0:d=0.2,format=yuv420p`;
};

export const renderVideo = async (input: RenderInput): Promise<RenderResult> => {
  const { workDir, outputFile, segments, fps, width, height } = input;
  if (!segments.length) throw new Error('没有可渲染的镜头，请先「自动分镜」');
  for (const segment of segments) {
    if (segment.frameSequence) {
      const first = segment.frameSequence.replace(/%\d*d/, '00001');
      if (!fs.existsSync(first)) throw new Error(`口型帧序列缺失：${first}`);
    } else if (!fs.existsSync(segment.framePng)) {
      throw new Error(`镜头画面缺失：${segment.framePng}`);
    }
  }
  fs.mkdirSync(workDir, { recursive: true });
  fs.mkdirSync(path.dirname(outputFile), { recursive: true });

  const warnings: string[] = [];
  const progress = input.onProgress ?? (() => undefined);
  const videoParts: string[] = [];
  const audioParts: string[] = [];
  const framesOf = (sec: number): number => Math.max(1, Math.round(sec * fps));
  let totalFrames = 0;
  for (const segment of segments) totalFrames += framesOf(segment.durationSec);

  /* 1. 每镜头：画面片段 + 同长音轨 --------------------------------------- */
  for (let i = 0; i < segments.length; i += 1) {
    const segment = segments[i];
    const frames = framesOf(segment.durationSec);
    const videoPart = path.join(workDir, `seg-${String(i).padStart(2, '0')}.mp4`);
    const audioPart = path.join(workDir, `audio-${String(i).padStart(2, '0')}.wav`);
    progress(8 + Math.round((i / segments.length) * 56), `合成第 ${i + 1}/${segments.length} 个镜头`);

    // 有口型帧序列就逐帧播放；片头片尾 / 旁白镜头仍用单图循环，省掉多余截图。
    const inputArgs = segment.frameSequence
      ? ['-framerate', String(fps), '-i', segment.frameSequence]
      : ['-loop', '1', '-framerate', String(fps), '-i', segment.framePng];
    await ffmpeg([
      '-y', ...inputArgs,
      '-vf', videoFilter(width, height, fps, segment.motion !== false),
      '-frames:v', String(frames),
      '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20',
      '-pix_fmt', 'yuv420p', '-r', String(fps), '-an', videoPart,
    ], { timeoutMs: 180_000 });

    // buildShotAudio 内部用 apad+atrim 或 anullsrc 精确裁到 duration，无需二次处理。
    await buildShotAudio(segment.voiceWav, frames / fps, audioPart);

    videoParts.push(videoPart);
    audioParts.push(audioPart);
  }

  /* 2. 拼接画面 ------------------------------------------------------------ */
  progress(70, '拼接镜头');
  const videoList = path.join(workDir, 'video-concat.txt');
  fs.writeFileSync(videoList, videoParts.map((f) => `file '${path.basename(f)}'`).join('\n') + '\n', 'utf8');
  const silentVideo = path.join(workDir, 'video.mp4');
  await ffmpeg([
    '-y', '-f', 'concat', '-safe', '0', '-i', videoList,
    '-c', 'copy', '-movflags', '+faststart', silentVideo,
  ], { cwd: workDir, timeoutMs: 180_000 });

  /* 3. 拼接音轨 + 氛围音 + 混音 -------------------------------------------- */
  progress(80, '对齐配音与背景音');
  const voiceWav = path.join(workDir, 'voice.wav');
  await concatAudio(audioParts, voiceWav);
  const ambientWav = path.join(workDir, 'ambient.wav');
  const totalSec = totalFrames / fps;
  await buildAmbient(totalSec, ambientWav);
  const hasVoiceOver = segments.some((s) => Boolean(s.voiceWav));
  const mixedWav = path.join(workDir, 'audio.wav');
  await mixAudio(voiceWav, ambientWav, mixedWav, hasVoiceOver
    ? (input.backgroundVolume ?? 0.22)
    : (input.backgroundVolume ?? 0.42));

  /* 4. 封装：H.264 画面 + AAC 音频，按总帧数定长 ---------------------------- */
  progress(92, '封装 MP4（H.264 / AAC）');
  await ffmpeg([
    '-y', '-i', silentVideo, '-i', mixedWav,
    '-map', '0:v:0', '-map', '1:a:0',
    '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', '-ar', '48000', '-ac', '2',
    '-t', totalSec.toFixed(3), '-movflags', '+faststart', outputFile,
  ], { timeoutMs: 180_000 });

  if (!fs.existsSync(outputFile) || fs.statSync(outputFile).size < 1024) {
    throw new Error('MP4 未生成或文件异常小，请查看任务日志');
  }
  progress(100, '成片已生成');
  const result: RenderResult = {
    file: outputFile,
    durationSec: Math.round(totalSec * 1000) / 1000,
    sizeBytes: fs.statSync(outputFile).size,
    totalFrames,
    hasVoiceOver,
    warnings,
  };
  // 中间产物只占空间，成功后异步清理；失败时保留在 workDir 便于排查。
  scheduleCleanup(workDir);
  return result;
};
