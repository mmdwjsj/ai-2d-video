/** 只构造命令，不执行；阶段四由 server 的导出任务调用。 */

export type RenderCommand = { executable: string; args: string[] };

export const remotionRenderCommand = (input: {
  entry: string;
  composition: string;
  output: string;
  propsFile: string;
  codec?: string;
}): RenderCommand => ({
  executable: 'npx',
  args: [
    'remotion', 'render', input.entry, input.composition, input.output,
    `--props=${input.propsFile}`,
    `--codec=${input.codec ?? 'h264'}`,
    '--log=error',
  ],
});

/** 中间音频统一规格：WAV → 固定采样率/声道/音量，避免音画不同步。 */
export const ffmpegNormalizeAudioCommand = (input: {
  source: string;
  target: string;
  sampleRate: number;
  channels: number;
  volume?: number;
}): RenderCommand => ({
  executable: 'ffmpeg',
  args: [
    '-y', '-i', input.source,
    '-af', `volume=${input.volume ?? 1},aresample=${input.sampleRate}`,
    '-ac', String(input.channels),
    '-c:a', 'pcm_s16le', input.target,
  ],
});

/** 最终封装：H.264 视频 + AAC 音频，音视频都按时间轴裁到同一长度。 */
export const ffmpegMuxCommand = (input: {
  video: string;
  audio: string;
  output: string;
  durationSec: number;
}): RenderCommand => ({
  executable: 'ffmpeg',
  args: [
    '-y', '-i', input.video, '-i', input.audio,
    '-t', input.durationSec.toFixed(3),
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-b:a', '192k',
    '-shortest', input.output,
  ],
});

/** ffprobe 读音频真实时长，时间轴只认这个数。 */
export const ffprobeDurationCommand = (file: string): RenderCommand => ({
  executable: 'ffprobe',
  args: [
    '-v', 'error', '-show_entries', 'format=duration',
    '-of', 'default=noprint_wrappers=1:nokey=1', file,
  ],
});
