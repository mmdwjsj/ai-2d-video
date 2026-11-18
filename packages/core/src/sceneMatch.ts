/**
 * 场景自动匹配：前端预览与服务端自动分镜共用的纯计算模块。
 *
 * 自动匹配本质上是「按关键词猜」，不可能百分百准。以前它只有一个不留痕迹的
 * sceneId，用户看不出哪些是真命中、哪些是程序轮换兜底，改完一重新分镜还被冲掉。
 * 这里把匹配结果变成可解释的数据：命中了哪些词、依据来自哪里、有多大把握，
 * 界面才能如实展示并让人逐镜头纠正。
 *
 * 无 node 依赖，浏览器可直接 import（vite alias 指向本文件）。
 */
import type { Scene, Shot } from './types.js';

export type SceneMatchReason =
  /** 剧本行里用户自己写的场景提示，最可信 */
  | 'hint'
  /** 台词命中场景关键词 / 场景名 */
  | 'keyword'
  /** 台词没线索，只靠整篇主题命中 */
  | 'topic'
  /** 完全没命中，程序轮换兜底：必须提示人工确认 */
  | 'fallback'
  /** 场景库为空 */
  | 'none';

export type SceneCandidate = {
  sceneId: string;
  score: number;
  matchedWords: string[];
};

export type SceneSuggestion = {
  /** 建议的场景 id；'' 表示场景库为空 */
  sceneId: string;
  reason: SceneMatchReason;
  /** 命中的词，界面上直接展示给用户看依据 */
  matchedWords: string[];
  /** 0 = 完全没依据（兜底），1 = 依据充分 */
  confidence: number;
  /** 得分最高的几个备选，手动选择时按相关度排在前面 */
  candidates: SceneCandidate[];
};

export type SuggestSceneInput = {
  /** 本镜头台词 */
  text: string;
  /** 剧本行的场景提示（用户写的，权重最高） */
  hint?: string;
  /** 整篇主题，仅作台词无线索时的弱依据 */
  topic?: string;
  scenes: Scene[];
  /** 兜底轮换用的镜头下标 */
  index: number;
};

const NAME_SPLIT = /[\s·・/、，,（）()｜|\-]+/;

/**
 * 场景的可匹配词表 = 用户填的关键词 + 场景名切出来的词。
 * 场景名也参与，是为了「改了名字却忘了同步关键词」时仍能命中。
 * 只取 name，不取 location：像「街角 24 小时便利店」会切出「小时」这类泛词。
 */
export const sceneWords = (scene: Scene): string[] => {
  const fromName = (scene.name ?? '')
    .split(NAME_SPLIT)
    .map((w) => w.trim())
    .filter((w) => w.length >= 2 && !/^\d+$/.test(w));
  return [...new Set([...(scene.keywords ?? []).filter(Boolean), ...fromName])];
};

/** 长词比「家」「吃」这类单字泛词可信，命中权重更高。 */
const wordWeight = (word: string): number => (word.length >= 4 ? 3 : word.length >= 2 ? 2 : 1);

export const scoreScene = (text: string, scene: Scene): { score: number; words: string[] } => {
  if (!text) return { score: 0, words: [] };
  const words = sceneWords(scene).filter((word) => text.includes(word));
  return { score: words.reduce((sum, word) => sum + wordWeight(word), 0), words };
};

const rank = (text: string, hint: string, scenes: Scene[]): SceneCandidate[] =>
  scenes
    .map((scene) => {
      const body = scoreScene(text, scene);
      const fromHint = scoreScene(hint, scene);
      return {
        sceneId: scene.id,
        // 用户写的场景提示优先于台词里偶然出现的词
        score: body.score + fromHint.score * 2,
        matchedWords: [...new Set([...fromHint.words, ...body.words])],
      };
    })
    .filter((c) => c.score > 0)
    .sort((a, b) => b.score - a.score || a.sceneId.localeCompare(b.sceneId));

/** 完全没命中时的兜底：优先日常通用场景，并在其中按下标轮换，避免整片都是同一个地方。 */
export const fallbackScene = (scenes: Scene[], index: number): Scene | null => {
  if (!scenes.length) return null;
  const generic = scenes.filter((s) =>
    /家|公寓|apartment|街|street|便利|convenience|咖啡|cafe/i.test(`${s.id} ${s.name} ${s.type} ${s.location}`));
  const pool = generic.length ? generic : scenes;
  return pool[index % pool.length];
};

