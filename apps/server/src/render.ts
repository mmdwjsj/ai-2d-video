/**
 * video.render 任务：把「项目 → 剧本 → 分镜」真正合成为一个可播放的 MP4。
 *
 * 链路：挑台词 → 配音（可选）→ ffprobe 实测 → computeTimeline 定长时间轴 →
 * HTML/SVG 画面帧 → Edge 截图 → FFmpeg 动效/拼接/混音 → output/<项目ID>/*.mp4。
 * 没有配音时不伪造人声，改为字幕 + 本地氛围音，并在结果里如实标注。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { P } from '@thai-video/core';
import type { Workbench } from '@thai-video/core';
import type { ExportMode, Shot, Task } from '@thai-video/core/types';
import type { TtsProvider } from '@thai-video/tts-providers';
import {
  buildFrame, captureFrame, computeTimeline, findBrowser,
  prepareShotVoice, renderEnvironment, renderVideo, scheduleCleanup,
} from '@thai-video/video-renderer';

export type RenderProgress = (percent: number, status?: 'generating' | 'processing') => void;

const MODE_LABEL: Record<ExportMode, string> = {
  zh: '中文版', th: '泰语版', bilingual: '双语版',
};

const safeName = (name: string): string =>
  (name || '未命名项目').replace(/[\\/:*?"<>|\r\n]/g, '').trim().slice(0, 40) || '未命名项目';

const stamp = (): string => {
  const d = new Date();
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
};

const resolveAudio = (slot: string): string | null => {
  if (!slot) return null;
  const abs = path.isAbsolute(slot) ? slot : path.resolve(P.root, slot);
  return fs.existsSync(abs) ? abs : null;
};

type VoiceLine = { text: string; language: 'zh' | 'th'; slot: string };

/** 按导出版本挑台词。双语版：泰语人物对白 + 中文翻译/旁白。 */
const voiceLines = (shot: Shot, mode: ExportMode): VoiceLine[] => {
  const zh = shot.dialogueZh || shot.narrationZh || shot.subtitleZh || '';
  const th = shot.dialogueTh || shot.narrationTh || shot.subtitleTh || '';
  const one = (text: string, language: 'zh' | 'th', slot: string): VoiceLine[] =>
    text.trim() ? [{ text: text.trim(), language, slot }] : [];
  if (mode === 'zh') return one(zh, 'zh', shot.audioZhPath);
  if (mode === 'th') return one(th, 'th', shot.audioThPath);
  return [...one(th, 'th', shot.audioThPath), ...one(zh, 'zh', shot.audioZhPath)];
};

const subtitles = (shot: Shot, mode: ExportMode): { primary: string; secondary: string } => {
  const zh = (shot.subtitleZh || shot.dialogueZh || shot.narrationZh || '').trim();
  const th = (shot.subtitleTh || shot.dialogueTh || shot.narrationTh || '').trim();
  if (mode === 'zh') return { primary: zh, secondary: '' };
  if (mode === 'th') return { primary: th, secondary: '' };
  // 双语版面向中文观众：中文主字幕 + 泰文原文次字幕
  return { primary: zh, secondary: th };
};

