import type {
  Character, Language, LanguageMode, Scene, Script, ScriptInputMode, ScriptLine,
} from '@thai-video/core/types';

/** 文本模型生成的剧本草稿（不含持久化字段，由 core 落盘）。 */
export type ScriptDraft = {
  title: string;
  structure: string;
  hook: string;
  cast: { characterId: string; role: string }[];
  lines: ScriptLine[];
  zh: string;
  th: string;
  narrationZh: string;
  narrationTh: string;
  emotion: string;
  actionSuggestion: string;
  sceneSuggestions: string[];
  shotCountEstimate: number;
  durationEstimateSec: number;
  /** 本地规则实现会标注「泰语为口语句式模板，需人工/模型校对」 */
  note: string;
};

export type GenerateScriptInput = {
  topic: string;
  inputMode: ScriptInputMode;
  textZh?: string;
  textTh?: string;
  /**
   * 项目语言类型。'zh' 只产中文剧本（th 字段留空），'th' 只产泰语，
   * 'bilingual' 双语成对。缺省时按双语处理，兼容旧调用方。
   */
  languageMode?: LanguageMode;
  characters: Character[];
  scenes: Scene[];
};

/** 自动分镜产物：core 会补上 id/order/status/version 等字段。 */
export type ShotDraft = {
  sceneId: string;
  /** 自动匹配来源；手动指定的场景由 core 在重建分镜时继承，不从草稿来 */
  sceneSource?: 'auto' | 'manual';
  /** 剧本行里的场景提示，留给审阅面板解释「为什么自动配了这个场景」 */
  sceneHint?: string;
  characterIds: string[];
  action: string;
  expression: string;
  shotSize: string;
  cameraAngle: string;
  cameraMove: string;
  dialogueZh: string;
  dialogueTh: string;
  narrationZh: string;
  narrationTh: string;
  subtitleZh: string;
  subtitleTh: string;
  durationSec: number;
};

export type TextProvider = {
  readonly id: string;
  generateScript(input: GenerateScriptInput): Promise<ScriptDraft>;
  splitShots(input: { script: Script; characters: Character[]; scenes: Scene[] }): Promise<ShotDraft[]>;
};

export type ImageGenerateInput = {
  shotId: string;
  scene: Scene;
  characters: Character[];
  prompt: string;
  /** 人物核心外貌 + 参考图路径，由 core 组装，Provider 不得省略 */
  referenceImages: string[];
  coreAppearance: string[];
  width: number;
  height: number;
};

export type GeneratedMedia = { path: string; provider: string; model: string; cost: number };

export type ImageProvider = {
  readonly id: string;
  readonly available: boolean;
  generate(input: ImageGenerateInput): Promise<GeneratedMedia>;
};

export type VideoProvider = {
  readonly id: string;
  readonly available: boolean;
  generate(input: { shotId: string; prompt: string; referenceImages: string[]; durationSec: number }): Promise<GeneratedMedia>;
};

export type TtsSynthInput = {
  text: string;
  language: Language;
  engine: string;
  voice: string;
  speed: number;
  volume: number;
  emotion: string;
};
