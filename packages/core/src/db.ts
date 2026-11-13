/**
 * SQLite 元数据层。使用 Node >= 22.5 内置的 `node:sqlite`，Windows 上免编译
 * 原生模块。密钥/任务/素材/版本索引都在这里，剧本与分镜仍是 JSON 文件。
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

type SqlValue = string | number | bigint | null | Uint8Array;
type Statement = {
  run(...params: SqlValue[]): { changes: number | bigint; lastInsertRowid: number | bigint };
  get(...params: SqlValue[]): unknown;
  all(...params: SqlValue[]): unknown[];
};
type SqliteHandle = {
  exec(sql: string): void;
  prepare(sql: string): Statement;
  close(): void;
};

const SCHEMA = `
CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  export_mode TEXT NOT NULL DEFAULT 'zh',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS assets (
  id TEXT PRIMARY KEY,
  project_id TEXT,
  character_id TEXT,
  slot TEXT,
  kind TEXT NOT NULL,
  path TEXT NOT NULL,
  mime_type TEXT NOT NULL DEFAULT '',
  size_bytes INTEGER NOT NULL DEFAULT 0,
  source_task_id TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  shot_id TEXT,
  type TEXT NOT NULL,
  status TEXT NOT NULL,
  progress INTEGER NOT NULL DEFAULT 0,
  error TEXT NOT NULL DEFAULT '',
  attempts INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 3,
  payload TEXT NOT NULL DEFAULT '{}',
  result TEXT NOT NULL DEFAULT '{}',
  provider TEXT NOT NULL DEFAULT '',
  model TEXT NOT NULL DEFAULT '',
  cost REAL NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  started_at TEXT,
  finished_at TEXT
);
CREATE TABLE IF NOT EXISTS shot_versions (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  shot_id TEXT NOT NULL,
  version INTEGER NOT NULL,
  path TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  saved_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
CREATE INDEX IF NOT EXISTS idx_tasks_project ON tasks(project_id);
CREATE INDEX IF NOT EXISTS idx_versions_shot ON shot_versions(project_id, shot_id, version);
CREATE INDEX IF NOT EXISTS idx_assets_project ON assets(project_id);
`;

export class Db {
  private readonly handle: SqliteHandle;

  constructor(file: string) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const sqlite = require('node:sqlite') as {
      DatabaseSync: new (filename: string) => SqliteHandle;
    };
    this.handle = new sqlite.DatabaseSync(file);
    this.handle.exec(SCHEMA);
  }

  run(sql: string, ...params: SqlValue[]): void {
    this.handle.prepare(sql).run(...params);
  }

  get<T>(sql: string, ...params: SqlValue[]): T | undefined {
    return this.handle.prepare(sql).get(...params) as T | undefined;
  }

  all<T>(sql: string, ...params: SqlValue[]): T[] {
    return this.handle.prepare(sql).all(...params) as T[];
  }

  close(): void {
    this.handle.close();
  }
}
