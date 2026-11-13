/**
 * 持久化任务队列。任务全在 SQLite 里，进程重启后 `analyzing/generating/
 * processing` 会被恢复成 `pending` 重新接管，不会丢任务记录。
 */
import { Db } from './db.js';
import { appConfig } from './defaults.js';
import { makeId } from './ids.js';
import { nowIso } from './types.js';
import type { Task, TaskStatus, TaskType } from './types.js';

type TaskRow = {
  id: string; project_id: string; shot_id: string | null; type: TaskType;
  status: TaskStatus; progress: number; error: string; attempts: number;
  max_attempts: number; payload: string; result: string; provider: string;
  model: string; cost: number; created_at: string; updated_at: string;
  started_at: string | null; finished_at: string | null;
};

const toTask = (row: TaskRow): Task => ({
  id: row.id,
  projectId: row.project_id,
  shotId: row.shot_id,
  type: row.type,
  status: row.status,
  progress: row.progress,
  error: row.error,
  attempts: row.attempts,
  maxAttempts: row.max_attempts,
  payload: JSON.parse(row.payload || '{}') as Record<string, unknown>,
  result: JSON.parse(row.result || '{}') as Record<string, unknown>,
  provider: row.provider,
  model: row.model,
  cost: row.cost,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
  startedAt: row.started_at,
  finishedAt: row.finished_at,
});

export type TaskHandler = (ctx: {
  task: Task;
  progress: (percent: number, status?: TaskStatus) => void;
}) => Promise<Record<string, unknown>>;

export type EnqueueInput = {
  projectId: string;
  type: TaskType;
  shotId?: string | null;
  payload?: Record<string, unknown>;
  provider?: string;
  model?: string;
};

export class TaskQueue {
  private readonly handlers = new Map<TaskType, TaskHandler>();
  private readonly busy = new Set<string>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private readonly pollIntervalMs: number;
  private readonly maxAttempts: number;

  constructor(private readonly db: Db, opts: { pollIntervalMs?: number; maxAttempts?: number } = {}) {
    const config = appConfig();
    this.pollIntervalMs = opts.pollIntervalMs ?? config.task.pollIntervalMs;
    this.maxAttempts = opts.maxAttempts ?? config.task.maxAttempts;
  }

  register(type: TaskType, handler: TaskHandler): void {
    this.handlers.set(type, handler);
  }

  enqueue(input: EnqueueInput): Task {
    const id = makeId('task');
    const now = nowIso();
    this.db.run(
      `INSERT INTO tasks (id, project_id, shot_id, type, status, progress, error,
        attempts, max_attempts, payload, result, provider, model, cost,
        created_at, updated_at, started_at, finished_at)
       VALUES (?, ?, ?, ?, 'pending', 0, '', 0, ?, ?, '{}', ?, ?, 0, ?, ?, NULL, NULL)`,
      id, input.projectId, input.shotId ?? null, input.type, this.maxAttempts,
      JSON.stringify(input.payload ?? {}), input.provider ?? '', input.model ?? '',
      now, now,
    );
    return this.get(id)!;
  }

  get(id: string): Task | undefined {
    const row = this.db.get<TaskRow>('SELECT * FROM tasks WHERE id = ?', id);
    return row ? toTask(row) : undefined;
  }

  list(projectId?: string, limit = 100): Task[] {
    const rows = projectId
      ? this.db.all<TaskRow>('SELECT * FROM tasks WHERE project_id = ? ORDER BY created_at DESC LIMIT ?', projectId, limit)
      : this.db.all<TaskRow>('SELECT * FROM tasks ORDER BY created_at DESC LIMIT ?', limit);
    return rows.map(toTask);
  }

  cancel(id: string): Task {
    const task = this.get(id);
    if (!task) throw new Error(`任务不存在：${id}`);
    if (task.status === 'completed') throw new Error('已完成任务不能取消');
    this.db.run(
      `UPDATE tasks SET status = 'cancelled', updated_at = ?, finished_at = ? WHERE id = ?`,
      nowIso(), nowIso(), id,
    );
    return this.get(id)!;
  }

  retry(id: string): Task {
    const task = this.get(id);
    if (!task) throw new Error(`任务不存在：${id}`);
    if (task.status !== 'failed' && task.status !== 'cancelled') {
      throw new Error('只有失败或已取消的任务可以重试');
    }
    this.db.run(
      `UPDATE tasks SET status = 'pending', progress = 0, error = '', attempts = 0,
        finished_at = NULL, updated_at = ? WHERE id = ?`,
      nowIso(), id,
    );
    return this.get(id)!;
  }

  /** API 同步执行一条任务并返回最终状态；后台 worker 仍负责跨重启的遗留任务。 */
  async runNow(id: string): Promise<Task> {
    return this.process(id);
  }

  start(): void {
    // 上次进程中断时卡在中间态的任务全部退回 pending。
    this.db.run(
      `UPDATE tasks SET status = 'pending', progress = 0, updated_at = ?
       WHERE status IN ('analyzing', 'generating', 'processing')`,
      nowIso(),
    );
    if (this.timer) return;
    this.timer = setInterval(() => void this.tick(), this.pollIntervalMs);
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  private async tick(): Promise<void> {
    const row = this.db.get<{ id: string }>(
      `SELECT id FROM tasks WHERE status = 'pending' ORDER BY created_at ASC LIMIT 1`,
    );
    if (row && !this.busy.has(row.id)) await this.process(row.id);
  }

  private async process(id: string): Promise<Task> {
    const current = this.get(id);
    if (!current || current.status !== 'pending' || this.busy.has(id)) return current!;
    this.busy.add(id);
    const now = nowIso();
    this.db.run(
      `UPDATE tasks SET status = 'analyzing', attempts = attempts + 1, started_at = ?, updated_at = ? WHERE id = ?`,
      now, now, id,
    );

    const handler = this.handlers.get(current.type);
    if (!handler) {
      this.fail(id, `未注册的任务处理器：${current.type}`, true);
      this.busy.delete(id);
      return this.get(id)!;
    }

    try {
      const progress = (percent: number, status: TaskStatus = 'generating'): void => {
        this.db.run(
          `UPDATE tasks SET progress = ?, status = ?, updated_at = ? WHERE id = ?`,
          Math.max(0, Math.min(100, Math.round(percent))), status, nowIso(), id,
        );
      };
      progress(15);
      const result = await handler({ task: this.get(id)!, progress });
      this.db.run(
        `UPDATE tasks SET status = 'completed', progress = 100, result = ?,
          error = '', finished_at = ?, updated_at = ? WHERE id = ?`,
        JSON.stringify(result ?? {}), nowIso(), nowIso(), id,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const attempts = this.get(id)?.attempts ?? 1;
      this.fail(id, message, attempts >= this.maxAttempts);
    } finally {
      this.busy.delete(id);
    }
    return this.get(id)!;
  }

  private fail(id: string, message: string, exhausted: boolean): void {
    if (exhausted) {
      this.db.run(
        `UPDATE tasks SET status = 'failed', error = ?, finished_at = ?, updated_at = ? WHERE id = ?`,
        message, nowIso(), nowIso(), id,
      );
    } else {
      // 还有重试额度：退回 pending，worker 下一轮接管，失败原因保留可查。
      this.db.run(
        `UPDATE tasks SET status = 'pending', progress = 0, error = ?, updated_at = ? WHERE id = ?`,
        message, nowIso(), id,
      );
    }
  }
}
