import { readJson } from './jsonStore.js';
import { P } from './paths.js';
import type { Character, Scene } from './types.js';
import { nowIso } from './types.js';

export type AppConfig = {
  schemaVersion: number;
  video: {
    aspectRatio: string; width: number; height: number; fps: number;
    container: string; videoCodec: string; audioCodec: string;
    audioIntermediate: string; audioSampleRate: number; audioChannels: number;
    durationSource: string;
  };
  exportModes: string[];
  defaultExportMode: string;
  storage: Record<string, string>;
  autosaveDebounceMs: number;
  maxShotVersions: number;
  task: { pollIntervalMs: number; maxAttempts: number };
};

export type ProviderConfig = {
  schemaVersion: number;
  note: string;
  text: { active: string; [key: string]: unknown };
  image: { active: string; [key: string]: unknown };
  video: { active: string; [key: string]: unknown };
  tts: { active: string; [key: string]: unknown };
};

const FALLBACK_APP: AppConfig = {
  schemaVersion: 1,
  video: {
    aspectRatio: '9:16', width: 1080, height: 1920, fps: 30,
    container: 'mp4', videoCodec: 'h264', audioCodec: 'aac',
    audioIntermediate: 'wav', audioSampleRate: 48000, audioChannels: 2,
    durationSource: 'final-audio-timeline',
  },
  exportModes: ['zh', 'th', 'bilingual'],
  defaultExportMode: 'zh',
  storage: { database: 'data/workbench.sqlite', projects: 'data/projects', assets: 'assets', output: 'output' },
  autosaveDebounceMs: 600,
  maxShotVersions: 30,
  task: { pollIntervalMs: 500, maxAttempts: 3 },
};

export const appConfig = (): AppConfig => readJson(P.config('app.json'), FALLBACK_APP);

export const providerConfig = (): ProviderConfig =>
  readJson(P.config('providers.json'), {
    schemaVersion: 1,
    note: '',
    text: { active: 'local' },
    image: { active: 'unconfigured' },
    video: { active: 'unconfigured' },
    tts: { active: 'unconfigured' },
  });

/** 三个固定人物：职业与关系都只是可编辑的初始值，不是写死的设定。 */
export const defaultCharacters = (): Character[] => {
  const raw = readJson<Omit<Character, 'updatedAt'>[]>(P.config('characters.json'), []);
  return raw.map((item) => ({ ...item, updatedAt: nowIso() }));
};

/** 第一版 12 个泰国生活场景。 */
export const defaultScenes = (): Scene[] => {
  const raw = readJson<Omit<Scene, 'updatedAt'>[]>(P.config('scenes.json'), []);
  return raw.map((item) => ({ ...item, updatedAt: nowIso() }));
};
