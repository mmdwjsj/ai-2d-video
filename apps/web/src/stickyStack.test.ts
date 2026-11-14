import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pickCurrentSection } from './stickyStack.logic.js';

const keys = ['characters', 'scenes', 'script', 'storyboard'] as const;

test('页面顶部时高亮第 1 段', () => {
  assert.equal(pickCurrentSection(keys, [120, 620, 1120, 1620], 100), 'characters');
});

test('滚到第 2 段时接力到「场景」，而不是仍停在人物', () => {
  assert.equal(pickCurrentSection(keys, [-600, -100, 400, 900], 100), 'scenes');
});

test('滚到底部时高亮最后一段', () => {
  assert.equal(pickCurrentSection(keys, [-2100, -1600, -1100, -600], 100), 'storyboard');
});

test('几段被收起、顶边挤在一起时，取最后一个越过判定线的段', () => {
  assert.equal(pickCurrentSection(keys, [0, 40, 80, 120], 90), 'script');
});

test('中间某段还没挂载时不会把高亮跳到更后面的段', () => {
  assert.equal(pickCurrentSection(keys, [-100, undefined, -300, -400], 100), 'characters');
});

test('出片页三段同样适用', () => {
  const deliver = ['preview', 'export', 'tasks'] as const;
  assert.equal(pickCurrentSection(deliver, [-500, 200, 620], 100), 'preview');
  assert.equal(pickCurrentSection(deliver, [-900, -400, 80], 100), 'tasks');
});
