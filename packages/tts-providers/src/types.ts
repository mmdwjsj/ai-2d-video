import type { Language } from '@thai-video/core/types';

export type TtsRequest = {
  text: string;
  language: Language;
  engine: string;
  voice: string;
  speed: number;
  volume: number;
  emotion: string;
  /** 单句重新生成时用镜头 ID + 语言做缓存键，避免反复付费 */
  shotId?: string;
};

export type TtsResult = {
  wavPath: string;
  durationSec: number;
  sampleRate: number;
  channels: number;
  provider: string;
  model: string;
  cost: number;
  cacheKey: string;
};

export type TtsProvider = {
  readonly id: string;
  readonly available: boolean;
  synthesize(request: TtsRequest): Promise<TtsResult>;
  /** 用 ffprobe 读真实 WAV 时长，视频时间轴只认这个数 */
  probeDuration(wavPath: string): Promise<number>;
};
