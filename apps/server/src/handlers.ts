import { createProviders } from '@thai-video/ai-providers';
import { createTtsProvider } from '@thai-video/tts-providers';
import { emptyShot, makeId, nowIso } from '@thai-video/core';
import { inheritManualSceneSelections } from '@thai-video/core/sceneMatch';
import type { Workbench } from '@thai-video/core';
import type { GenerateScriptInput, ScriptDraft, ShotDraft } from '@thai-video/ai-providers';
import type { Script, Shot } from '@thai-video/core/types';
import { runVideoRender } from './render.js';

const draftToShots = (drafts: ShotDraft[]): Shot[] =>
  drafts.map((draft, index) => ({
    ...emptyShot(index + 1, makeId('shot')),
    ...draft,
    status: 'draft' as const,
    updatedAt: nowIso(),
  }));

const draftToScript = (current: Script, draft: ScriptDraft, input: GenerateScriptInput): Script => ({
  ...current,
  topic: input.topic || draft.title,
  inputMode: input.inputMode,
  title: draft.title,
  structure: draft.structure,
  hook: draft.hook,
  cast: draft.cast,
  lines: draft.lines,
  zh: draft.zh,
  th: draft.th,
  narrationZh: draft.narrationZh,
  narrationTh: draft.narrationTh,
  emotion: draft.emotion,
  actionSuggestion: draft.actionSuggestion,
  sceneSuggestions: draft.sceneSuggestions,
  shotCountEstimate: draft.shotCountEstimate,
  durationEstimateSec: draft.durationEstimateSec,
  syncPending: false,
  updatedAt: nowIso(),
});

