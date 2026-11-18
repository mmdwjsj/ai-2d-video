import type { Language } from '@thai-video/core/types';
import type { TtsDiagnosis } from './diagnose.js';

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

/** 导出前的本机环境自检结果：把「缺包」和「断网」在真正逐句合成前分开。 */
export type TtsPreflight = {
  ok: boolean;
  /** 实际选中的解释器（自动探测时可能不是配置里写的那个） */
  command: string;
  /** 该引擎是否需要公网，界面据此解释「为什么会联网」 */
  requiresNetwork: boolean;
  networkNote: string;
  /** 失败时的完整原始报错，不截断，避免把 edge_tts 截成 edg */
  reason: string;
  diagnosis?: TtsDiagnosis;
};

export type TtsProvider = {
  readonly id: string;
  readonly available: boolean;
  synthesize(request: TtsRequest): Promise<TtsResult>;
  /** 用 ffprobe 读真实 WAV 时长，视频时间轴只认这个数 */
  probeDuration(wavPath: string): Promise<number>;
  /** 可选：导出前检查命令与依赖是否就绪，并给出可操作的失败说明 */
  preflight?(): Promise<TtsPreflight>;
};
