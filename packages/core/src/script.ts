import { Db } from './db.js';
import { readJson, writeJsonAtomic } from './jsonStore.js';
import { P } from './paths.js';
import { emptyScript, nowIso } from './types.js';
import type { Language, Script } from './types.js';

/**
 * 双语剧本：中/泰两栏各自独立存储。
 *
 * 铁律：一侧变化绝不自动改写另一侧。检测到「只改了一侧」时仅置
 * `syncPending`，由 UI 提示用户；真正的覆盖只能走显式确认的 `sync()`。
 */
export class ScriptService {
  constructor(private readonly db: Db) {}

  get(projectId: string): Script {
    return readJson<Script>(P.projectFile(projectId, 'script.json'), emptyScript());
  }

  save(projectId: string, script: Script): Script {
    const previous = this.get(projectId);
    const changedZh = script.zh !== previous.zh;
    const changedTh = script.th !== previous.th;
    const oneSideOnly = changedZh !== changedTh;
    const hadBoth = previous.zh.trim().length > 0 || previous.th.trim().length > 0;
    const next: Script = {
      ...script,
      syncPending: oneSideOnly && hadBoth ? true : Boolean(script.syncPending && previous.syncPending),
      updatedAt: nowIso(),
    };
    writeJsonAtomic(P.projectFile(projectId, 'script.json'), next);
    this.touch(projectId);
    return next;
  }

  /** 用户显式确认后，把一种语言的文本覆盖到另一栏（不是机器翻译）。 */
  sync(projectId: string, from: Language): Script {
    const current = this.get(projectId);
    const next: Script = {
      ...current,
      zh: from === 'th' ? current.th : current.zh,
      th: from === 'zh' ? current.zh : current.th,
      syncPending: false,
      updatedAt: nowIso(),
    };
    writeJsonAtomic(P.projectFile(projectId, 'script.json'), next);
    this.touch(projectId);
    return next;
  }

  /** 清除「待确认」提示，但不动任何一栏文本。 */
  dismissSync(projectId: string): Script {
    const current = this.get(projectId);
    return this.save(projectId, { ...current, syncPending: false });
  }

  private touch(projectId: string): void {
    this.db.run('UPDATE projects SET updated_at = ? WHERE id = ?', nowIso(), projectId);
  }
}
