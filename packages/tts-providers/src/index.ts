/**
 * 可替换 TTS Provider。
 *
 * 默认 unconfigured：不伪造人声，成片只有字幕 + 本地氛围音。
 * 配置 `tts.active = "command"` 后，按 `tts.command` / `tts.args` 调用任意
 * 本地或云端语音引擎（edge-tts、Azure、自建服务皆可），输出统一转 48k 立体声 WAV。
 * 参数模板支持 {text} {voice} {output} {language} {shotId}，不使用 shell，
 * 台词里的引号/泰文不会被二次解析。
 *
 * 导出前可先 preflight() 做本机自检：多台 Python 共存时自动挑装了引擎模块的
 * 那个，缺包则在第一句之前就明确报错，不再把 9 句 × 2 次重试浪费在必失败上。
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import type { ProviderConfig } from '@thai-video/core';
import type { TtsProvider, TtsRequest, TtsResult, TtsPreflight } from './types.js';
import { diagnoseTtsError, pythonCandidates, TTS_NETWORK_NOTE } from './diagnose.js';

export * from './types.js';
export * from './diagnose.js';

/** 缓存键：文本 + 声音参数 + 镜头，任一变化都重新生成。 */
export const audioCacheKey = (request: TtsRequest): string =>
  createHash('sha1')
    .update(JSON.stringify({
      text: request.text, language: request.language, engine: request.engine,
      voice: request.voice, speed: request.speed, volume: request.volume,
      emotion: request.emotion, shotId: request.shotId ?? '',
    }))
    .digest('hex')
    .slice(0, 16);

/** 阶段四混音前统一到同一规格，避免采样率/声道不一致导致音画不同步。 */
export const normalizedAudioSpec = (config: { audioSampleRate: number; audioChannels: number }) => ({
  sampleRate: config.audioSampleRate,
  channels: config.audioChannels,
  codec: 'pcm_s16le',
});

const run = (
  executable: string, args: string[], timeoutMs: number, label = executable,
): Promise<void> => new Promise((resolve, reject) => {
  const child = spawn(executable, args, { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
  let stderr = '';
  child.stderr?.on('data', (chunk: Buffer) => { stderr = (stderr + chunk.toString()).slice(-4000); });
  const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error(`TTS 命令超时 [${label}]`)); }, timeoutMs);
  child.on('error', (error) => { clearTimeout(timer); reject(error); });
  child.on('close', (code) => {
    clearTimeout(timer);
    if (code === 0) resolve();
    else reject(new Error(`TTS 命令失败（exit ${code}）[${label}]：${stderr.slice(-500)}`));
  });
});

