/**
 * 导出成片与界面预览共用的一层：项目数据 → buildFrame 的 FrameInput。
 *
 * 以前预览页 / 分镜页各自用 React 另画了一套「背景图 + 人物贴图 + 字幕」，
 * 成片走的是 sceneArt.buildFrame，结果两边连字幕取法、人物图、场景配色都不同，
 * 更别说口型。现在字幕、出场人物、场景、人物图标定、说话人全部只在这里算一次，
 * 导出和预览都拿同一个 FrameInput，只是 mouthShape / 图片内联方式不同。
 */
import fs from 'node:fs';
import path from 'node:path';
import { P } from '@thai-video/core';
import type { ExportMode, ProjectBundle, Shot } from '@thai-video/core/types';
import type { CharacterArt, FrameInput } from '@thai-video/video-renderer';

export const resolveAudio = (slot: string): string | null => {
  if (!slot) return null;
  const abs = path.isAbsolute(slot) ? slot : path.resolve(P.root, slot);
  return fs.existsSync(abs) ? abs : null;
};

/** 按导出版本挑台词。双语版：泰语人物对白 + 中文翻译/旁白。 */
export type VoiceLine = { text: string; language: 'zh' | 'th'; slot: string };

export const voiceLines = (shot: Shot, mode: ExportMode): VoiceLine[] => {
  const zh = shot.dialogueZh || shot.narrationZh || shot.subtitleZh || '';
  const th = shot.dialogueTh || shot.narrationTh || shot.subtitleTh || '';
  const one = (text: string, language: 'zh' | 'th', slot: string): VoiceLine[] =>
    text.trim() ? [{ text: text.trim(), language, slot }] : [];
  if (mode === 'zh') return one(zh, 'zh', shot.audioZhPath);
  if (mode === 'th') return one(th, 'th', shot.audioThPath);
  return [...one(th, 'th', shot.audioThPath), ...one(zh, 'zh', shot.audioZhPath)];
};

/** 字幕取法：中文版只给中文，泰语版只给泰文，双语版中文为主、泰文为次。 */
export const subtitles = (shot: Shot, mode: ExportMode): { primary: string; secondary: string } => {
  const zh = (shot.subtitleZh || shot.dialogueZh || shot.narrationZh || '').trim();
  const th = (shot.subtitleTh || shot.dialogueTh || shot.narrationTh || '').trim();
  if (mode === 'zh') return { primary: zh, secondary: '' };
  if (mode === 'th') return { primary: th, secondary: '' };
  return { primary: zh, secondary: th };
};

export const sceneOf = (bundle: ProjectBundle, shot: Shot) =>
  bundle.scenes.find((s) => s.id === shot.sceneId) ?? null;

export const castOf = (bundle: ProjectBundle, shot: Shot) =>
  bundle.characters.filter((c) => shot.characterIds.includes(c.id));

/** calibration.json 只标定三个内置角色；自定义上传图走安全默认位置。 */
export type MouthCalibration = {
  size?: [number, number];
  characters?: Record<string, {
    mouth: [number, number];
    mouthSize: [number, number];
    width?: number;
    height?: number;
    skinRGB?: [number, number, number];
  }>;
};

export const readMouthCalibration = (): MouthCalibration => {
  try {
    return JSON.parse(
      fs.readFileSync(path.join(P.root, 'assets/characters/calibration.json'), 'utf8'),
    ) as MouthCalibration;
  } catch { return {}; }
};

/** PNG 的 IHDR 直接给原始宽高，用来把归一化标定换算到实际像素。 */
const pngSize = (buffer: Buffer): { width: number; height: number } | null => {
  if (buffer.length < 24 || buffer.subarray(1, 4).toString('ascii') !== 'PNG') return null;
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
};

export const calibrationSlug = (rel: string): string | null =>
  /(?:library|cutout|characters)[\\/](nina|aton|dundun)/i.exec(rel)?.[1]?.toLowerCase() ?? null;

/**
 * 人物参考图 → 图片地址 + 实测嘴部坐标，导出与预览共用同一套标定口径。
 *
 * inline=true 给导出用：截图时 Edge 以 file:// 打开临时 HTML，外链加载不到，
 *   必须把图片读成 data URI 内联。
 * inline=false 给界面预览用：iframe 跑在 http 同源下，直接用 /assets/... URL，
 *   不把几 MB 的 base64 塞进 API 响应；绝对路径或项目外文件仍回退内联。
 */
