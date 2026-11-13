import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { createTestWorkbench } from './testUtils.js';

const w = await createTestWorkbench();
after(() => w.cleanup());
const project = w.projects.create('剧本与任务测试');
const id = project.meta.id;

test('项目语言类型：新建可指定，之后可切换，落在同一个 export_mode 字段', () => {
  const th = w.projects.create('泰语单语项目', '', 'th');
  assert.equal(th.meta.exportMode, 'th');
  assert.equal(w.projects.meta(th.meta.id).exportMode, 'th', '必须真正落库');
  const patched = w.projects.patch(th.meta.id, { exportMode: 'bilingual' });
  assert.equal(patched.exportMode, 'bilingual');
  w.projects.remove(th.meta.id);
});

test('改一侧语言不会被静默覆盖，显式确认后才同步', () => {
  const initial = w.script.save(id, { ...w.core.emptyScript(), zh: '中文原稿', th: 'ต้นฉบับไทย' });
  assert.equal(initial.syncPending, false);
  const edited = w.script.save(id, { ...w.script.get(id), zh: '中文改稿' });
  assert.equal(edited.th, 'ต้นฉบับไทย', '泰语保持原样');
  assert.equal(edited.syncPending, true);
  const synced = w.script.sync(id, 'zh');
  assert.equal(synced.th, '中文改稿');
  assert.equal(synced.syncPending, false);
  assert.equal(w.script.dismissSync(id).syncPending, false);
});

test('任务执行：pending → completed，进度与结果落库', async () => {
  w.queue.register('project.init', async ({ progress }) => {
    progress(50);
    return { ok: true };
  });
  const task = w.queue.enqueue({ projectId: id, type: 'project.init', provider: 'test' });
  assert.equal(task.status, 'pending');
  const done = await w.queue.runNow(task.id);
  assert.equal(done.status, 'completed');
  assert.equal(done.progress, 100);
  assert.deepEqual(done.result, { ok: true });
  assert.ok(done.startedAt && done.finishedAt);
});

test('失败重试：保留失败原因，额度用尽后进入 failed', async () => {
  let calls = 0;
  w.queue.register('shot.image', async () => {
    calls += 1;
    throw new Error('图像 Provider 未配置');
  });
  const task = w.queue.enqueue({ projectId: id, type: 'shot.image', shotId: 'shot-x' });
  const first = await w.queue.runNow(task.id);
  assert.equal(first.status, 'pending', '还有重试额度时退回 pending');
  assert.match(first.error, /未配置/);
  const second = await w.queue.runNow(task.id);
  assert.equal(second.status, 'failed');
  assert.equal(calls, 2);
  assert.equal(second.attempts, 2);
});

test('取消 / 重试 / 跨连接持久化', () => {
  const task = w.queue.enqueue({ projectId: id, type: 'video.render' });
  assert.equal(w.queue.cancel(task.id).status, 'cancelled');
  assert.equal(w.queue.retry(task.id).status, 'pending');
  const reopened = new w.core.TaskQueue(w.db, { pollIntervalMs: 20 });
  const found = reopened.list(id).find((t) => t.id === task.id);
  assert.equal(found?.status, 'pending');
  assert.ok(reopened.list(id).length >= 3);
});

test('单镜头重生成只创建该镜头的任务', () => {
  w.storyboard.replaceAll(id, [w.core.emptyShot(1, 'shot-a'), w.core.emptyShot(2, 'shot-b')]);
  const task = w.storyboard.enqueueRegenerate(id, 'shot-a', 'image');
  assert.equal(task.shotId, 'shot-a');
  assert.equal(task.type, 'shot.image');
  assert.equal(w.queue.list(id).filter((t) => t.shotId === 'shot-b').length, 0);
});
