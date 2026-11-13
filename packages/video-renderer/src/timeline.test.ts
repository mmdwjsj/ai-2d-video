import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeTimeline } from './timeline.js';

test('音频比画面长时镜头自动延长，视频不会早于配音结束', () => {
  const timeline = computeTimeline(
    [{ id: 's1', durationSec: 3, audioZhPath: 'zh.wav', audioThPath: 'th.wav' }],
    { 'zh.wav': 6 }, 'zh', { fps: 30, tailPadSec: 0.4 },
  );
  assert.equal(timeline.shots[0].durationSec, 6.4);
  assert.equal(timeline.totalSec, 6.4);
  assert.equal(timeline.totalFrames, 192);
  assert.ok(timeline.shots[0].durationSec > 6, '尾部留白必须留出来');
});

test('双语版取中泰两条音频并按时长最大值对齐', () => {
  const timeline = computeTimeline(
    [{ id: 's1', durationSec: 2, audioZhPath: 'zh.wav', audioThPath: 'th.wav' }],
    { 'zh.wav': 2, 'th.wav': 5 }, 'bilingual', { fps: 30, tailPadSec: 0.4 },
  );
  assert.equal(timeline.shots[0].audioPaths.length, 2);
  assert.equal(timeline.shots[0].audioDurationSec, 5);
  assert.equal(timeline.shots[0].durationSec, 5.4);
});

test('缺音频或未探测到时长时如实告警，并给出至少一帧', () => {
  const timeline = computeTimeline(
    [
      { id: 's1', durationSec: 3, audioZhPath: '', audioThPath: 'th.wav' },
      { id: 's2', durationSec: 3, audioZhPath: 'missing.wav', audioThPath: '' },
    ],
    {}, 'zh', { fps: 30 },
  );
  assert.ok(timeline.warnings.some((w) => w.includes('缺少')));
  assert.ok(timeline.warnings.some((w) => w.includes('未探测到时长')));
  assert.equal(timeline.shots.length, 2);
  assert.ok(timeline.totalFrames > 0);
  for (const shot of timeline.shots) {
    assert.equal(Number.isInteger(shot.durationSec * timeline.fps), true, '时长必须对齐到整帧');
  }
});
