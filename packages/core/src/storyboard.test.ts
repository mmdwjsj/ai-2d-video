import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { createTestWorkbench } from './testUtils.js';

const w = await createTestWorkbench();
after(() => w.cleanup());

const project = w.projects.create('分镜测试');
const id = project.meta.id;
const base = [
  { ...w.core.emptyShot(1, 'shot-1'), dialogueZh: '第一句', durationSec: 3 },
  { ...w.core.emptyShot(2, 'shot-2'), dialogueZh: '第二句', durationSec: 4 },
];
w.storyboard.replaceAll(id, base);

test('单镜头编辑只改自己，并留下可恢复的版本快照', () => {
  const updated = w.storyboard.patchShot(id, 'shot-1', { dialogueZh: '改过的第一句' });
  assert.equal(updated.version, 2);
  assert.equal(updated.dialogueZh, '改过的第一句');
  assert.equal(w.storyboard.list(id).find((s) => s.id === 'shot-2')!.version, 1, '其它镜头不受影响');

  const versions = w.storyboard.versions(id, 'shot-1');
  assert.equal(versions.length, 1);
  assert.equal(versions[0].version, 1);
  const restored = w.storyboard.restore(id, 'shot-1', 1);
  assert.equal(restored.dialogueZh, '第一句');
  assert.equal(restored.version, 3);
  assert.equal(w.storyboard.versions(id, 'shot-1').length, 2);
});

test('锁定镜头拒绝编辑、拒绝删除、拒绝批量覆盖', () => {
  w.storyboard.patchShot(id, 'shot-2', { locked: true });
  assert.throws(() => w.storyboard.patchShot(id, 'shot-2', { dialogueZh: '偷偷改' }), /锁定/);
  assert.throws(() => w.storyboard.removeShot(id, 'shot-2'), /锁定/);
  assert.throws(() => w.storyboard.replaceAll(id, base), /锁定/);
  // 允许显式解锁，之后恢复正常编辑。
  const unlocked = w.storyboard.patchShot(id, 'shot-2', { locked: false });
  assert.equal(unlocked.locked, false);
  assert.equal(w.storyboard.patchShot(id, 'shot-2', { dialogueZh: '解锁后' }).dialogueZh, '解锁后');
});

test('排序保护：锁定镜头不能移动，解锁后可正常调整顺序', () => {
  w.storyboard.addShot(id);
  const shots = w.storyboard.list(id);
  assert.equal(shots.length, 3);
  const desired = [shots[1].id, shots[0].id, shots[2].id];
  w.storyboard.patchShot(id, shots[0].id, { locked: true });
  assert.throws(() => w.storyboard.reorder(id, desired), /锁定/);
  assert.throws(() => w.storyboard.reorder(id, [shots[0].id, 'unknown-id', shots[2].id]), /顺序列表/);
  w.storyboard.patchShot(id, shots[0].id, { locked: false });
  const reordered = w.storyboard.reorder(id, desired);
  assert.equal(reordered[0].id, shots[1].id);
  assert.equal(reordered[0].order, 1);
});

test('批量自动分镜遇到锁定镜头会中止，不覆盖已完成镜头', () => {
  w.storyboard.patchShot(id, 'shot-1', { locked: true });
  assert.throws(
    () => w.storyboard.replaceAll(id, [{ ...w.core.emptyShot(1, 'shot-new'), dialogueZh: '全新' }]),
    /已锁定镜头/,
  );
  assert.ok(w.storyboard.list(id).some((s) => s.id === 'shot-1'), '原镜头仍在');
  assert.equal(w.storyboard.list(id).some((s) => s.id === 'shot-new'), false);
});
