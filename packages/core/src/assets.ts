import fs from 'node:fs';
import path from 'node:path';
import { Db } from './db.js';
import { makeId } from './ids.js';
import { P, toRelative } from './paths.js';
import { nowIso } from './types.js';
import type { AssetMeta } from './types.js';

type AssetRow = {
  id: string; project_id: string | null; character_id: string | null; slot: string | null;
  kind: AssetMeta['kind']; path: string; mime_type: string; size_bytes: number;
  source_task_id: string | null; version: number; created_at: string;
};

const toAsset = (row: AssetRow): AssetMeta => ({
  id: row.id, projectId: row.project_id, characterId: row.character_id, slot: row.slot,
  kind: row.kind, path: row.path, mimeType: row.mime_type, sizeBytes: row.size_bytes,
  sourceTaskId: row.source_task_id, version: row.version, createdAt: row.created_at,
});

export type SaveImageInput = {
  fileName?: string;
  base64: string;
  mimeType?: string;
  projectId?: string | null;
  characterId?: string | null;
  slot?: string | null;
  sourceTaskId?: string | null;
};

export class AssetService {
  constructor(private readonly db: Db) {}

  /** 参考图上传：按人物 + 槽位自动追加版本号，旧文件保留可追溯。 */
  saveImage(input: SaveImageInput): AssetMeta {
    const mime = input.mimeType || 'image/png';
    if (!/^image\/(png|jpeg|webp)$/.test(mime)) throw new Error(`不支持的图片格式：${mime}`);
    const raw = input.base64.includes(',') ? input.base64.slice(input.base64.indexOf(',') + 1) : input.base64;
    const buffer = Buffer.from(raw, 'base64');
    if (!buffer.length) throw new Error('图片内容为空');
    const ext = mime === 'image/jpeg' ? 'jpg' : mime === 'image/webp' ? 'webp' : 'png';
    const characterId = input.characterId ?? null;
    const slot = input.slot ?? null;
    const versionRow = this.db.get<{ n: number }>(
      `SELECT COUNT(*) AS n FROM assets WHERE character_id IS ? AND slot IS ? AND kind = 'image'`,
      characterId, slot,
    );
    const version = (versionRow?.n ?? 0) + 1;
    const dir = characterId
      ? path.join(P.assetsDir('images'), characterId)
      : P.assetsDir('images');
    fs.mkdirSync(dir, { recursive: true });
    const safeSlot = (slot ?? 'misc').replace(/[^a-zA-Z0-9_-]/g, '-');
    const absolute = path.join(dir, `${safeSlot}-v${version}.${ext}`);
    fs.writeFileSync(absolute, buffer);

    const id = makeId('asset');
    const now = nowIso();
    this.db.run(
      `INSERT INTO assets (id, project_id, character_id, slot, kind, path, mime_type,
        size_bytes, source_task_id, version, created_at)
       VALUES (?, ?, ?, ?, 'image', ?, ?, ?, ?, ?, ?)`,
      id, input.projectId ?? null, characterId, slot, toRelative(absolute), mime,
      buffer.length, input.sourceTaskId ?? null, version, now,
    );
    return toAsset(this.db.get<AssetRow>('SELECT * FROM assets WHERE id = ?', id)!);
  }

  list(projectId?: string, characterId?: string): AssetMeta[] {
    const rows = this.db.all<AssetRow>(
      `SELECT * FROM assets WHERE (? IS NULL OR project_id = ?)
        AND (? IS NULL OR character_id = ?) ORDER BY created_at DESC`,
      projectId ?? null, projectId ?? null, characterId ?? null, characterId ?? null,
    );
    return rows.map(toAsset);
  }
}
