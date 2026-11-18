/**
 * 配音失败归因回归：用户看到「No module named edge_tts」时，界面不能再说
 * 「联网恢复后重新导出即可补回人声」——那是本机缺包，等网络没用。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { diagnoseTtsError, pythonCandidates, TTS_NETWORK_NOTE } from './diagnose.js';

test('本机缺 Python 依赖判定为 local-env，模块名完整保留且不重试', () => {
  const raw = 'TTS 命令失败（exit 1）[python]：'
    + 'D:\\frontsoftware\\python\\install\\python.exe: No module named edge_tts';
  const d = diagnoseTtsError(raw, 'D:\\frontsoftware\\python\\install\\python.exe');
  assert.equal(d.kind, 'local-env');
  assert.equal(d.retryable, false, '缺依赖必失败，不该对 9 句各重试一次');
  assert.ok(d.summary.includes('edge_tts'), '完整模块名，不能截成 edg');
  assert.ok(d.hint.includes('pip install edge-tts'), '给出可操作的安装命令');
  assert.ok(d.hint.includes('THAI_VIDEO_TTS_PYTHON'), '多 Python 环境可显式指定解释器');
  assert.ok(!d.hint.includes('联网恢复后重新导出'), '不再把缺包误报成断网');
  assert.ok(d.hint.includes('unconfigured'), '同时说明如何彻底离线');
});

test('真正的联网失败才提示联网恢复且允许重试', () => {
  const d = diagnoseTtsError(
    'TTS 命令失败（exit 1）[python]：ClientConnectorError: Cannot connect to host speech.platform.bing.com:443',
    'python',
  );
  assert.equal(d.kind, 'network');
  assert.equal(d.retryable, true);
  assert.ok(d.hint.includes('联网恢复后重新导出'));
  assert.ok(d.hint.includes('本地缓存'), '说明命中缓存不会重复联网');
});

test('命令找不到、超时分别落到本机环境与网络类', () => {
  assert.equal(diagnoseTtsError('spawn python ENOENT').kind, 'local-env');
  assert.equal(diagnoseTtsError('TTS 命令超时 [python]').kind, 'network');
  assert.equal(diagnoseTtsError('TTS 命令失败（exit 2）[python]：unknown option', 'python').kind, 'engine');
});

test('多 Python 环境：排除商店占位、环境变量优先、结果去重', () => {
  const lookup = [
    'C:\\Users\\me\\.workbuddy\\binaries\\python\\versions\\3.13.12\\python.exe',
    'D:\\frontsoftware\\python\\install\\python.exe',
    'C:\\Users\\me\\AppData\\Local\\Microsoft\\WindowsApps\\python.exe',
    '',
  ].join('\r\n');
  const list = pythonCandidates(lookup, 'python', 'D:\\my\\python.exe');
  assert.equal(list[0], 'D:\\my\\python.exe', '显式指定的解释器优先');
  assert.equal(list.length, 3, '泛称 python 不重复入列、商店占位被排除');
  assert.ok(!list.some((p) => p.includes('WindowsApps')));
  assert.ok(list.some((p) => p.includes('frontsoftware')));
});

test('联网点说明只指向配音引擎，画面与合成都是本机', () => {
  assert.ok(TTS_NETWORK_NOTE.includes('唯一联网点'));
  assert.ok(TTS_NETWORK_NOTE.includes('本机完成'));
  assert.ok(TTS_NETWORK_NOTE.includes('edge-tts'));
});
