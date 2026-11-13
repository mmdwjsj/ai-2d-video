import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { createTestWorkbench } from './testUtils.js';

const w = await createTestWorkbench();
after(() => w.cleanup());

test('新建项目自动带入 3 个人物与 12 个场景，元数据落 SQLite', () => {
  const bundle = w.projects.create('测试项目', '冒烟');
  assert.equal(bundle.characters.length, 3);
  assert.equal(bundle.scenes.length, 12);
  assert.equal(bundle.shots.length, 0);
  assert.equal(bundle.meta.name, '测试项目');
  assert.ok(w.db.get<{ id: string }>('SELECT id FROM projects WHERE id = ?', bundle.meta.id));
  assert.ok(w.db.get<{ id: string }>('SELECT id FROM tasks WHERE type = ?', 'project.init'));
});

test('项目可复制、可改名、可删除', () => {
  const source = w.projects.create('源项目');
  w.projects.patch(source.meta.id, { name: '改名后', exportMode: 'bilingual' });
  const copy = w.projects.duplicate(source.meta.id);
  assert.equal(copy.characters.length, 3);
  assert.notEqual(copy.meta.id, source.meta.id);
  assert.equal(w.projects.meta(source.meta.id).exportMode, 'bilingual');
  w.projects.remove(copy.meta.id);
  assert.equal(w.db.get('SELECT id FROM projects WHERE id = ?', copy.meta.id), undefined);
});

test('重新打开数据库后项目与任务仍在（持久化）', () => {
  const created = w.projects.create('持久化项目');
  const reopened = new w.core.Db(w.core.P.database());
  const row = reopened.get<{ name: string }>('SELECT name FROM projects WHERE id = ?', created.meta.id);
  assert.equal(row?.name, '持久化项目');
  const tasks = reopened.all('SELECT id FROM tasks WHERE project_id = ?', created.meta.id);
  assert.equal(tasks.length, 1);
  reopened.close();
});

test('剧本与分镜以 JSON 文件落盘，可原子重写', () => {
  const bundle = w.projects.create('JSON 项目');
  const script = { ...bundle.script, zh: '中文台词', th: 'บทสนทนาไทย' };
  const saved = w.script.save(bundle.meta.id, script);
  assert.equal(saved.zh, '中文台词');
  const shots = [{ ...w.core.emptyShot(1, 'shot-a'), dialogueZh: '你好' }];
  w.storyboard.replaceAll(bundle.meta.id, shots);
  const again = w.projects.get(bundle.meta.id);
  assert.equal(again.shots[0].dialogueZh, '你好');
  assert.equal(again.script.th, 'บทสนทนาไทย');
});