export const characterArtOf = (
  bundle: ProjectBundle,
  { inline = false }: { inline?: boolean } = {},
): Record<string, CharacterArt> => {
  const calibration = readMouthCalibration();
  const art: Record<string, CharacterArt> = {};
  for (const c of bundle.characters) {
    const rel = c.referenceImages?.fullBody || c.referenceImages?.front || '';
    if (!rel) continue;
    if (rel.startsWith('data:') || /^(https?:)?\/\//.test(rel)) {
      // 已经是完整地址：预览直接可用，导出也能用（data URI / 远程图 Edge 可加载）
      art[c.id] = {
        src: rel.startsWith('//') ? `https:${rel}` : rel,
        width: 1024, height: 1536,
        mouthX: 512, mouthY: 384, mouthW: 72,
      };
      continue;
    }
    const absolute = path.isAbsolute(rel) ? rel : path.resolve(P.root, rel);
    try {
      const buffer = fs.readFileSync(absolute);
      const mime = /\.jpe?g$/i.test(rel) ? 'image/jpeg' : /\.webp$/i.test(rel) ? 'image/webp' : 'image/png';
      const size = pngSize(buffer) ?? { width: 1024, height: 1536 };
      const cal = calibration.characters?.[calibrationSlug(rel) ?? ''];
      const baseWidth = cal?.width ?? calibration.size?.[0] ?? 1024;
      const baseHeight = cal?.height ?? calibration.size?.[1] ?? 1536;
      const skin = cal?.skinRGB;
      art[c.id] = {
        src: inline || path.isAbsolute(rel)
          ? `data:${mime};base64,${buffer.toString('base64')}`
          : `/${rel.replace(/^[\\/]+/, '').split(path.sep).join('/')}`,
        width: size.width,
        height: size.height,
        mouthX: cal ? cal.mouth[0] * size.width : size.width * 0.5,
        mouthY: cal ? cal.mouth[1] * size.height : size.height * 0.25,
        mouthW: cal ? (cal.mouthSize[0] / baseWidth) * size.width : size.width * 0.07,
        // 原嘴高度 + 真实肤色：吨吨这类「原图就张着大嘴」的角色必须据此盖底图，
        // 否则闭嘴档永远咧着嘴、小口型还会露出原嘴黑边。
        mouthH: cal ? (cal.mouthSize[1] / baseHeight) * size.height : size.height * 0.012,
        skin: skin ? `rgb(${skin[0]},${skin[1]},${skin[2]})` : '#e2b78f',
      };
    } catch { /* 缺图回退到程序化立绘，不阻断出片或预览 */ }
  }
  return art;
};

/**
 * 导出时把该镜头合成好的整条配音留在 assets 下。
 * 以前配音只存在于 render-tmp，导出完就被清掉：预览拿不到声音，
 * 下次 TTS 联网失败时也没有任何兜底，成片就整段没声。
 */
export const shotVoiceCachePath = (shotId: string, mode: ExportMode): string =>
  path.join(P.root, 'assets/audio/tts', `shot-${shotId}-${mode}.wav`);

export const shotVoiceCacheUrl = (shotId: string, mode: ExportMode): string | null => {
  const rel = `assets/audio/tts/shot-${shotId}-${mode}.wav`;
  return fs.existsSync(path.join(P.root, rel)) ? `/${rel}` : null;
};

/** 预览时若镜头已挂真实 WAV（含导出留下的配音缓存），口型跟音量走，与成片同口径。 */
export const previewVoiceWav = (shot: Shot, mode: ExportMode): string | null => {
  const cached = shotVoiceCachePath(shot.id, mode);
  if (fs.existsSync(cached)) return cached;
  return resolveAudio(mode === 'th'
    ? (shot.audioThPath || shot.audioZhPath)
    : (shot.audioZhPath || shot.audioThPath));
};

/** 浏览器能播的配音地址：优先导出缓存，其次镜头已挂的 assets 内 WAV。 */
export const previewAudioUrl = (shot: Shot, mode: ExportMode): string | null => {
  const cached = shotVoiceCacheUrl(shot.id, mode);
  if (cached) return cached;
  const rel = mode === 'th'
    ? (shot.audioThPath || shot.audioZhPath)
    : (shot.audioZhPath || shot.audioThPath);
  if (!rel) return null;
  if (rel.startsWith('data:') || /^(https?:)?\/\//.test(rel)) return rel.startsWith('//') ? `https:${rel}` : rel;
  const abs = path.resolve(P.root, rel);
  const assets = path.resolve(P.root, 'assets');
  // 项目外的本地文件不暴露给浏览器，避免把磁盘路径透出去
  return abs.startsWith(assets)
    ? `/${path.relative(P.root, abs).split(path.sep).join('/')}`
    : null;
};

/** 唯一的「镜头 → FrameInput」入口：成片和预览都调它，不许各自拼字段。 */
export const shotFrameInput = (input: {
  bundle: ProjectBundle;
  shot: Shot;
  mode: ExportMode;
  index: number;
  total: number;
  durationSec: number;
  characterArt: Record<string, CharacterArt>;
  voiceOver?: boolean;
  projectTitle?: string;
}): FrameInput => {
  const { bundle, shot, mode, index, total, durationSec, characterArt } = input;
  const cast = castOf(bundle, shot);
  const text = subtitles(shot, mode);
  return {
    kind: 'shot',
    projectTitle: input.projectTitle ?? bundle.meta.name,
    mode,
    index,
    total,
    scene: sceneOf(bundle, shot),
    characters: cast,
    characterArt,
    speakerId: cast[0]?.id ?? '',
    shot,
    primarySubtitle: text.primary,
    secondarySubtitle: text.secondary,
    durationSec,
    voiceOver: input.voiceOver ?? false,
  };
};
