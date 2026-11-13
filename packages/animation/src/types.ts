/** 普通对话镜头用固定人物素材 + 表情/动作参数，不调 AI 视频模型。 */
export type MouthCue = { atSec: number; shape: 'closed' | 'small' | 'wide' | 'round'; intensity: number };

export type AnimationPlan = {
  shotId: string;
  kind: 'static-2d' | 'ai-video';
  expression: string;
  pose: string;
  blinkAtSec: number[];
  mouthCues: MouthCue[];
  /** 镜头运动（推/拉/摇）作用在整层，不改人物素材 */
  cameraMove: string;
  notes: string;
};

export type PlanInput = {
  shotId: string;
  action: string;
  expression: string;
  cameraMove: string;
  durationSec: number;
  audioDurationSec?: number;
  complexActions?: string[];
};
