import fs from 'node:fs';
import path from 'node:path';
import { Db } from './db.js';
import { appConfig } from './defaults.js';
import { readJson, writeJsonAtomic } from './jsonStore.js';
import { makeId } from './ids.js';
import { P, fromRelative, toRelative } from './paths.js';
import type { TaskQueue } from './tasks.js';
import { emptyShot, nowIso } from './types.js';
import type { Shot, ShotVersion } from './types.js';

type VersionRow = {
  id: string; project_id: string; shot_id: string; version: number;
  path: string; note: string; saved_at: string;
};

const toVersion = (row: VersionRow): ShotVersion => ({
  shotId: row.shot_id, version: row.version, path: row.path,
  note: row.note, savedAt: row.saved_at,
});

/**
 * 分镜服务。所有变更以 shotId 为单位，重新生成任一镜头都不动其它镜头；
 * 每次变更前先写历史快照，可逐版本恢复；批量操作绝不覆盖已锁定镜头。
 */
export class StoryboardService {
  private readonly maxVersions: number;

  constructor(private readonly db: Db, private readonly queue: TaskQueue) {
    this.maxVersions = appConfig().maxShotVersions || 30;
  }

  list(projectId: string): Shot[] {
    const shots = readJson<Shot[]>(P.projectFile(projectId, 'shots.json'), []);
    return [...shots].sort((a, b) => a.order - b.order);
  }

  /** 自动分镜等批量写入：只要存在锁定镜头就中止，绝不覆盖。 */
  replaceAll(projectId: string, shots: Shot[]): Shot[] {
    const locked = this.list(projectId).filter((s) => s.locked);
    if (locked.length > 0) {
      throw new Error(`存在 ${locked.length} 个已锁定镜头，批量自动分镜已中止（锁定镜头不会被覆盖）`);
    }
    const next = shots
      .sort((a, b) => a.order - b.order)
      .map((shot, index) => ({ ...shot, order: index + 1, updatedAt: nowIso() }));
    writeJsonAtomic(P.projectFile(projectId, 'shots.json'), next);
    this.touch(projectId);
    return next;
  }

  patchShot(
    projectId: string,
    shotId: string,
    patch: Partial<Shot>,
    opts: { allowLocked?: boolean; note?: string } = {},
  ): Shot {
    const shots = this.list(projectId);
    const index = shots.findIndex((s) => s.id === shotId);
    if (index < 0) throw new Error(`镜头不存在：${shotId}`);
    const current = shots[index];
    const unlocking = patch.locked === false;
    if (current.locked && !opts.allowLocked && !unlocking) {
      throw new Error('镜头已锁定，请先解锁再编辑');
    }
    this.snapshot(projectId, current, opts.note ?? `编辑前 v${current.version}`);
    const next: Shot = {
      ...current,
      ...patch,
      id: current.id,
      order: current.order,
      version: current.version + 1,
      updatedAt: nowIso(),
    };
    shots[index] = next;
    writeJsonAtomic(P.projectFile(projectId, 'shots.json'), shots);
    this.touch(projectId);
    return next;
  }

  addShot(projectId: string, atOrder?: number): Shot {
    const shots = this.list(projectId);
    const order = atOrder ?? shots.length + 1;
    const fresh: Shot = emptyShot(order, makeId('shot'));
    const next = [...shots, fresh].sort((a, b) => a.order - b.order)
      .map((shot, i) => ({ ...shot, order: i + 1 }));
    writeJsonAtomic(P.projectFile(projectId, 'shots.json'), next);
    this.touch(projectId);
    return next.find((s) => s.id === fresh.id)!;
  }

  removeShot(projectId: string, shotId: string): Shot[] {
    const shots = this.list(projectId);
    const target = shots.find((s) => s.id === shotId);
    if (target?.locked) throw new Error('镜头已锁定，不能删除');
    const next = shots.filter((s) => s.id !== shotId).map((s, i) => ({ ...s, order: i + 1 }));
    writeJsonAtomic(P.projectFile(projectId, 'shots.json'), next);
    this.touch(projectId);
    return next;
  }

