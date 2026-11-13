import fs from 'node:fs';
import { Db } from './db.js';
import { defaultCharacters, defaultScenes, appConfig } from './defaults.js';
import { readJson, writeJsonAtomic } from './jsonStore.js';
import { makeId } from './ids.js';
import { P, toRelative } from './paths.js';
import type { TaskQueue } from './tasks.js';
import { emptyScript, nowIso } from './types.js';
import type { Character, ExportMode, ProjectBundle, ProjectMeta, Scene, Script, Shot } from './types.js';

type ProjectRow = {
  id: string; name: string; description: string; export_mode: ExportMode;
  created_at: string; updated_at: string;
};

const toMeta = (row: ProjectRow): ProjectMeta => ({
  id: row.id, name: row.name, description: row.description,
  exportMode: row.export_mode, createdAt: row.created_at, updatedAt: row.updated_at,
});

export class ProjectService {
  constructor(private readonly db: Db, private readonly queue: TaskQueue) {}

  list(): ProjectMeta[] {
    return this.db.all<ProjectRow>('SELECT * FROM projects ORDER BY created_at DESC').map(toMeta);
  }

  meta(id: string): ProjectMeta {
    const row = this.db.get<ProjectRow>('SELECT * FROM projects WHERE id = ?', id);
    if (!row) throw new Error(`项目不存在：${id}`);
    return toMeta(row);
  }

  /** languageMode 即项目语言类型，落在 projects.export_mode 这一列（全项目唯一真值）。 */
  create(name: string, description = '', languageMode?: ExportMode): ProjectBundle {
    const id = makeId('proj');
    const now = nowIso();
    const mode = languageMode ?? (appConfig().defaultExportMode || 'zh') as ExportMode;
    this.db.run(
      `INSERT INTO projects (id, name, description, export_mode, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      id, name.trim() || '未命名项目', description, mode, now, now,
    );
    const characters = defaultCharacters();
    const scenes = defaultScenes();
    const script = emptyScript();
    const shots: Shot[] = [];
    writeJsonAtomic(P.projectFile(id, 'characters.json'), characters);
    writeJsonAtomic(P.projectFile(id, 'scenes.json'), scenes);
    writeJsonAtomic(P.projectFile(id, 'script.json'), script);
    writeJsonAtomic(P.projectFile(id, 'shots.json'), shots);
    fs.mkdirSync(P.historyDir(id, '_'), { recursive: true });
    this.queue.enqueue({
      projectId: id, type: 'project.init',
      payload: { characters: characters.length, scenes: scenes.length },
      provider: 'local',
    });
    return this.get(id);
  }

  get(id: string): ProjectBundle {
    const meta = this.meta(id);
    const characters = readJson<Character[]>(P.projectFile(id, 'characters.json'), []);
    const scenes = readJson<Scene[]>(P.projectFile(id, 'scenes.json'), []);
    const script = readJson<Script>(P.projectFile(id, 'script.json'), emptyScript());
    const shots = readJson<Shot[]>(P.projectFile(id, 'shots.json'), []);
    return { meta, characters, scenes, script, shots };
  }

  patch(id: string, patch: Partial<Pick<ProjectMeta, 'name' | 'description' | 'exportMode'>>): ProjectMeta {
    const meta = this.meta(id);
    const next = {
      name: patch.name ?? meta.name,
      description: patch.description ?? meta.description,
      exportMode: patch.exportMode ?? meta.exportMode,
    };
    this.db.run(
      `UPDATE projects SET name = ?, description = ?, export_mode = ?, updated_at = ? WHERE id = ?`,
      next.name, next.description, next.exportMode, nowIso(), id,
    );
    return this.meta(id);
  }

  saveCharacters(id: string, characters: Character[]): Character[] {
    this.meta(id);
    const next = characters.map((c) => ({ ...c, updatedAt: nowIso() }));
    writeJsonAtomic(P.projectFile(id, 'characters.json'), next);
    this.touch(id);
    return next;
  }

  saveScenes(id: string, scenes: Scene[]): Scene[] {
    this.meta(id);
    const next = scenes.map((s) => ({ ...s, updatedAt: nowIso() }));
    writeJsonAtomic(P.projectFile(id, 'scenes.json'), next);
    this.touch(id);
    return next;
  }

  duplicate(id: string): ProjectBundle {
    const source = this.get(id);
    const copy = this.create(`${source.meta.name}（副本）`, source.meta.description);
    fs.cpSync(P.projectDir(id), P.projectDir(copy.meta.id), { recursive: true, force: true });
    // create 已写入默认档案，副本目录覆盖后要把项目名改回副本自己的元数据。
    this.db.run(
      `UPDATE projects SET export_mode = ?, updated_at = ? WHERE id = ?`,
      source.meta.exportMode, nowIso(), copy.meta.id,
    );
    return this.get(copy.meta.id);
  }

  remove(id: string): void {
    this.meta(id);
    this.db.run('DELETE FROM tasks WHERE project_id = ?', id);
    this.db.run('DELETE FROM shot_versions WHERE project_id = ?', id);
    this.db.run('DELETE FROM assets WHERE project_id = ?', id);
    this.db.run('DELETE FROM projects WHERE id = ?', id);
    fs.rmSync(P.projectDir(id), { recursive: true, force: true });
  }

  /** 导出完整项目 JSON（第一阶段可用的导出物，不是 MP4）。 */
  exportJson(id: string): ProjectBundle & { exportedAt: string; tasks: ReturnType<TaskQueue['list']> } {
    return { ...this.get(id), exportedAt: nowIso(), tasks: this.queue.list(id) };
  }

  /** 记录素材相对路径，供前端展示与阶段四拼时间轴。 */
  relativePathOf(absolute: string): string {
    return toRelative(absolute);
  }

  private touch(id: string): void {
    this.db.run('UPDATE projects SET updated_at = ? WHERE id = ?', nowIso(), id);
  }
}
