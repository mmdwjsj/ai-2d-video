/**
 * 可替换 TTS Provider。
 *
 * 默认 unconfigured：不伪造人声，成片只有字幕 + 本地氛围音。
 * 配置 `tts.active = "command"` 后，按 `tts.command` / `tts.args` 调用任意
 * 本地或云端语音引擎（edge-tts、Azure、自建服务皆可），输出统一转 48k 立体声 WAV。
 * 参数模板支持 {text} {voice} {output} {language} {shotId}，不使用 shell，
 * 台词里的引号/泰文不会被二次解析。
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import type { ProviderConfig } from '@thai-video/core';
import type { TtsProvider, TtsRequest, TtsResult } from './types.js';

export * from './types.js';

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
  executable: string, args: string[], timeoutMs: number,
): Promise<void> => new Promise((resolve, reject) => {
  const child = spawn(executable, args, { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
  let stderr = '';
  child.stderr?.on('data', (chunk: Buffer) => { stderr = (stderr + chunk.toString()).slice(-4000); });
  const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error('TTS 命令超时')); }, timeoutMs);
  child.on('error', (error) => { clearTimeout(timer); reject(error); });
  child.on('close', (code) => {
    clearTimeout(timer);
    if (code === 0) resolve();
    else reject(new Error(`TTS 命令失败（exit ${code}）：${stderr.slice(-500)}`));
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
};

export const createTtsProvider = (config: ProviderConfig): TtsProvider => {
  const tts = config.tts as CommandConfig;
  const active = tts.active ?? 'unconfigured';
  const available = active === 'command' && Boolean(tts.command);

  return {
    id: available ? `tts-command:${tts.command}` : 'tts-unconfigured',
    available,

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
        const args = (tts.args ?? []).map(fill);
        await run(tts.command!, args, tts.timeoutMs ?? 60_000);
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