  /** 调整顺序：锁定镜头必须留在原位，否则整批拒绝。 */
  reorder(projectId: string, orderedIds: string[]): Shot[] {
    const shots = this.list(projectId);
    const known = new Set(shots.map((s) => s.id));
    if (orderedIds.length !== shots.length || new Set(orderedIds).size !== shots.length ||
        orderedIds.some((id) => !known.has(id))) {
      throw new Error('镜头顺序列表与当前分镜不一致');
    }
    const before = new Map(shots.map((s, i) => [s.id, i]));
    const lockedMoved = shots.filter((s) => s.locked && before.get(s.id) !== orderedIds.indexOf(s.id));
    if (lockedMoved.length > 0) {
      throw new Error(`有 ${lockedMoved.length} 个已锁定镜头不能移动，请先解锁`);
    }
    const byId = new Map(shots.map((s) => [s.id, s]));
    const next = orderedIds.map((id, i) => ({ ...byId.get(id)!, order: i + 1, updatedAt: nowIso() }));
    writeJsonAtomic(P.projectFile(projectId, 'shots.json'), next);
    this.touch(projectId);
    return next;
  }

  versions(projectId: string, shotId: string): ShotVersion[] {
    return this.db.all<VersionRow>(
      'SELECT * FROM shot_versions WHERE project_id = ? AND shot_id = ? ORDER BY version DESC',
      projectId, shotId,
    ).map(toVersion);
  }

  restore(projectId: string, shotId: string, version: number): Shot {
    const row = this.db.get<VersionRow>(
      'SELECT * FROM shot_versions WHERE project_id = ? AND shot_id = ? AND version = ?',
      projectId, shotId, version,
    );
    if (!row) throw new Error(`版本不存在：${shotId} v${version}`);
    const saved = readJson<Shot | null>(fromRelative(row.path), null);
    if (!saved) throw new Error(`版本文件已丢失：${row.path}`);
    const shots = this.list(projectId);
    const index = shots.findIndex((s) => s.id === shotId);
    if (index < 0) throw new Error(`镜头不存在：${shotId}`);
    const current = shots[index];
    if (current.locked) throw new Error('镜头已锁定，请先解锁再恢复版本');
    this.snapshot(projectId, current, `恢复 v${version} 前`);
    const next: Shot = {
      ...saved,
      id: current.id,
      order: current.order,
      version: current.version + 1,
      locked: false,
      updatedAt: nowIso(),
    };
    shots[index] = next;
    writeJsonAtomic(P.projectFile(projectId, 'shots.json'), shots);
    this.touch(projectId);
    return next;
  }

  /** 单镜头重新生成：只登记任务并重置本镜头，画面 Provider 未配置时不假装产出素材。 */
  enqueueRegenerate(projectId: string, shotId: string, kind: 'image' | 'audio.zh' | 'audio.th') {
    const shot = this.list(projectId).find((s) => s.id === shotId);
    if (!shot) throw new Error(`镜头不存在：${shotId}`);
    if (shot.locked) throw new Error('镜头已锁定，请先解锁再重新生成');
    const type = kind === 'image' ? 'shot.image' : kind === 'audio.zh' ? 'shot.audio.zh' : 'shot.audio.th';
    return this.queue.enqueue({
      projectId, shotId, type,
      payload: { shotId, kind, characterIds: shot.characterIds, sceneId: shot.sceneId },
    });
  }

  private snapshot(projectId: string, shot: Shot, note: string): void {
    const dir = P.historyDir(projectId, shot.id);
    fs.mkdirSync(dir, { recursive: true });
    const absolute = path.join(dir, `v${shot.version}.json`);
    writeJsonAtomic(absolute, shot);
    this.db.run(
      `INSERT INTO shot_versions (id, project_id, shot_id, version, path, note, saved_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      makeId('ver'), projectId, shot.id, shot.version, toRelative(absolute), note, nowIso(),
    );
    const stale = this.db.all<VersionRow>(
      'SELECT * FROM shot_versions WHERE project_id = ? AND shot_id = ? ORDER BY version DESC LIMIT -1 OFFSET ?',
      projectId, shot.id, this.maxVersions,
    );
    for (const row of stale) {
      try { fs.rmSync(fromRelative(row.path), { force: true }); } catch { /* 文件已不在则忽略 */ }
      this.db.run('DELETE FROM shot_versions WHERE id = ?', row.id);
    }
  }

  private touch(projectId: string): void {
    this.db.run('UPDATE projects SET updated_at = ? WHERE id = ?', nowIso(), projectId);
  }
}
