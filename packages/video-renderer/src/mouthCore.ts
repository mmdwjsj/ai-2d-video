/**
 * 口型判定的纯计算部分：服务端导出与浏览器预览共用，绝不依赖 node:fs。
 *
 * 以前这些常量和节奏算法都放在 mouth.ts 里，而 mouth.ts 要读 WAV、铺帧序列，
 * 前端一 import 就会把 node:fs 打进浏览器 bundle。拆出来以后，两边用的是
 * 同一套档位阈值和同一套无配音节奏，不会出现「预览动得跟成片不一样」。
 */
export const MOUTH_SHAPES = ['closed', 'small', 'open', 'wide'] as const;
export type MouthShape = (typeof MOUTH_SHAPES)[number];

/** 能量档位阈值，与 scripts/demo_animation.py 的 level_to_kind 对齐。 */
export const levelToShape = (level: number): MouthShape => {
  if (level < 0.10) return 'closed';
  if (level < 0.28) return 'small';
  if (level < 0.62) return 'open';
  return 'wide';
};

export type MouthTimelineInput = {
  frames: number;
  fps: number;
  voiceWav?: string | null;
  /** 没有真实配音时用来估算说话节奏的台词汇 */
  text?: string;
};

/** 有真实配音能量时：逐帧 level → 逐帧嘴型。 */
export const levelsToTimeline = (levels: number[]): MouthShape[] => levels.map(levelToShape);

/**
 * 没有配音时按台词长度做确定性开合，句尾闭嘴。
 * 不是伪造人声，只是让「对话镜头」的画面不呆住，音轨仍如实标注未配音。
 */
export const textMouthTimeline = ({ frames, fps, text = '' }: MouthTimelineInput): MouthShape[] => {
  const n = Math.max(1, Math.floor(frames));
  const rate = Math.max(1, fps);
  const syllables = [...text].filter((ch) => !/[\s，。！？、；：,.!?…~]/.test(ch)).length;
  const speechSec = Math.min((n / rate) * 0.86, Math.max(0.6, syllables * 0.22));
  const cycle: MouthShape[] = ['small', 'open', 'wide', 'open', 'small', 'closed'];
  return Array.from({ length: n }, (_, k) => {
    const t = k / rate;
    return t > speechSec ? 'closed' : cycle[Math.floor(t / 0.14) % cycle.length];
  });
};