const confidenceOf = (score: number, runnerUp: number): number => {
  if (score <= 0) return 0;
  if (score >= 6 && score >= runnerUp * 2) return 0.9;
  if (score >= 3) return 0.6;
  return 0.3;
};

/**
 * 给一句话定场景：剧本场景提示 + 台词 → 整篇主题 → 轮换兜底。
 * 与旧版 pickScene 同构，只是把「数命中个数」换成加权评分，并输出依据。
 */
export const suggestScene = ({ text, hint = '', topic = '', scenes, index }: SuggestSceneInput): SceneSuggestion => {
  const empty: SceneSuggestion = {
    sceneId: '', reason: 'none', matchedWords: [], confidence: 0, candidates: [],
  };
  if (!scenes.length) return empty;

  const byLine = rank(text, hint, scenes);
  if (byLine.length) {
    const top = byLine[0];
    const fromHint = hint ? scoreScene(hint, scenes.find((s) => s.id === top.sceneId) ?? scenes[0]).score > 0 : false;
    return {
      sceneId: top.sceneId,
      reason: fromHint ? 'hint' : 'keyword',
      matchedWords: top.matchedWords,
      confidence: confidenceOf(top.score, byLine[1]?.score ?? 0),
      candidates: byLine.slice(0, 4),
    };
  }

  const byTopic = rank(topic, '', scenes);
  if (byTopic.length) {
    const top = byTopic[0];
    return {
      sceneId: top.sceneId,
      reason: 'topic',
      matchedWords: top.matchedWords,
      confidence: Math.min(confidenceOf(top.score, byTopic[1]?.score ?? 0), 0.5),
      candidates: byTopic.slice(0, 4),
    };
  }

  const fallback = fallbackScene(scenes, index);
  return {
    ...empty,
    sceneId: fallback?.id ?? '',
    reason: 'fallback',
    confidence: 0,
  };
};

/** 镜头台词文本：审阅面板与自动分镜用同一份取法，两边结果才会一致。 */
export const shotMatchText = (shot: Pick<Shot, 'dialogueZh' | 'dialogueTh'>): string =>
  [shot.dialogueZh, shot.dialogueTh].filter(Boolean).join(' ');

export const shotSceneSuggestion = (
  shot: Pick<Shot, 'dialogueZh' | 'dialogueTh' | 'sceneHint'>,
  scenes: Scene[],
  topic: string,
  index: number,
): SceneSuggestion => suggestScene({
  text: shotMatchText(shot), hint: shot.sceneHint ?? '', topic, scenes, index,
});

const MATCH_KEY = (shot: Shot): string =>
  [shot.dialogueZh ?? '', shot.dialogueTh ?? ''].map((s) => s.trim()).join('\u0000').trim();

/**
 * 重新「自动分镜」时继承用户手动指定的场景。
 *
 * 批量 replaceAll 会重建全部镜头（连 id 都换），以前手动换过的场景一律被冲掉。
 * 这里按台词对齐、台词对不上再按镜头序号对齐，只把 sceneSource==='manual'
 * 的场景搬过来，其余字段仍以新分镜结果为准。
 */
export const inheritManualSceneSelections = (next: Shot[], previous: Shot[]): Shot[] => {
  const manual = previous.filter((s) => s.sceneSource === 'manual' && s.sceneId);
  if (!manual.length) return next;
  const byText = new Map<string, Shot>();
  const byOrder = new Map<number, Shot>();
  for (const shot of manual) {
    const key = MATCH_KEY(shot);
    if (key && !byText.has(key)) byText.set(key, shot);
    if (!byOrder.has(shot.order)) byOrder.set(shot.order, shot);
  }
  const used = new Set<string>();
  return next.map((shot) => {
    const key = MATCH_KEY(shot);
    let hit = key ? byText.get(key) : undefined;
    if (hit && used.has(hit.id)) hit = undefined;
    if (!hit) {
      const candidate = byOrder.get(shot.order);
      if (candidate && !used.has(candidate.id)) hit = candidate;
    }
    if (!hit) return shot;
    used.add(hit.id);
    return { ...shot, sceneId: hit.sceneId, sceneSource: 'manual' as const };
  });
};