/** 把所有 Provider 与任务处理器挂到持久化队列上，server 启动时调用一次。 */
export const registerHandlers = (wb: Workbench) => {
  const providers = createProviders(wb.providers);
  const tts = createTtsProvider(wb.providers);

  wb.queue.register('project.init', async ({ task, progress }) => {
    progress(80);
    return { initialized: true, characters: task.payload.characters ?? 0, scenes: task.payload.scenes ?? 0 };
  });

  wb.queue.register('script.generate', async ({ task, progress }) => {
    const bundle = wb.projects.get(task.projectId);
    const payload = task.payload as unknown as GenerateScriptInput;
    // 语言类型以项目设置为准；请求里显式带值时优先（便于后续按单语种重试）。
    const languageMode = payload.languageMode ?? wb.projects.meta(task.projectId).exportMode;
    progress(30);
    const draft = await providers.text.generateScript({
      topic: payload.topic ?? '',
      inputMode: payload.inputMode ?? 'topic',
      textZh: payload.textZh,
      textTh: payload.textTh,
      languageMode,
      characters: bundle.characters,
      scenes: bundle.scenes,
    });
    progress(80);
    const script = wb.script.save(task.projectId, draftToScript(bundle.script, draft, {
      topic: payload.topic ?? '', inputMode: payload.inputMode ?? 'topic',
      characters: bundle.characters, scenes: bundle.scenes,
    }));
    return { provider: providers.text.id, note: draft.note, shotCountEstimate: draft.shotCountEstimate };
  });

  wb.queue.register('storyboard.split', async ({ task, progress }) => {
    const bundle = wb.projects.get(task.projectId);
    progress(30);
    const drafts = await providers.text.splitShots({
      script: bundle.script, characters: bundle.characters, scenes: bundle.scenes,
    });
    if (!drafts.length) throw new Error('剧本没有可切分的台词，请先生成或填写剧本');
    progress(80);
    // 批量重建会换掉所有 shotId，手动换过的场景不能跟着丢：按台词 / 序号对齐继承。
    const previous = wb.storyboard.list(task.projectId);
    const next = inheritManualSceneSelections(draftToShots(drafts), previous);
    const shots = wb.storyboard.replaceAll(task.projectId, next);
    const kept = shots.filter((s) => s.sceneSource === 'manual').length;
    return { provider: providers.text.id, shotCount: shots.length, preservedManualScenes: kept };
  });

  wb.queue.register('shot.image', async ({ task, progress }) => {
    const shotId = String(task.payload.shotId ?? '');
    progress(30);
    let notice = '';
    try {
      if (!providers.image.available) throw new Error('图像 Provider 未配置（阶段二接入）');
      const shot = wb.storyboard.list(task.projectId).find((s) => s.id === shotId);
      const bundle = wb.projects.get(task.projectId);
      if (!shot) throw new Error(`镜头不存在：${shotId}`);
      const scene = bundle.scenes.find((s) => s.id === shot.sceneId);
      const characters = bundle.characters.filter((c) => shot.characterIds.includes(c.id));
      const media = await providers.image.generate({
        shotId,
        scene: scene ?? bundle.scenes[0],
        characters,
        prompt: `${shot.action} / ${shot.expression}`,
        referenceImages: characters.flatMap((c) => [
          c.referenceImages.front, c.referenceImages.halfBody, c.referenceImages.face,
        ]).filter(Boolean),
        coreAppearance: characters.map((c) => c.identityLock.coreAppearance).filter(Boolean),
        width: wb.config.video.width,
        height: wb.config.video.height,
      });
      wb.storyboard.patchShot(task.projectId, shotId, {
        generatedImagePath: media.path, status: 'ready', lastTaskId: task.id,
      });
      return { generated: true, path: media.path, provider: media.provider };
    } catch (error) {
      notice = error instanceof Error ? error.message : String(error);
    }
    // 未配置时只重置本镜头并如实记录，不产出假画面。
    const shot = wb.storyboard.patchShot(task.projectId, shotId, {
      generatedImagePath: '', status: 'draft', lastTaskId: task.id,
    }, { note: '重新生成画面（Provider 未配置，仅重置）' });
    progress(90);
    return { generated: false, notice, shotId, version: shot.version };
  });

  const registerAudio = (type: 'shot.audio.zh' | 'shot.audio.th', language: 'zh' | 'th') => {
    wb.queue.register(type, async ({ task, progress }) => {
      const shotId = String(task.payload.shotId ?? '');
      progress(30);
      const shot = wb.storyboard.list(task.projectId).find((s) => s.id === shotId);
      if (!shot) throw new Error(`镜头不存在：${shotId}`);
      const bundle = wb.projects.get(task.projectId);
      const speaker = bundle.characters.find((c) => shot.characterIds.includes(c.id));
      const voice = speaker?.voices[language];
      let notice = '';
      try {
        if (!tts.available) throw new Error('TTS Provider 未配置（阶段三接入）');
        const audio = await tts.synthesize({
          text: language === 'zh' ? shot.dialogueZh : shot.dialogueTh,
          language,
          engine: voice?.engine ?? '', voice: voice?.voice ?? '',
          speed: voice?.speed ?? 1, volume: voice?.volume ?? 1,
          emotion: voice?.emotion ?? '', shotId,
        });
        wb.storyboard.patchShot(task.projectId, shotId, {
          [language === 'zh' ? 'audioZhPath' : 'audioThPath']: audio.wavPath,
          lastTaskId: task.id,
        });
        return { generated: true, path: audio.wavPath, durationSec: audio.durationSec };
      } catch (error) {
        notice = error instanceof Error ? error.message : String(error);
      }
      wb.storyboard.patchShot(task.projectId, shotId, {
        [language === 'zh' ? 'audioZhPath' : 'audioThPath']: '',
        lastTaskId: task.id,
      }, { note: '重新生成配音（TTS 未配置，仅重置）' });
      return { generated: false, notice, shotId };
    });
  };
  registerAudio('shot.audio.zh', 'zh');
  registerAudio('shot.audio.th', 'th');

  // 阶段四：真实 MP4 合成。任务入队即返回，后台 worker 接管，进度可在任务页/导出页轮询。
  wb.queue.register('video.render', async ({ task, progress }) =>
    runVideoRender(wb, task, progress, { tts }));

  wb.queue.start();
  return { providers, tts };
};
