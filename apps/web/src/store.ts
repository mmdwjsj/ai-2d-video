import { create } from 'zustand';
import { api, ApiError } from './api';
import { downloadOutput, downloadProjectJson } from './download';
import { languageNotice, showsTh, showsZh } from './language';
import type { LanguageMode } from './language';
import { applyLibraryImages, characterFromLibrary, makeCharacterId } from './characterLibrary';
import type { CharacterLibraryPayload, LibraryCharacter } from './characterLibrary';
import { emptyCharacter } from '@thai-video/core/types';
import type {
  Character, ExportMode, ProjectBundle, ProjectMeta, Scene, Script,
  ScriptInputMode, Shot, Task,
} from '@thai-video/core/types';

/** 成片目录里的文件（服务端 GET /api/outputs 返回）。 */
export type OutputFile = {
  path: string;
  url: string;
  sizeBytes: number;
  modifiedAt: string;
  kind: 'video' | 'audio' | 'image' | 'other';
  projectId: string;
};

/** 三个工作区：项目库 / 制作（一页四段）/ 出片（一页三段）。 */
export type Page = 'projects' | 'work' | 'deliver';

/** 制作页的四段，也是跨页跳转的落点。 */
export type WorkSection = 'characters' | 'scenes' | 'script' | 'storyboard';

/** 自动保存状态的四个槽位。 */
export type SaveLabel = WorkSection;

export type ConfigPayload = {
  app: {
    video: { width: number; height: number; fps: number; aspectRatio: string };
    exportModes: string[];
  };
  capabilities: {
    text: string; image: boolean; video: boolean; tts: boolean; videoExport: boolean;
    renderer?: { browser: string | null; ffmpeg: boolean; ffprobe: boolean; reason: string };
  };
  notes: string[];
};

/** video.render 任务完成后 result 的结构，导出页据此展示成片卡片。 */
export type RenderResultInfo = {
  path: string;
  url: string;
  name: string;
  mode: string;
  modeLabel: string;
  durationSec: number;
  sizeBytes: number;
  totalFrames: number;
  shotCount: number;
  width: number;
  height: number;
  fps: number;
  codec: string;
  hasVoiceOver: boolean;
  voiceOverNote: string;
  renderedAt: string;
};

type GenerateInput = {
  topic?: string;
  inputMode?: ScriptInputMode;
  textZh?: string;
  textTh?: string;
};

type State = {
  page: Page;
  workSection: WorkSection;
  /** 每次请求聚焦某一段就 +1，制作页据此展开并滚动（同段落重复点击也生效）。 */
  focusSeq: number;
  saving: Record<SaveLabel, boolean>;
  savedAt: Partial<Record<SaveLabel, string>>;
  projects: ProjectMeta[];
  currentId: string | null;
  bundle: ProjectBundle | null;
  config: ConfigPayload | null;
  tasks: Task[];
  busy: boolean;
  error: string | null;
  notice: string | null;
  selectedShotId: string | null;
  outputs: OutputFile[];
  outputDir: string;
  renderTask: Task | null;
  renderResult: RenderResultInfo | null;
  renderError: string | null;
  /** assets/characters/library 里的人物六视图，选人时一次带出 6 张。 */
  library: LibraryCharacter[];
  libraryError: string | null;

  setPage: (page: Page) => void;
  setWorkSection: (section: WorkSection) => void;
  flushNow: () => void;
  submitAll: () => Promise<void>;
  clearMessages: () => void;
  bootstrap: () => Promise<void>;
  createProject: (name: string, description?: string, languageMode?: LanguageMode) => Promise<void>;
  setLanguageMode: (mode: LanguageMode) => Promise<void>;
  refreshOutputs: () => Promise<void>;
  openProject: (id: string) => Promise<void>;
  openProjectAt: (id: string) => Promise<void>;
  duplicateProject: (id: string) => Promise<void>;
  deleteProject: (id: string) => Promise<void>;
  patchProject: (patch: { name?: string; description?: string; exportMode?: ExportMode }) => Promise<void>;

  updateCharacters: (characters: Character[]) => void;
  loadCharacterLibrary: () => Promise<void>;
  /** 不带 entry = 新建空白人物（六张图逐张上传）；带 entry = 从资源库一次带出六张。 */
  addCharacter: (entry?: LibraryCharacter) => void;
  removeCharacter: (id: string) => void;
  /** 把资源库六视图套到已有人物上，只换图、不覆盖手改过的设定。 */
  replaceCharacterImages: (id: string, entry: LibraryCharacter) => void;
  updateScenes: (scenes: Scene[]) => void;
  uploadReference: (characterId: string, slot: string, file: File) => Promise<void>;
  updateScript: (script: Script) => void;
  generateScript: (input: GenerateInput) => Promise<void>;
  syncScript: (from: 'zh' | 'th') => Promise<void>;
  dismissSync: () => Promise<void>;

  splitShots: () => Promise<void>;
  selectShot: (id: string | null) => void;
  updateShot: (id: string, patch: Partial<Shot>) => void;
  addShot: () => Promise<void>;
  removeShot: (id: string) => Promise<void>;
  reorderShots: (ids: string[]) => Promise<void>;
  restoreShot: (id: string, version: number) => Promise<void>;
  regenerateShot: (id: string, kind: 'image' | 'audio.zh' | 'audio.th') => Promise<void>;

  refreshTasks: () => Promise<void>;
  cancelTask: (id: string) => Promise<void>;
  retryTask: (id: string) => Promise<void>;
  startRender: (mode?: ExportMode) => Promise<void>;
  clearRender: () => void;
  downloadFile: (path: string) => Promise<void>;
  exportJson: () => Promise<void>;
};

