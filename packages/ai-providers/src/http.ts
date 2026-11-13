/**
 * 阶段二接入骨架：兼容 OpenAI `/chat/completions` 的文本 Provider。
 * 密钥只从环境变量读取；未配置时调用会明确失败，不静默降级成假生成。
 */
import type { Script, Character, Scene } from '@thai-video/core/types';
import type { GenerateScriptInput, ScriptDraft, ShotDraft, TextProvider } from './types.js';

export type HttpProviderOptions = { baseUrl: string; apiKey: string; model: string };

const extractJson = (text: string): unknown => {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(text);
  const body = fenced ? fenced[1] : text;
  const start = body.indexOf('{');
  const end = body.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('模型返回内容不是 JSON 对象');
  return JSON.parse(body.slice(start, end + 1)) as unknown;
};

export class HttpTextProvider implements TextProvider {
  readonly id = 'http-text-v1';

  constructor(private readonly options: HttpProviderOptions) {}

  private async chat(system: string, user: string): Promise<unknown> {
    if (!this.options.baseUrl || !this.options.apiKey || !this.options.model) {
      throw new Error('文本 Provider 未配置：请设置 THAI_VIDEO_TEXT_BASE_URL / _API_KEY / _MODEL');
    }
    const url = `${this.options.baseUrl.replace(/\/$/, '')}/chat/completions`;
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.options.apiKey}`,
      },
      body: JSON.stringify({
        model: this.options.model,
        temperature: 0.7,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
      }),
    });
    if (!response.ok) throw new Error(`文本模型请求失败：HTTP ${response.status}`);
    const payload = await response.json() as { choices?: { message?: { content?: string } }[] };
    const content = payload.choices?.[0]?.message?.content;
    if (!content) throw new Error('文本模型返回空内容');
    return extractJson(content);
  }

  async generateScript(input: GenerateScriptInput): Promise<ScriptDraft> {
    const system = [
      '你是泰国本地生活短视频编剧。只输出一个 JSON 对象。',
      '字段：title, structure, hook, cast[{characterId,role}], lines[{id,speakerId,textZh,textTh,emotion,action,sceneSuggestion}],',
      'zh, th, narrationZh, narrationTh, emotion, actionSuggestion, sceneSuggestions[], shotCountEstimate, durationEstimateSec, note。',
      '泰语必须是泰国人日常口语，不做逐字直译；只用给定的人物 ID 与场景名。',
    ].join(' ');
    const raw = await this.chat(system, JSON.stringify({
      topic: input.topic, inputMode: input.inputMode,
      textZh: input.textZh ?? '', textTh: input.textTh ?? '',
      characters: input.characters.map((c) => ({ id: c.id, name: c.name, occupation: c.occupation })),
      scenes: input.scenes.map((s) => ({ id: s.id, name: s.name, keywords: s.keywords })),
    })) as Partial<ScriptDraft>;
    if (!Array.isArray(raw.lines)) throw new Error('模型返回的剧本缺少 lines');
    return {
      title: raw.title ?? input.topic,
      structure: raw.structure ?? '', hook: raw.hook ?? '',
      cast: raw.cast ?? [], lines: raw.lines,
      zh: raw.zh ?? raw.lines.map((l) => l.textZh).join('\n'),
      th: raw.th ?? raw.lines.map((l) => l.textTh).join('\n'),
      narrationZh: raw.narrationZh ?? '', narrationTh: raw.narrationTh ?? '',
      emotion: raw.emotion ?? '', actionSuggestion: raw.actionSuggestion ?? '',
      sceneSuggestions: raw.sceneSuggestions ?? [],
      shotCountEstimate: raw.shotCountEstimate ?? raw.lines.length,
      durationEstimateSec: raw.durationEstimateSec ?? raw.lines.length * 4,
      note: raw.note ?? `由 ${this.options.model} 生成`,
    };
  }

  async splitShots(input: { script: Script; characters: Character[]; scenes: Scene[] }): Promise<ShotDraft[]> {
    const system = [
      '你是分镜师。只输出 JSON：{"shots":[...]}。',
      '每个元素含 sceneId, characterIds[], action, expression, shotSize, cameraAngle, cameraMove,',
      'dialogueZh, dialogueTh, narrationZh, narrationTh, subtitleZh, subtitleTh, durationSec。',
      '保持中泰台词原样，不改写文字；sceneId / characterIds 只能取给定 ID。',
    ].join(' ');
    const raw = await this.chat(system, JSON.stringify({
      script: input.script,
      characters: input.characters.map((c) => c.id),
      scenes: input.scenes.map((s) => ({ id: s.id, name: s.name })),
    })) as { shots?: ShotDraft[] };
    if (!Array.isArray(raw.shots)) throw new Error('模型返回的分镜缺少 shots');
    return raw.shots;
  }
}
