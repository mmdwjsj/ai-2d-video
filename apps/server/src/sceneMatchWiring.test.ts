/**
 * 一致性回归：场景自动匹配只能有一套算法、一处审阅入口，手动选择必须能落盘。
 *
 * 以前自动分镜悄悄把 sceneId 写死在镜头里，界面只有一个藏在折叠里的换场景按钮，
 * 用户既看不出「为什么配这个场景」，重新自动分镜又会把手动改的全部冲掉。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (file: string): string => fs.readFileSync(file, 'utf8');

test('自动分镜与审阅面板共用同一个场景匹配纯函数', () => {
  const local = read('packages/ai-providers/src/local.ts');
  const review = read('apps/web/src/SceneMatchReview.tsx');
  const storyboard = read('apps/web/src/pages/StoryboardPage.tsx');
  assert.ok(local.includes("from '@thai-video/core/sceneMatch'"), '自动分镜改用共享模块');
  assert.ok(!local.includes('const matchScene'), '不再保留第二套匹配算法');
  assert.ok(review.includes('shotSceneSuggestion'), '审阅面板用同一函数算自动建议');
  assert.ok(storyboard.includes('shotSceneSuggestion'), '单镜头详情也用同一函数');
  assert.ok(read('apps/web/vite.config.ts').includes("'@thai-video/core/sceneMatch'"),
    '浏览器要能直接 import 纯计算模块，不能走会带 node:sqlite 的 core 入口');
});

test('手动指定的场景写入镜头，并在重新自动分镜时继承', () => {
  const types = read('packages/core/src/types.ts');
  const validation = read('apps/server/src/validation.ts');
  const handlers = read('apps/server/src/handlers.ts');
  assert.ok(types.includes("sceneSource: 'auto' | 'manual'"), '镜头记录自动 / 手动来源');
  assert.ok(types.includes('sceneHint: string'), '剧本场景提示留档，供审阅解释依据');
  assert.ok(validation.includes("sceneSource: z.enum(['auto', 'manual'])"), 'patch 白名单放行手动来源');
  assert.ok(validation.includes("sceneHint 是自动分镜产物"), 'sceneHint 不允许前端改写');
  assert.ok(handlers.includes('inheritManualSceneSelections(draftToShots(drafts), previous)'),
    '批量重建前先继承手动场景');
  assert.ok(handlers.includes('preservedManualScenes'), '任务结果如实回报保留了多少手动场景');
});

test('审阅面板提供自动匹配预览、依据、手动选择与恢复自动', () => {
  const review = read('apps/web/src/SceneMatchReview.tsx');
  const picker = read('apps/web/src/ScenePicker.tsx');
  for (const marker of [
    '自动建议', '当前使用', '程序兜底', '命中：', '待确认',
    '手动选择场景', '恢复自动', '重新自动匹配', '清除手动指定',
    "sceneSource: 'manual'", "sceneSource: 'auto'",
  ]) {
    assert.ok(review.includes(marker), `审阅面板缺少「${marker}」`);
  }
  assert.ok(picker.includes('自动建议'), '场景选择器把建议排在最前并打标记');
  assert.ok(picker.includes('sceneThumbUrl'), '选项缩略图与成片同一套画面配色');
});

test('分镜页与预览页都显示同一套场景状态，不再有第二套选择器', () => {
  const storyboard = read('apps/web/src/pages/StoryboardPage.tsx');
  const preview = read('apps/web/src/pages/PreviewPage.tsx');
  assert.ok(storyboard.includes('<SceneMatchReview'), '分镜页挂上审阅面板');
  assert.ok(storyboard.includes('<ScenePicker'), '单镜头详情复用共享选择器');
  assert.ok(!storyboard.includes('setScenePicker'), '旧的内联场景网格已删除');
  assert.ok(storyboard.includes("item.sceneSource === 'manual'"), '镜头列表标出手动指定');
  assert.ok(preview.includes('sceneThumbUrl(scene)'), '预览页镜头列表显示场景缩略图');
  assert.ok(read('apps/web/src/previewFrames.ts').includes('s.sceneId'),
    '换场景会改变预览帧缓存键，预览画面立刻跟着变');
});
