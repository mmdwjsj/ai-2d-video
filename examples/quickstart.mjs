/**
 * 五分钟上手示例：一键造出一个「有内容」的项目，并把每一步的真实结果打印出来。
 *
 *   npm run example                    首次：完整演示一遍；之后：只读展示，不覆盖你改过的内容
 *   npm run example -- --fresh         重建一份干净的示例项目并重跑完整流程
 *   npm run example -- --render        额外导出一份真实 MP4，并打印成片路径与规格
 *
 * 服务：复用已在 4173 运行的服务；没服务时自己在 4188 起一个临时服务并在结束时精确停掉。
 * 生成的示例项目会保留在 data/ 里，打开工作台就能直接点开看。
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_BASE = 'http://127.0.0.1:4173';
const TEMP_PORT = process.env.EXAMPLE_PORT || '4188';
const PROJECT_NAME = '示例：下班后去夜市吃冬阴功';
const TOPIC = '下班后去夜市吃冬阴功';
const FRESH = process.argv.includes('--fresh');
const WITH_RENDER = process.argv.includes('--render');

let server = null;
let base = process.env.EXAMPLE_BASE || DEFAULT_BASE;
let serverLog = '';

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const hr = () => console.log('─'.repeat(66));
const step = (n, title) => { hr(); console.log(`【${n}】${title}`); };
const say = (text) => console.log(`    ${text}`);

async function request(route, { method = 'GET', body, expectError = false } = {}) {
  const response = await fetch(`${base}${route}`, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok && !expectError) {
    throw new Error(`${method} ${route} → HTTP ${response.status}：${payload.error || '未知错误'}`);
  }
  return { status: response.status, ...payload };
}

async function reachable(url) {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 800);
    const response = await fetch(`${url}/api/health`, { signal: controller.signal });
    clearTimeout(timer);
    return response.ok;
  } catch {
    return false;
  }
}

async function ensureServer() {
  if (process.env.EXAMPLE_BASE) {
    if (!(await reachable(base))) throw new Error(`连不上 ${base}，请先启动服务或去掉 EXAMPLE_BASE`);
    say(`复用外部服务：${base}`);
    return;
  }
  if (await reachable(DEFAULT_BASE)) {
    base = DEFAULT_BASE;
    say(`检测到服务已在运行，直接复用：${base}（不会停掉你的服务）`);
    return;
  }
  if (!fs.existsSync(path.join(ROOT, 'node_modules', 'tsx'))) {
    throw new Error('缺少依赖，请先在项目根目录执行 npm install');
  }
  base = `http://127.0.0.1:${TEMP_PORT}`;
  server = spawn(process.execPath, ['--import', 'tsx', 'apps/server/src/index.ts'], {
    cwd: ROOT,
    env: { ...process.env, PORT: TEMP_PORT },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  server.stdout.on('data', (chunk) => { serverLog += chunk.toString(); });
  server.stderr.on('data', (chunk) => { serverLog += chunk.toString(); });
  for (let i = 0; i < 40; i += 1) {
    if (await reachable(base)) { say(`临时服务已启动：${base}（本脚本结束会自动停掉）`); return; }
    if (server.exitCode !== null) break;
    await delay(300);
  }
  throw new Error(`服务未能在 ${base} 启动。日志：\n${serverLog.slice(-800)}`);
}

async function stopServer() {
  if (!server) return;
  const child = server;
  server = null;
  child.kill();
  await Promise.race([
    new Promise((resolve) => child.once('exit', resolve)),
    delay(3000),
  ]);
  if (child.exitCode === null) child.kill('SIGKILL');
  say(`临时服务已停止（端口 ${TEMP_PORT} 释放）`);
}

process.on('exit', () => { if (server) server.kill(); });

async function main() {
  console.log('泰国本地生活 AI 双语短视频工作台 · 五分钟示例');
  console.log(`主题：${TOPIC}`);
  await ensureServer();

  const health = await request('/api/health');
  step(1, '检查服务');
  say(`运行中：${health.product} / 基础工作台 + 本地 MP4 导出`);

  step(2, '新建项目');
  const existing = (await request('/api/projects')).projects.find((p) => p.name === PROJECT_NAME);
  let projectId;
  let readOnly = false;
  if (existing && !FRESH) {
    projectId = existing.id;
    readOnly = true;
    say(`示例项目已存在，改用只读展示，不覆盖你改过的内容：${projectId}`);
    say('（想重建并完整重跑：npm run example -- --fresh）');
  } else {
    if (existing) await request(`/api/projects/${existing.id}`, { method: 'DELETE' });
    const created = await request('/api/projects', {
      method: 'POST', body: { name: PROJECT_NAME, description: '五分钟上手示例：中泰双语剧本 + 自动分镜' },
    });
    projectId = created.project.meta.id;
    // 示例要演示中泰双栏，所以显式设为「双语」；你自己新建项目时可在项目首页选中文/泰语。
    await request(`/api/projects/${projectId}`, { method: 'PATCH', body: { languageMode: 'bilingual' } });
    say(`项目 ID：${projectId}`);
    say('语言类型：双语（中＋泰）—— 想只做中文，新建项目时选「中文」即可');
    say(`自动带入 ${created.project.characters.length} 个人物、${created.project.scenes.length} 个泰国生活场景`);
  }
  const R = (suffix) => `/api/projects/${projectId}${suffix}`;
  const { scenes, characters } = (await request(R(''))).project;
  const sceneName = (id) => scenes.find((s) => s.id === id)?.name ?? '未选场景';
  const personName = (id) => characters.find((c) => c.id === id)?.name ?? id;
  const printShots = (list) => list.forEach((shot) => {
    say(`  NO.${String(shot.order).padStart(2, '0')} ${shot.durationSec.toFixed(1)}s ｜ ${sceneName(shot.sceneId)} ｜ ${shot.characterIds.map(personName).join('+')} ｜ ${shot.dialogueZh}`);
  });

  step(3, readOnly ? '中/泰双语剧本（只读）' : '输入主题，生成中/泰双语剧本');
  let script;
  if (readOnly) {
    script = (await request(R('/script'))).script;
  } else {
    const generated = await request(R('/script/generate'), {
      method: 'POST', body: { topic: TOPIC, inputMode: 'topic', languageMode: 'bilingual' },
    });
    script = generated.script;
    say(`生成任务状态：${generated.task.status}（Provider ${generated.task.provider}）`);
  }
  say(`标题：${script.title}`);
  say(`开头吸引点：${script.hook}`);
  say(`人物分配：${script.cast.map((c) => `${c.characterId}（${c.role}）`).join('、')}`);
  say(`预计 ${script.shotCountEstimate} 个镜头 / ${script.durationEstimateSec}s`);
  say('台词对照（中文 ｜ 泰语，日常口语句式，非逐字翻译）：');
  script.lines.slice(0, 3).forEach((line, i) => say(`  ${i + 1}. ${line.textZh} ｜ ${line.textTh}`));
  say('注意：本地规则 Provider 生成的泰语是口语句式模板，正式出片前请人工校对。');

  step(4, readOnly ? '分镜（只读）' : '自动分镜');
  let shots;
  if (readOnly) {
    shots = (await request(R('/shots'))).shots;
    say(`现有 ${shots.length} 个镜头，总时长 ${shots.reduce((n, s) => n + s.durationSec, 0).toFixed(1)}s`);
  } else {
    const split = await request(R('/storyboard/split'), { method: 'POST', body: {} });
    shots = split.shots;
    say(`切成 ${shots.length} 个镜头，总时长 ${shots.reduce((n, s) => n + s.durationSec, 0).toFixed(1)}s`);
    say('本地规则按关键词匹配场景，所以初次分镜常集中在同一场景，下一步手动微调。');
  }
  printShots(shots);

  if (readOnly) {
    step(5, '编辑 / 锁定 / 重生成演示');
    say('只读模式跳过了所有写操作；打开界面照样能手动改，或用 --fresh 重跑完整演示。');
  } else {
    step(5, '单独编辑 NO.02，并替换两个镜头的场景');
    const secondId = shots[1].id;
    const edited = await request(R(`/shots/${secondId}`), {
      method: 'PATCH',
      body: { action: '端起冬阴功，笑着递给同伴', expression: '惊喜', durationSec: 4.5 },
    });
    say(`NO.02 v${shots[1].version} → v${edited.shot.version}：动作「${edited.shot.action}」，表情「${edited.shot.expression}」，时长 ${edited.shot.durationSec}s`);
    const changes = [
      { shot: shots[2], sceneId: 'scene-night-market' },
      { shot: shots[4], sceneId: 'scene-convenience-store' },
    ];
    for (const change of changes) {
      const result = await request(R(`/shots/${change.shot.id}`), {
        method: 'PATCH', body: { sceneId: change.sceneId },
      });
      say(`NO.${String(change.shot.order).padStart(2, '0')} 场景：${sceneName(change.shot.sceneId)} → ${sceneName(result.shot.sceneId)}`);
    }
    const versions = await request(R(`/shots/${secondId}/versions`));
    say(`NO.02 已有 ${versions.versions.length} 条历史版本（界面里可「恢复此版本」）`);
    const after = (await request(R('/shots'))).shots;
    say(`NO.01 仍是 v${after[0].version} / ${after[0].durationSec.toFixed(1)}s —— 单镜头编辑没影响其它镜头`);
    say('微调后的 5 个镜头：');
    printShots(after);

    step(6, '锁定保护：锁定后禁止改动');
    const lastId = shots[shots.length - 1].id;
    await request(R(`/shots/${lastId}`), { method: 'PATCH', body: { locked: true } });
    const blocked = await request(R(`/shots/${lastId}`), {
      method: 'PATCH', body: { dialogueZh: '不该写进来的改动' }, expectError: true,
    });
    say(`尝试改已锁定镜头 → HTTP ${blocked.status}：${blocked.error}`);
    await request(R(`/shots/${lastId}`), { method: 'PATCH', body: { locked: false } });
    say('随后解锁，示例项目里不留锁定镜头');

    step(7, '单镜头「重新生成画面」会发生什么');
    const regen = await request(R(`/shots/${secondId}/regenerate`), {
      method: 'POST', body: { kind: 'image' },
    });
    const notice = String(regen.task?.result?.notice ?? '已完成');
    say(`任务 ${regen.task?.type} / ${regen.task?.status}：${notice}`);
    say('图像 Provider 未配置，所以只重置、不产出假画面；整片 MP4 走本地渲染，在「导出页面」点导出即可。');
  }

  step(readOnly ? 6 : 8, '任务记录与导出');
  // 项目初始化等任务由持久化队列异步接管，等它跑完再统计，避免把「马上要执行」误读成卡住。
  let tasks;
  for (let i = 0; i < 10; i += 1) {
    tasks = await request(R('/tasks'));
    if (!tasks.tasks.some((t) => ['pending', 'analyzing', 'generating', 'processing'].includes(t.status))) break;
    await delay(300);
  }
  const counts = {};
  tasks.tasks.forEach((t) => { counts[t.status] = (counts[t.status] || 0) + 1; });
  say(`任务 ${tasks.tasks.length} 条：${Object.entries(counts).map(([k, v]) => `${k} ${v}`).join('、')}`);
  const exported = await fetch(`${base}${R('/export')}`);
  const bundle = await exported.json();
  const output = path.join(ROOT, 'examples', 'sample-project.json');
  fs.writeFileSync(output, JSON.stringify(bundle, null, 2), 'utf8');
  say(`完整项目 JSON 已保存：examples/sample-project.json（${Math.round(fs.statSync(output).size / 1024)} KB）`);

  if (WITH_RENDER) {
    step(readOnly ? 7 : 9, '额外导出一份真实 MP4（--render）');
    const started = await request(R('/render'), { method: 'POST', body: {} });
    say(`渲染任务 ${started.task.id} 已入队，后台执行中（约半分钟到一分钟）…`);
    let renderTask = started.task;
    const deadline = Date.now() + 8 * 60 * 1000;
    while (Date.now() < deadline) {
      await delay(1500);
      const state = await request(`/api/tasks/${started.task.id}`);
      renderTask = state.task;
      if (['completed', 'failed', 'cancelled'].includes(renderTask.status)) break;
    }
    if (renderTask.status !== 'completed') {
      throw new Error(`渲染未完成：${renderTask.status} ${renderTask.error || ''}`);
    }
    const r = renderTask.result;
    say(`成片：${r.name}`);
    say(`路径：output/${r.path}`);
    say(`规格：${r.width}×${r.height} · ${r.fps}fps · ${r.durationSec}s · ${Math.round(r.sizeBytes / 1024)} KB · ${r.codec}`);
    say(`配音：${r.voiceOverNote}`);
    if (r.voiceDiagnosis?.hint) say(`处理建议：${r.voiceDiagnosis.hint}`);
    if (r.ttsPreflight?.networkNote) say(`联网说明：${r.ttsPreflight.networkNote}`);
    say('界面「导出页面 → 成片文件在哪看」可直接播放 / 下载这份 MP4。');
  }

  hr();
  console.log('示例已就绪。现在打开界面照着点：');
  console.log('  1) npm run build && npm start      → 浏览器打开 http://localhost:4173');
  console.log(`  2) 项目首页 → 找到「${PROJECT_NAME}」→ 点「打开」`);
  console.log('  3) 剧本编辑：看中/泰双栏，改任意一栏，另一侧不会被自动覆盖');
  console.log('  4) 分镜编辑：点左侧镜头，改动作/人物/场景/双语台词，看版本历史、锁定与重生成');
  console.log('  5) 生成任务看记录 → 视频预览看版面 → 导出页面点「导出 MP4」并播放成片');
  console.log('  6) 想再要一份成片：npm run example -- --render');
  hr();
}

try {
  await main();
} catch (error) {
  console.error(`\n示例失败：${error instanceof Error ? error.message : String(error)}`);
  if (serverLog) console.error(`服务日志：\n${serverLog.slice(-800)}`);
  process.exitCode = 1;
} finally {
  await stopServer();
}
