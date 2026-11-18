import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  levelToShape, mouthTimeline, usedShapes, voiceLevels, writeFrameSequence,
} from './mouth.js';
import type { MouthShape } from './mouth.js';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'thai-video-mouth-'));
after(() => fs.rmSync(tmp, { recursive: true, force: true }));

/** 造一段 48k/16bit 单声道 WAV：前 activeSec 有正弦人声，后面静音。 */
const toneWav = (name: string, seconds: number, activeSec: number): string => {
  const rate = 48_000;
  const total = Math.floor(seconds * rate);
  const data = Buffer.alloc(total * 2);
  for (let i = 0; i < total; i += 1) {
    const t = i / rate;
    const v = t < activeSec ? Math.sin(2 * Math.PI * 220 * t) * 0.45 : 0;
    data.writeInt16LE(Math.round(v * 32767), i * 2);
  }
  const head = Buffer.alloc(44);
  head.write('RIFF', 0, 'ascii');
  head.writeUInt32LE(36 + data.length, 4);
  head.write('WAVE', 8, 'ascii');
  head.write('fmt ', 12, 'ascii');
  head.writeUInt32LE(16, 16);
  head.writeUInt16LE(1, 20);
  head.writeUInt16LE(1, 22);
  head.writeUInt32LE(rate, 24);
  head.writeUInt32LE(rate * 2, 28);
  head.writeUInt16LE(2, 32);
  head.writeUInt16LE(16, 34);
  head.write('data', 36, 'ascii');
  head.writeUInt32LE(data.length, 40);
  const file = path.join(tmp, name);
  fs.writeFileSync(file, Buffer.concat([head, data]));
  return file;
};

test('能量档位阈值与 Python 样片一致', () => {
  assert.equal(levelToShape(0), 'closed');
  assert.equal(levelToShape(0.09), 'closed');
  assert.equal(levelToShape(0.10), 'small');
  assert.equal(levelToShape(0.28), 'open');
  assert.equal(levelToShape(0.62), 'wide');
  assert.equal(levelToShape(1), 'wide');
});

test('配音能量包络：有声段高于静音段，长度等于视频帧数', () => {
  const wav = toneWav('voice.wav', 2, 1);
  const levels = voiceLevels(wav, 30, 60);
  assert.ok(levels, '能读出 PCM WAV 的能量');
  assert.equal(levels?.length, 60);
  const loud = levels!.slice(2, 25).reduce((a, b) => a + b, 0) / 23;
  const quiet = levels!.slice(35, 58).reduce((a, b) => a + b, 0) / 23;
  assert.ok(loud > 0.5, `有声段应接近 1，实际 ${loud}`);
  assert.ok(quiet < 0.05, `静音段应接近 0，实际 ${quiet}`);
});

test('有配音时嘴型跟着音量走：说话段张嘴，句尾闭嘴', () => {
  const wav = toneWav('timeline.wav', 2, 1.2);
  const timeline = mouthTimeline({ frames: 60, fps: 30, voiceWav: wav, text: '下班啦，今天想去哪儿吃？' });
  assert.equal(timeline.length, 60);
  assert.ok(timeline.slice(0, 30).includes('wide') || timeline.slice(0, 30).includes('open'));
  assert.equal(timeline.at(-1), 'closed');
  assert.ok(new Set(timeline).size >= 2, '不能整段闭嘴');
});

test('没有配音 / 配音是静音时按台词节奏开合，不退回一张静帧', () => {
  for (const voiceWav of [null, toneWav('silent.wav', 2, 0)]) {
    const timeline = mouthTimeline({ frames: 90, fps: 30, voiceWav, text: '今天下班以后我们先去夜市逛一圈' });
    assert.equal(timeline.length, 90);
    assert.ok(new Set(timeline).size >= 3, `至少要有闭/小/张/大几种嘴型：${new Set(timeline)}`);
    assert.equal(timeline.at(-1), 'closed');
  }
});

test('只截实际用到的嘴型，避免每个镜头都白截四张', () => {
  const timeline: MouthShape[] = ['closed', 'open', 'closed', 'open'];
  assert.deepEqual(usedShapes(timeline), ['closed', 'open']);
  assert.deepEqual(usedShapes(['wide']), ['wide']);
});

test('帧序列按时间轴铺开，且每帧内容与对应口型底图一致', () => {
  const dir = path.join(tmp, 'seq');
  const shapePngs = {} as Record<MouthShape, string>;
  const contents = {} as Record<MouthShape, string>;
  for (const shape of ['closed', 'small', 'open', 'wide'] as const) {
    shapePngs[shape] = path.join(tmp, `${shape}.png`);
    contents[shape] = `png-${shape}`;
    fs.writeFileSync(shapePngs[shape], contents[shape]);
  }
  const timeline: MouthShape[] = ['closed', 'open', 'wide', 'small', 'closed'];
  const pattern = writeFrameSequence({ dir, shapePngs, timeline });
  assert.ok(pattern.endsWith('f%05d.png'));
  assert.equal(fs.readdirSync(dir).length, timeline.length);
  timeline.forEach((shape, k) => {
    const frame = path.join(dir, `f${String(k + 1).padStart(5, '0')}.png`);
    assert.equal(fs.readFileSync(frame, 'utf8'), contents[shape]);
  });
});

test('缺底图时不静默产出半截视频', () => {
  assert.throws(() => writeFrameSequence({
    dir: path.join(tmp, 'empty'), shapePngs: {}, timeline: ['closed'],
  }), /口型画面缺失/);
});
