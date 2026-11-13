import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** 每个测试进程用独立的临时根目录，绝不污染真实 data/。 */
export const createTestWorkbench = async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'thai-wb-'));
  const configDir = path.join(root, 'config');
  fs.mkdirSync(configDir, { recursive: true });
  const sourceConfig = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../config');
  for (const file of ['app.json', 'providers.json', 'characters.json', 'scenes.json']) {
    fs.copyFileSync(path.join(sourceConfig, file), path.join(configDir, file));
  }
  process.env.THAI_VIDEO_ROOT = root;
  const core = await import('./index.js');
  const db = new core.Db(core.P.database());
  const queue = new core.TaskQueue(db, { pollIntervalMs: 20, maxAttempts: 2 });
  const projects = new core.ProjectService(db, queue);
  const script = new core.ScriptService(db);
  const storyboard = new core.StoryboardService(db, queue);
  return {
    core, db, queue, projects, script, storyboard, root,
    cleanup: () => {
      queue.stop();
      db.close();
      fs.rmSync(root, { recursive: true, force: true });
    },
  };
};