/* 自动保存：同对象的连续编辑合并成一次请求，切换页面/项目时立即落地。 */
const pending = new Map<string, { timer: ReturnType<typeof setTimeout>; fn: () => Promise<void> }>();
const patchBuffer = new Map<string, Partial<Shot>>();
const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

const schedule = (key: string, fn: () => Promise<void>, ms = 600): void => {
  const previous = pending.get(key);
  if (previous) clearTimeout(previous.timer);
  const timer = setTimeout(() => {
    pending.delete(key);
    void fn();
  }, ms);
  pending.set(key, { timer, fn });
};

const flushAll = (): void => {
  for (const [key, item] of pending) {
    clearTimeout(item.timer);
    pending.delete(key);
    void item.fn();
  }
};

/** 需要「先落盘再执行下一步」时用（例如提交分镜前必须先把剧本写完）。 */
const flushAllAsync = async (): Promise<void> => {
  const jobs: Promise<void>[] = [];
  for (const [key, item] of pending) {
    clearTimeout(item.timer);
    pending.delete(key);
    jobs.push(item.fn());
  }
  await Promise.allSettled(jobs);
};

/** 还有没有没落盘的改动（关页/刷新前用来决定是否提醒）。 */
export const hasPendingSaves = (): boolean => pending.size > 0;

const clock = (): string => new Date().toLocaleTimeString('zh-CN', { hour12: false }).slice(0, 5);

/** 按项目进度算「下一段该做的」，用来决定打开项目时展开哪一段。 */
const nextSectionOf = (bundle: ProjectBundle | null): WorkSection => {
  if (!bundle) return 'characters';
  if (!bundle.characters.length || bundle.characters.some((c) => !c.name.trim())) return 'characters';
  if (!bundle.scenes.length) return 'scenes';
  if (!bundle.script.zh.trim() && !bundle.script.th.trim()) return 'script';
  if (!bundle.shots.length) return 'script';
  return 'storyboard';
};

