import type { ExportMode } from '@thai-video/core/types';

export type TimelineInputShot = {
  id: string;
  durationSec: number;
  audioZhPath: string;
  audioThPath: string;
};

export type TimelineShot = {
  shotId: string;
  startSec: number;
  durationSec: number;
  /** 分镜里填写的画面时长，仅作下限 */
  sourceDurationSec: number;
  audioDurationSec: number;
  audioPaths: string[];
  subtitleMode: ExportMode;
};

export type Timeline = {
  mode: ExportMode;
  fps: number;
  shots: TimelineShot[];
  totalSec: number;
  totalFrames: number;
  warnings: string[];
};

/**
 * 时间轴铁律：镜头时长 = max(分镜画面时长, 该镜头所有语音时长 + 尾部留白)。
 * 视频总时长为所有镜头之和，**绝不允许视频早于配音结束**。
 * 音频时长只认 ffprobe 实测值（audioDurations），没有实测值就如实告警。
 */
export const computeTimeline = (
  shots: TimelineInputShot[],
  audioDurations: Record<string, number>,
  mode: ExportMode,
  opts: { fps?: number; tailPadSec?: number } = {},
): Timeline => {
  const fps = opts.fps ?? 30;
  const tailPad = opts.tailPadSec ?? 0.4;
  const warnings: string[] = [];
  let cursor = 0;
  const result: TimelineShot[] = shots.map((shot) => {
    const wanted: string[] = mode === 'zh' ? [shot.audioZhPath]
      : mode === 'th' ? [shot.audioThPath]
        : [shot.audioThPath, shot.audioZhPath];
    const audioPaths = wanted.filter(Boolean);
    if (audioPaths.length < wanted.length) {
      warnings.push(`镜头 ${shot.id} 缺少${mode === 'bilingual' ? '部分' : ''}配音文件，时间轴按已有音频计算`);
    }
    let audioDurationSec = 0;
    for (const path of audioPaths) {
      const measured = audioDurations[path];
      if (typeof measured !== 'number' || !Number.isFinite(measured)) {
        warnings.push(`镜头 ${shot.id} 的音频未探测到时长：${path}`);
      } else {
        audioDurationSec = Math.max(audioDurationSec, measured);
      }
    }
    const minimum = audioDurationSec > 0 ? audioDurationSec + tailPad : 0;
    const needed = Math.max(shot.durationSec || 0, minimum);
    const frames = Math.max(1, Math.ceil(needed * fps));
    const durationSec = frames / fps;
    const item: TimelineShot = {
      shotId: shot.id,
      startSec: cursor,
      durationSec,
      sourceDurationSec: shot.durationSec,
      audioDurationSec,
      audioPaths,
      subtitleMode: mode,
    };
    cursor += durationSec;
    return item;
  });
  const totalFrames = Math.round(cursor * fps);
  return {
    mode, fps, shots: result,
    totalSec: totalFrames / fps,
    totalFrames,
    warnings,
  };
};
