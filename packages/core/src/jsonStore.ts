import fs from 'node:fs';
import path from 'node:path';

/** 读 JSON；文件不存在或损坏时返回兜底值，绝不把半个文件当成有效数据。 */
export const readJson = <T>(file: string, fallback: T): T => {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8')) as T;
  } catch {
    return fallback;
  }
};

/** 原子写：先写同目录临时文件，再 rename，自动保存到一半断电也不会留下坏 JSON。 */
export const writeJsonAtomic = (file: string, value: unknown): void => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  fs.renameSync(tmp, file);
};