export const useWorkbench = create<State>((set, get) => {
  const fail = (error: unknown): void => set({ error: errorMessage(error) });

  const run = async (fn: () => Promise<void>): Promise<void> => {
    set({ busy: true, error: null });
    try { await fn(); } catch (error) { fail(error); } finally { set({ busy: false }); }
  };

  const bundleWith = (partial: Partial<ProjectBundle>): { bundle: ProjectBundle } | Record<string, never> => {
    const current = get().bundle;
    return current ? { bundle: { ...current, ...partial } } : {};
  };

  const projectId = (): string => {
    const id = get().currentId;
    if (!id) throw new Error('请先选择项目');
    return id;
  };

  const refreshTasks = async (): Promise<void> => {
    const id = get().currentId;
    if (!id) return;
    const result = await api.get<{ tasks: Task[] }>(`/api/projects/${id}/tasks`);
    set({ tasks: result.tasks });
  };

  /** 资源库接口是新增的：旧服务端返回 404 时静默降级，不影响人物增删与本地上传。 */
  const fetchLibrary = async (): Promise<void> => {
    try {
      const result = await api.get<CharacterLibraryPayload>('/api/character-library');
      set({ library: result.characters ?? [], libraryError: null });
    } catch {
      set({
        library: [],
        libraryError: '资源库没读到：请重启服务端后刷新页面（增删人物与本地上传仍然可用）',
      });
    }
  };

  /** 渲染进度轮询：网络抖动自动重试，偶发连接重置不会误报「渲染失败」。 */
  const pollRender = async (taskId: string): Promise<void> => {
    const deadline = Date.now() + 8 * 60 * 1000;
    let failures = 0;
    while (Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 1000));
      try {
        const { task } = await api.get<{ task: Task }>(`/api/tasks/${taskId}`);
        failures = 0;
        set({ renderTask: task });
        if (task.status === 'completed') {
          const info = task.result as unknown as RenderResultInfo;
          set({ renderResult: info, renderError: null });
          try {
            const out = await api.get<{ dir: string; files: OutputFile[] }>('/api/outputs');
            set({ outputs: out.files, outputDir: out.dir });
          } catch { /* 清单刷新失败不影响成片本身 */ }
          await refreshTasks();
          set({ notice: `成片已生成：${info.name}（${info.durationSec}s），在下方「成片文件在哪看」可直接播放` });
          return;
        }
        if (task.status === 'failed' || task.status === 'cancelled') {
          set({ renderError: task.error || '渲染任务未完成，请到「出片 · 任务记录」查看原因' });
          return;
        }
      } catch (error) {
        failures += 1;
        if (failures >= 10) {
          set({ renderError: `读取进度失败：${errorMessage(error)}。任务仍在后台执行，可到「出片 · 任务记录」查看。` });
          return;
        }
      }
    }
    set({ renderError: '渲染超过 8 分钟仍未结束，请到「出片 · 任务记录」查看（任务记录不会丢）。' });
  };

  const setSaving = (label: SaveLabel, value: boolean): void => {
    set((state) => ({ saving: { ...state.saving, [label]: value } }));
  };

  const markSaved = (label: SaveLabel): void => {
    set((state) => ({
      saving: { ...state.saving, [label]: false },
      savedAt: { ...state.savedAt, [label]: clock() },
    }));
  };

  const scheduleSave = (label: SaveLabel, key: string, url: string, body: () => unknown): void => {
    setSaving(label, true);
    schedule(key, async () => {
      const id = get().currentId;
      if (!id || url.includes('undefined')) { setSaving(label, false); return; }
      try {
        await api.put(url, body());
        markSaved(label);
      } catch (error) {
        setSaving(label, false);
        fail(error);
      }
    });
  };

  return {
    page: 'projects',
    workSection: 'characters',
    focusSeq: 0,
    saving: { characters: false, scenes: false, script: false, storyboard: false },
    savedAt: {},
    projects: [],
    currentId: null,
    bundle: null,
    config: null,
    tasks: [],
    busy: false,
    error: null,
    notice: null,
    selectedShotId: null,
    outputs: [],
    outputDir: '',
    renderTask: null,
    renderResult: null,
    renderError: null,
    library: [],
    libraryError: null,

    setPage: (page) => { flushAll(); set({ page }); },

    setWorkSection: (section) => {
      flushAll();
      set((state) => ({ workSection: section, focusSeq: state.focusSeq + 1 }));
    },

    flushNow: () => {
      if (pending.size === 0) { set({ notice: '没有待保存的改动，内容都已落盘' }); return; }
      flushAll();
      set({ notice: '正在立即保存…' });
    },

    /** 文章页的「提交并自动分镜」：校验三段 → 落盘 → 切镜头 → 展开第 4 段。 */
    submitAll: () => run(async () => {
      const current = get().bundle;
      if (!current) throw new Error('请先选择项目');
      if (!current.characters.length || current.characters.some((c) => !c.name.trim())) {
        throw new Error('第 1 段「人物」还没填完：人物姓名不能为空');
      }
      if (!current.scenes.length) throw new Error('第 2 段「场景」还没填完：至少保留一个场景');
      if (!current.script.zh.trim() && !current.script.th.trim()) {
        throw new Error('第 3 段「剧本」还是空的：先写或生成剧本，再提交');
      }
      const id = projectId();
      await flushAllAsync();
      const result = await api.post<{ shots: Shot[]; task: Task }>(`/api/projects/${id}/storyboard/split`, {});
      set({
        ...bundleWith({ shots: result.shots }),
        selectedShotId: result.shots[0]?.id ?? null,
        workSection: 'storyboard',
        focusSeq: get().focusSeq + 1,
        notice: `已生成 ${result.shots.length} 个镜头，第 4 段可以逐镜头审核了`,
      });
      await refreshTasks();
    }),

    clearMessages: () => set({ error: null, notice: null }),

    bootstrap: () => run(async () => {
      const [list, config] = await Promise.all([
        api.get<{ projects: ProjectMeta[] }>('/api/projects'),
        api.get<ConfigPayload>('/api/config'),
      ]);
      set({ projects: list.projects, config });
      await fetchLibrary();
      // 成片目录清单是新增接口；旧进程还没重启时静默降级，导出页会给出提示。
      try {
        const out = await api.get<{ dir: string; files: OutputFile[] }>('/api/outputs');
        set({ outputs: out.files, outputDir: out.dir });
      } catch { /* 服务端尚未重启 */ }
    }),

    createProject: (name, description = '', languageMode = 'bilingual') => run(async () => {
      // 语言类型用 PATCH 落地（新旧服务端都支持），避免新字段被旧版 strict 校验拒绝。
      const result = await api.post<{ project: ProjectBundle }>('/api/projects', { name, description });
      const id = result.project.meta.id;
      if (languageMode !== result.project.meta.exportMode) {
        const patched = await api.patch<{ meta: ProjectMeta }>(`/api/projects/${id}`, { exportMode: languageMode });
        result.project.meta = patched.meta;
      }
      const list = await api.get<{ projects: ProjectMeta[] }>('/api/projects');
      set({ projects: list.projects });
      await get().openProject(id);
      set({
        page: 'work',
        notice: `项目已创建（${languageMode === 'zh' ? '中文' : languageMode === 'th' ? '泰语' : '双语'}）：默认带入 ${result.project.characters.length} 个人物与 ${result.project.scenes.length} 个场景，人物可在第 1 段自由增删`,
      });
    }),

    setLanguageMode: (mode) => run(async () => {
      await get().patchProject({ exportMode: mode });
      set({ notice: languageNotice(mode) });
    }),

    refreshOutputs: () => run(async () => {
      try {
        const out = await api.get<{ dir: string; files: OutputFile[] }>('/api/outputs');
        set({ outputs: out.files, outputDir: out.dir });
      } catch {
        set({ error: '读取成片目录失败：请重启一下服务端（npm run build && npm start）后刷新页面' });
      }
    }),

    openProject: (id) => run(async () => {
      flushAll();
      const [result, taskResult] = await Promise.all([
        api.get<{ project: ProjectBundle }>(`/api/projects/${id}`),
        api.get<{ tasks: Task[] }>(`/api/projects/${id}/tasks`),
      ]);
      set({
        currentId: id,
        bundle: result.project,
        tasks: taskResult.tasks,
        selectedShotId: result.project.shots[0]?.id ?? null,
        workSection: nextSectionOf(result.project),
        focusSeq: get().focusSeq + 1,
        notice: `已打开：${result.project.meta.name}`,
      });
    }),

    /** 从项目库进制作页：打开后直接落到「下一段该做的」。 */
    openProjectAt: (id) => run(async () => {
      await get().openProject(id);
      set({ page: 'work' });
    }),

    duplicateProject: (id) => run(async () => {
      await api.post(`/api/projects/${id}/duplicate`);
      const list = await api.get<{ projects: ProjectMeta[] }>('/api/projects');
      set({ projects: list.projects, notice: '项目已复制' });
    }),

    deleteProject: (id) => run(async () => {
      await api.del(`/api/projects/${id}`);
      const list = await api.get<{ projects: ProjectMeta[] }>('/api/projects');
      set((state) => ({
        projects: list.projects,
        notice: '项目已删除',
        ...(state.currentId === id
          ? { currentId: null, bundle: null, tasks: [], selectedShotId: null, page: 'projects' as Page }
          : {}),
      }));
    }),

    patchProject: (patch) => run(async () => {
      const id = projectId();
      const result = await api.patch<{ meta: ProjectMeta }>(`/api/projects/${id}`, patch);
      set((state) => ({
        bundle: state.bundle ? { ...state.bundle, meta: result.meta } : null,
        projects: state.projects.map((p) => (p.id === id ? result.meta : p)),
      }));
    }),

    updateCharacters: (characters) => {
      const id = projectId();
      set(bundleWith({ characters }));
      scheduleSave('characters', `chars:${id}`, `/api/projects/${id}/characters`, () => ({ characters: get().bundle?.characters ?? [] }));
    },

    loadCharacterLibrary: () => fetchLibrary(),

    addCharacter: (entry) => {
      const current = get().bundle;
      if (!current) return;
      const character = entry ? characterFromLibrary(entry) : emptyCharacter(makeCharacterId());
      get().updateCharacters([...current.characters, character]);
      set({
        notice: entry
          ? `已从资源库加入「${character.name}」，六张参考图自动带出`
          : '已新增空白人物：请逐张上传正面 / 侧面 / 背面 / 全身 / 半身 / 脸部',
      });
    },

    removeCharacter: (id) => {
      const current = get().bundle;
      if (!current) return;
      const target = current.characters.find((c) => c.id === id);
      if (!target) return;
      // 删掉人之后，别人 relations 里指向他的项会变成悬挂引用，一并清掉。
      const characters = current.characters
        .filter((c) => c.id !== id)
        .map((c) => ({ ...c, relations: c.relations.filter((r) => r.characterId !== id) }));
      get().updateCharacters(characters);
      set({ notice: `已删除「${target.name}」，其他人物里指向他/她的人物关系也已清理` });
    },

    replaceCharacterImages: (id, entry) => {
      const current = get().bundle;
      if (!current) return;
      get().updateCharacters(current.characters.map((c) =>
        c.id === id ? applyLibraryImages(c, entry.images) : c,
      ));
      set({ notice: `已换成资源库「${entry.name}」的六张参考图，姓名与音色保持不变` });
    },

    updateScenes: (scenes) => {
      const id = projectId();
      set(bundleWith({ scenes }));
      scheduleSave('scenes', `scenes:${id}`, `/api/projects/${id}/scenes`, () => ({ scenes: get().bundle?.scenes ?? [] }));
    },

    uploadReference: (characterId, slot, file) => run(async () => {
      const id = projectId();
      const base64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(new Error('读取图片失败'));
        reader.readAsDataURL(file);
      });
      const result = await api.post<{ asset: { path: string } }>('/api/assets/images', {
        base64, mimeType: file.type || 'image/png', projectId: id, characterId, slot,
      });
      const characters = (get().bundle?.characters ?? []).map((c) =>
        c.id === characterId
          ? { ...c, referenceImages: { ...c.referenceImages, [slot]: result.asset.path } }
          : c,
      );
      set(bundleWith({ characters }));
      await api.put(`/api/projects/${id}/characters`, { characters });
      markSaved('characters');
      set({ notice: `已上传 ${slot} 参考图` });
    }),

    updateScript: (script) => {
      const id = projectId();
      set(bundleWith({ script }));
      scheduleSave('script', `script:${id}`, `/api/projects/${id}/script`, () => ({ script: get().bundle?.script ?? {} }));
      // 服务端会算出「只改了一侧」的待确认标记，保存后同步这个标记，不动文本。
      schedule(`script-flag:${id}`, async () => {
        try {
          const result = await api.get<{ script: Script }>(`/api/projects/${id}/script`);
          set((state) => ({
            bundle: state.bundle
              ? { ...state.bundle, script: { ...state.bundle.script, syncPending: result.script.syncPending } }
              : null,
          }));
        } catch (error) { fail(error); }
      }, 900);
    },

    generateScript: (input) => run(async () => {
      const id = projectId();
      const mode = get().bundle?.meta.exportMode ?? 'bilingual';
      const url = `/api/projects/${id}/script/generate`;
      let result: { script: Script; task: Task };
      let legacy = false;
      try {
        result = await api.post<{ script: Script; task: Task }>(url, { ...input, languageMode: mode });
      } catch (error) {
        if (!(error instanceof ApiError) || error.status !== 400) throw error;
        // 旧服务端不认识 languageMode：退回无字段请求，前端按语言类型裁剪后落盘。
        result = await api.post<{ script: Script; task: Task }>(url, input);
        legacy = true;
        const s = result.script;
        const trimmed: Script = {
          ...s,
          zh: showsZh(mode) ? s.zh : '',
          th: showsTh(mode) ? s.th : '',
          narrationZh: showsZh(mode) ? s.narrationZh : '',
          narrationTh: showsTh(mode) ? s.narrationTh : '',
          lines: s.lines.map((line) => ({
            ...line,
            textZh: showsZh(mode) ? line.textZh : '',
            textTh: showsTh(mode) ? line.textTh : '',
          })),
          syncPending: false,
        };
        await api.put(`/api/projects/${id}/script`, { script: trimmed });
        result.script = trimmed;
      }
      set(bundleWith({ script: result.script }));
      await refreshTasks();
      const label = mode === 'zh' ? '中文' : mode === 'th' ? '泰语' : '中泰双语';
      set({ notice: `已生成${label}剧本（${result.task.provider}），请人工校对台词${legacy ? '；建议重启服务端以完整启用语言类型' : ''}` });
    }),

    syncScript: (from) => run(async () => {
      const id = projectId();
      const result = await api.post<{ script: Script }>(`/api/projects/${id}/script/sync`, { from });
      set(bundleWith({ script: result.script }));
      set({ notice: '已按你的确认覆盖另一语言' });
    }),

    dismissSync: () => run(async () => {
      const id = projectId();
      const result = await api.post<{ script: Script }>(`/api/projects/${id}/script/dismiss-sync`, {});
      set(bundleWith({ script: result.script }));
    }),

    splitShots: () => run(async () => {
      const id = projectId();
      const result = await api.post<{ shots: Shot[]; task: Task }>(`/api/projects/${id}/storyboard/split`, {});
      set({
        ...bundleWith({ shots: result.shots }),
        selectedShotId: result.shots[0]?.id ?? null,
        notice: `已生成 ${result.shots.length} 个镜头，可逐镜头编辑`,
      });
      await refreshTasks();
    }),

    selectShot: (selectedShotId) => set({ selectedShotId }),

    updateShot: (shotId, patch) => {
      const id = projectId();
      patchBuffer.set(shotId, { ...(patchBuffer.get(shotId) ?? {}), ...patch });
      setSaving('storyboard', true);
      set((state) => ({
        bundle: state.bundle
          ? { ...state.bundle, shots: state.bundle.shots.map((s) => (s.id === shotId ? { ...s, ...patch } : s)) }
          : null,
      }));
      schedule(`shot:${id}:${shotId}`, async () => {
        const body = patchBuffer.get(shotId) ?? {};
        patchBuffer.delete(shotId);
        try {
          const result = await api.patch<{ shot: Shot }>(`/api/projects/${id}/shots/${shotId}`, body);
          set((state) => ({
            bundle: state.bundle
              ? {
                  ...state.bundle,
                  shots: state.bundle.shots.map((s) => s.id === shotId
                    ? { ...s, version: result.shot.version, status: result.shot.status, updatedAt: result.shot.updatedAt }
                    : s),
                }
              : null,
          }));
          markSaved('storyboard');
        } catch (error) {
          setSaving('storyboard', false);
          fail(error);
        }
      });
    },

    addShot: () => run(async () => {
      const id = projectId();
      const result = await api.post<{ shot: Shot }>(`/api/projects/${id}/shots`, {});
      const shots = [...(get().bundle?.shots ?? []), result.shot];
      set({ ...bundleWith({ shots }), selectedShotId: result.shot.id });
    }),

    removeShot: (shotId) => run(async () => {
      const id = projectId();
      const result = await api.del<{ shots: Shot[] }>(`/api/projects/${id}/shots/${shotId}`);
      set({ ...bundleWith({ shots: result.shots }), selectedShotId: result.shots[0]?.id ?? null });
    }),

    reorderShots: (orderedIds) => run(async () => {
      const id = projectId();
      const result = await api.post<{ shots: Shot[] }>(`/api/projects/${id}/shots/reorder`, { orderedIds });
      set(bundleWith({ shots: result.shots }));
    }),

    restoreShot: (shotId, version) => run(async () => {
      const id = projectId();
      const result = await api.post<{ shot: Shot }>(`/api/projects/${id}/shots/${shotId}/restore`, { version });
      set((state) => ({
        bundle: state.bundle
          ? { ...state.bundle, shots: state.bundle.shots.map((s) => (s.id === shotId ? result.shot : s)) }
          : null,
      }));
      set({ notice: `已恢复 v${version}（当前 v${result.shot.version}）` });
    }),

    regenerateShot: (shotId, kind) => run(async () => {
      const id = projectId();
      const result = await api.post<{ shot?: Shot; task: Task }>(
        `/api/projects/${id}/shots/${shotId}/regenerate`, { kind },
      );
      if (result.shot) {
        set((state) => ({
          bundle: state.bundle
            ? { ...state.bundle, shots: state.bundle.shots.map((s) => (s.id === shotId ? result.shot! : s)) }
            : null,
        }));
      }
      await refreshTasks();
      const note = String(result.task.result?.notice ?? '');
      set({ notice: note || `已执行单镜头任务：${kind}` });
    }),

    refreshTasks: () => run(async () => { await refreshTasks(); }),
    cancelTask: (taskId) => run(async () => {
      await api.post(`/api/tasks/${taskId}/cancel`, {});
      await refreshTasks();
    }),
    retryTask: (taskId) => run(async () => {
      await api.post(`/api/tasks/${taskId}/retry`, {});
      await refreshTasks();
    }),

    startRender: (mode) => run(async () => {
      const id = projectId();
      if (!get().bundle?.shots.length) throw new Error('没有分镜：先回「制作」写完剧本，点顶部「提交并自动分镜」');
      set({ renderTask: null, renderResult: null, renderError: null });
      const result = await api.post<{ task: Task; reused: boolean }>(
        `/api/projects/${id}/render`, mode ? { mode } : {},
      );
      set({
        renderTask: result.task,
        notice: result.reused ? '已有渲染任务在跑，继续显示它的进度' : '视频渲染已开始：正在画镜头、合成画面与音轨，请稍候',
      });
      // 不 await：让 busy 立刻解除，进度由轮询更新
      void pollRender(result.task.id);
    }),

    clearRender: () => set({ renderTask: null, renderResult: null, renderError: null }),

    downloadFile: (filePath) => run(async () => {
      await downloadOutput(filePath);
      set({ notice: '已开始下载成片，文件会保存到浏览器的下载目录' });
    }),

    exportJson: () => run(async () => {
      const id = projectId();
      await downloadProjectJson(id);
      set({ notice: '已开始下载项目 JSON 备份' });
    }),
  };
});
