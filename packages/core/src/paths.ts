import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

/** 项目根：默认按源码位置推导，允许 THAI_VIDEO_ROOT 覆盖（便于测试用临时目录）。 */
export const PROJECT_ROOT = process.env.THAI_VIDEO_ROOT
  ? path.resolve(process.env.THAI_VIDEO_ROOT)
  : path.resolve(here, '../../..');

export const P = {
  root: PROJECT_ROOT,
  config: (file: string) => path.join(PROJECT_ROOT, 'config', file),
  database: () => path.join(PROJECT_ROOT, 'data', 'workbench.sqlite'),
  projectsDir: () => path.join(PROJECT_ROOT, 'data', 'projects'),
  projectDir: (id: string) => path.join(PROJECT_ROOT, 'data', 'projects', id),
  projectFile: (id: string, name: string) =>
    path.join(PROJECT_ROOT, 'data', 'projects', id, name),
  historyDir: (projectId: string, shotId: string) =>
    path.join(PROJECT_ROOT, 'data', 'projects', projectId, 'history', 'shots', shotId),
  assetsDir: (kind: string) => path.join(PROJECT_ROOT, 'assets', kind),
  outputDir: () => path.join(PROJECT_ROOT, 'output'),
  webDist: () => path.join(PROJECT_ROOT, 'apps', 'web', 'dist'),
};

/** 存进 SQLite / JSON 的路径一律用相对项目根的 POSIX 风格，换机器不失效。 */
export const toRelative = (absolute: string): string =>
  path.relative(PROJECT_ROOT, absolute).split(path.sep).join('/');

export const fromRelative = (relative: string): string =>
  path.resolve(PROJECT_ROOT, relative);
