import { randomUUID } from 'node:crypto';

/** 全局唯一 ID；前缀让日志与 SQLite 里一眼看出对象类型。 */
export const makeId = (prefix: string): string =>
  `${prefix}-${randomUUID().replace(/-/g, '').slice(0, 12)}`;