const probe = (file: string): Promise<number> => new Promise((resolve, reject) => {
  const child = spawn(process.env.THAI_VIDEO_FFPROBE ?? 'ffprobe', [
    '-v', 'error', '-show_entries', 'format=duration',
    '-of', 'default=noprint_wrappers=1:nokey=1', file,
  ], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '';
  child.stdout?.on('data', (chunk: Buffer) => { out += chunk.toString(); });
  child.on('error', reject);
  child.on('close', (code) => {
    const value = Number.parseFloat(out.trim());
    if (code !== 0 || !Number.isFinite(value) || value <= 0) reject(new Error(`无法读取音频时长：${file}`));
    else resolve(value);
  });
});

const convertToWav = (source: string, target: string): Promise<void> =>
  run(process.env.THAI_VIDEO_FFMPEG ?? 'ffmpeg', [
    '-y', '-i', source,
    '-ar', '48000', '-ac', '2', '-c:a', 'pcm_s16le', target,
  ], 60_000);

type CommandConfig = {
  active: string;
  command?: string;
  args?: string[];
  voices?: { zh?: string; th?: string };
  outputDir?: string;
  timeoutMs?: number;
  outputExt?: string;
  /** 引擎是否走公网；不写时按 args 里是否出现 edge_tts 推断 */
  requiresNetwork?: boolean;
  networkNote?: string;
};

type CommandSpec = { executable: string; prefixArgs: string[]; label: string };
type ResolvedCommand = { cmd: CommandSpec; ok: boolean; reason: string };

/** 收集命令输出；自检本身不允许卡住导出，超时就返回已拿到的部分。 */
const collectOutput = (executable: string, args: string[], timeoutMs = 3000): Promise<string> =>
  new Promise((resolve) => {
    const child = spawn(executable, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    const timer = setTimeout(() => { child.kill('SIGKILL'); }, timeoutMs);
    child.stdout?.on('data', (chunk: Buffer) => { out += chunk.toString(); });
    child.stderr?.on('data', (chunk: Buffer) => { out += chunk.toString(); });
    const finish = (): void => { clearTimeout(timer); resolve(out); };
    child.on('error', finish);
    child.on('close', finish);
  });

/** 列出本机 PATH 上的 Python；装了 edge-tts 的常常不是 PATH 里第一个。 */
const pythonCommands = async (configured: string): Promise<CommandSpec[]> => {
  const lookup = process.platform === 'win32'
    ? await collectOutput('where.exe', ['python'])
    : await collectOutput('sh', ['-c', 'command -v python; command -v python3']);
  const list = pythonCandidates(lookup, configured, process.env.THAI_VIDEO_TTS_PYTHON);
  const cmds: CommandSpec[] = list.map((p) => ({ executable: p, prefixArgs: [], label: p }));
  if (process.platform === 'win32') cmds.push({ executable: 'py', prefixArgs: ['-3'], label: 'py -3' });
  return cmds;
};

/** 探测某个解释器能否 import 引擎模块：纯本机检查，不联网。 */
const canImport = (cmd: CommandSpec, module: string): Promise<{ ok: boolean; stderr: string }> =>
  new Promise((resolve) => {
    const child = spawn(cmd.executable, [...cmd.prefixArgs, '-c', `import ${module}`],
      { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    const timer = setTimeout(() => { child.kill('SIGKILL'); }, 8000);
    child.stderr?.on('data', (chunk: Buffer) => { stderr = (stderr + chunk.toString()).slice(-2000); });
    child.on('error', (error) => { clearTimeout(timer); resolve({ ok: false, stderr: error.message }); });
    child.on('close', (code) => { clearTimeout(timer); resolve({ ok: code === 0, stderr }); });
  });

export const createTtsProvider = (config: ProviderConfig): TtsProvider => {
  const tts = config.tts as CommandConfig;
  const active = tts.active ?? 'unconfigured';
  const available = active === 'command' && Boolean(tts.command);
  const configured = tts.command ?? '';
  const argsTemplate = tts.args ?? [];
  const moduleFlag = argsTemplate.indexOf('-m');
  const moduleRaw = moduleFlag >= 0 ? argsTemplate[moduleFlag + 1] : '';
  const moduleName = /^[\w.]+$/.test(moduleRaw ?? '') ? moduleRaw! : 'edge_tts';
  const requiresNetwork = tts.requiresNetwork ?? /edge_tts|edge-tts/.test(argsTemplate.join(' '));
  const networkNote = tts.networkNote ?? (requiresNetwork
    ? TTS_NETWORK_NOTE
    : '当前配音引擎在本机运行，不需要联网。');

  // 只对 Python 类命令做解释器探测；换成任意其它 CLI 时保持原有行为。
  const pythonLike = /python|^py$|py\.exe/i.test(configured);
  let resolving: Promise<ResolvedCommand> | null = null;
  const resolveCommand = async (): Promise<ResolvedCommand> => {
    if (!pythonLike) {
      return {
        cmd: { executable: configured, prefixArgs: [], label: configured }, ok: true, reason: '',
      };
    }
    resolving ??= (async () => {
      const candidates = await pythonCommands(configured);
      const failures: string[] = [];
      for (const cmd of candidates) {
        const result = await canImport(cmd, moduleName);
        if (result.ok) return { cmd, ok: true, reason: '' };
        if (result.stderr.trim()) failures.push(`[${cmd.label}] ${result.stderr.trim().slice(-300)}`);
      }
      const fallback = candidates[0] ?? { executable: configured, prefixArgs: [], label: configured };
      return {
        cmd: fallback, ok: false,
        reason: failures.join(' | ') || `没有找到能 import ${moduleName} 的 Python 解释器`,
      };
    })();
    const result = await resolving;
    // 失败不缓存：用户装完包或改完配置后，重新导出就该重新探测，不必重启服务。
    if (!result.ok) resolving = null;
    return result;
  };

  return {
    id: available ? `tts-command:${tts.command}` : 'tts-unconfigured',
    available,

    async preflight(): Promise<TtsPreflight> {
      if (!available) {
        return {
          ok: false, command: configured, requiresNetwork, networkNote,
          reason: 'TTS Provider 未配置（tts.active 不是 command）',
          diagnosis: diagnoseTtsError('TTS Provider 未配置', configured),
        };
      }
      const resolved = await resolveCommand();
      // 自检只跑本机 import，不联网；它的任何失败都不是「断网」，不该重试。
      const diagnosis = resolved.ok
        ? undefined
        : { ...diagnoseTtsError(resolved.reason, resolved.cmd.label), retryable: false };
      return {
        ok: resolved.ok,
        command: resolved.cmd.label,
        requiresNetwork,
        networkNote,
        reason: resolved.reason,
        diagnosis,
      };
    },

    async synthesize(request: TtsRequest): Promise<TtsResult> {
      if (!available) {
        throw new Error('TTS Provider 未配置：成片将使用字幕 + 本地氛围音，不会生成假人声。配置 config/providers.json 的 tts.command 即可接入任意语音引擎');
      }
      const text = request.text.trim();
      if (!text) throw new Error('台词为空，无法合成配音');
      const key = audioCacheKey(request);
      const dir = path.resolve(tts.outputDir ?? 'assets/audio/tts');
      fs.mkdirSync(dir, { recursive: true });
      const ext = tts.outputExt ?? 'wav';
      const raw = path.join(dir, `tts-${key}.${ext}`);
      const wavPath = path.join(dir, `tts-${key}.wav`);
      if (!fs.existsSync(wavPath)) {
        const voice = request.voice || tts.voices?.[request.language] || '';
        const fill = (value: string): string => value
          .replace(/\{text\}/g, text)
          .replace(/\{voice\}/g, voice)
          .replace(/\{output\}/g, raw)
          .replace(/\{language\}/g, request.language)
          .replace(/\{shotId\}/g, request.shotId ?? '');
        const resolved = await resolveCommand();
        // 缺依赖是必失败，别再对每句台词重复发起同样的命令。
        if (!resolved.ok) throw new Error(`配音环境未就绪：${resolved.reason}`);
        const args = [...resolved.cmd.prefixArgs, ...argsTemplate.map(fill)];
        await run(resolved.cmd.executable, args, tts.timeoutMs ?? 60_000, resolved.cmd.label);
        if (!fs.existsSync(raw)) throw new Error('TTS 命令执行完但没有产出音频文件');
        if (path.resolve(raw) !== path.resolve(wavPath)) {
          await convertToWav(raw, wavPath);
          try { fs.unlinkSync(raw); } catch { /* 保留也不影响 */ }
        }
      }
      return {
        wavPath,
        durationSec: await probe(wavPath),
        sampleRate: 48000,
        channels: 2,
        provider: this.id,
        model: request.voice || tts.voices?.[request.language] || 'default',
        cost: 0,
        cacheKey: key,
      };
    },

    probeDuration: probe,
  };
};