export const runVideoRender = async (
  wb: Workbench,
  task: Task,
  progress: RenderProgress,
  deps: { tts: TtsProvider },
): Promise<Record<string, unknown>> => {
  const projectId = task.projectId;
  const meta = wb.projects.meta(projectId);
  const mode: ExportMode = (['zh', 'th', 'bilingual'].includes(String(task.payload.mode))
    ? task.payload.mode : meta.exportMode) as ExportMode;
  const bundle = wb.projects.get(projectId);
  const shots = [...bundle.shots].sort((a, b) => a.order - b.order);
  if (!shots.length) throw new Error('没有可渲染的分镜：请先到「剧本编辑」生成剧本，再点「自动分镜」');

  const env = renderEnvironment();
  if (!env.available) throw new Error(`本机渲染环境未就绪：${env.reason}`);

  const { width, height, fps } = wb.config.video;
  const workDir = path.join(P.root, 'data', 'render-tmp', task.id);
  const framesDir = path.join(workDir, 'frames');
  const voiceDir = path.join(workDir, 'voice');
  // Edge 缓存有上千个小文件：放系统临时目录并固定复用一份，交给 OS 管理，
  // 不在每次渲染后递归删除（那会长时间占用线程池/删除锁，拖慢其它操作）。
  const profileDir = path.join(os.tmpdir(), 'thai-video-edge-render');
  fs.mkdirSync(framesDir, { recursive: true });
  fs.mkdirSync(voiceDir, { recursive: true });

  const introSec = 1.6;
  const outroSec = 1.4;
  const sceneOf = (shot: Shot) => bundle.scenes.find((s) => s.id === shot.sceneId) ?? null;
  const castOf = (shot: Shot) => bundle.characters.filter((c) => shot.characterIds.includes(c.id));

  /* 1. 配音：优先已配置的 TTS，其次镜头里已有的真实 WAV ------------------- */
  progress(6, 'processing');
  const voiceWavs: (string | null)[] = [];
  const audioDurations: Record<string, number> = {};
  let voiceLinesUsed = 0;
  for (let i = 0; i < shots.length; i += 1) {
    const shot = shots[i];
    const lines = voiceLines(shot, mode);
    const speaker = bundle.characters.find((c) => shot.characterIds.includes(c.id));
    const files: string[] = [];
    for (const line of lines) {
      try {
        if (deps.tts.available) {
          const voice = speaker?.voices[line.language];
          const result = await deps.tts.synthesize({
            text: line.text, language: line.language,
            engine: voice?.engine ?? '', voice: voice?.voice ?? '',
            speed: voice?.speed ?? 1, volume: voice?.volume ?? 1,
            emotion: voice?.emotion ?? shot.expression, shotId: `${shot.id}.${line.language}`,
          });
          files.push(result.wavPath);
        } else {
          const existing = resolveAudio(line.slot);
          if (existing) files.push(existing);
        }
      } catch (error) {
        // 单个 TTS 失败不拖垮整片：该句退回字幕，继续渲染
        console.warn('[render] 配音跳过：', error instanceof Error ? error.message : String(error));
      }
    }
    voiceLinesUsed += files.length;
    const merged = await prepareShotVoice(files, path.join(voiceDir, `${shot.id}.wav`));
    if (merged) {
      voiceWavs.push(merged.path);
      audioDurations[merged.path] = merged.durationSec;
    } else {
      voiceWavs.push(null);
    }
    progress(6 + Math.round(((i + 1) / shots.length) * 16), 'processing');
  }

  /* 2. 时间轴：镜头时长 ≥ 配音实测时长 + 尾部留白 -------------------------- */
  const timeline = computeTimeline(
    shots.map((shot, i) => ({
      id: shot.id, durationSec: shot.durationSec,
      audioZhPath: voiceWavs[i] ?? '', audioThPath: '',
    })),
    audioDurations, 'zh', { fps },
  );
  const warnings = timeline.warnings.filter((w) => !w.includes('缺少'));

  /* 3. 画面帧：片头 → 每个镜头 → 片尾 ------------------------------------- */
  type SegmentDef = { id: string; html: string; durationSec: number; motion: boolean; voiceWav: string | null };
  const defs: SegmentDef[] = [];
  const firstScene = sceneOf(shots[0]);
  defs.push({
    id: 'intro', durationSec: introSec, motion: false, voiceWav: null,
    html: buildFrame({
      kind: 'intro', projectTitle: meta.name, mode, scene: firstScene,
      durationSec: introSec, voiceOver: voiceLinesUsed > 0,
    }),
  });
  for (let i = 0; i < shots.length; i += 1) {
    const shot = shots[i];
    const cast = castOf(shot);
    const text = subtitles(shot, mode);
    defs.push({
      id: shot.id,
      durationSec: timeline.shots[i].durationSec,
      motion: true,
      voiceWav: voiceWavs[i],
      html: buildFrame({
        kind: 'shot', projectTitle: meta.name, mode,
        index: i + 1, total: shots.length,
        scene: sceneOf(shot), characters: cast,
        speakerId: cast[0]?.id ?? '', shot,
        primarySubtitle: text.primary, secondarySubtitle: text.secondary,
        durationSec: timeline.shots[i].durationSec,
        voiceOver: voiceLinesUsed > 0,
      }),
    });
  }
  defs.push({
    id: 'outro', durationSec: outroSec, motion: false, voiceWav: null,
    html: buildFrame({
      kind: 'outro', projectTitle: meta.name, mode, scene: firstScene,
      durationSec: outroSec, voiceOver: voiceLinesUsed > 0,
    }),
  });

  const browser = findBrowser();
  const framePngs: string[] = [];
  for (let i = 0; i < defs.length; i += 1) {
    const def = defs[i];
    const htmlPath = path.join(framesDir, `frame-${i}.html`);
    const pngPath = path.join(framesDir, `frame-${i}.png`);
    // 截图串行执行，共用一个浏览器缓存目录，避免每个镜头都留下一份几十 MB 的 profile
    await captureFrame(def.html, htmlPath, pngPath, {
      browser: browser ?? undefined,
      profileDir,
    });
    framePngs.push(pngPath);
    progress(24 + Math.round(((i + 1) / defs.length) * 26), 'processing');
  }

  /* 4. FFmpeg 合成 ---------------------------------------------------------- */
  const fileName = `${safeName(meta.name)}-${MODE_LABEL[mode]}-${stamp()}.mp4`;
  const relPath = `${projectId}/${fileName}`;
  const outputFile = path.join(P.outputDir(), projectId, fileName);
  const result = await renderVideo({
    workDir: path.join(workDir, 'ffmpeg'),
    outputFile,
    fps, width, height,
    segments: defs.map((def, i) => ({
      id: def.id, framePng: framePngs[i], durationSec: def.durationSec,
      voiceWav: def.voiceWav, motion: def.motion,
    })),
    onProgress: (percent, _note) => progress(Math.min(98, 50 + Math.round(percent * 0.48)), 'processing'),
  });

  // 帧、配音等中间产物异步清理；成片在 output/ 下，不受影响。
  scheduleCleanup(workDir);

  return {
    path: relPath,
    url: `/output/${relPath.split('/').map(encodeURIComponent).join('/')}`,
    file: outputFile,
    name: fileName,
    projectName: meta.name,
    mode,
    modeLabel: MODE_LABEL[mode],
    durationSec: result.durationSec,
    sizeBytes: result.sizeBytes,
    totalFrames: result.totalFrames,
    shotCount: shots.length,
    width, height, fps,
    codec: 'H.264 / AAC',
    hasVoiceOver: result.hasVoiceOver,
    voiceOverNote: result.hasVoiceOver
      ? `已混入 ${voiceLinesUsed} 条真实配音，镜头时长按 ffprobe 实测值撑开`
      : '未配音（未配置 TTS 且镜头无 WAV）：成片为字幕 + 本地合成氛围音',
    timelineWarnings: warnings,
    browser: env.browser,
    renderedAt: new Date().toISOString(),
  };
};
