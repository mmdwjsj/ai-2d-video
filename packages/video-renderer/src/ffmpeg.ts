/** FFmpeg / ffprobe 子进程封装：不用 shell，避免 Windows 路径与引号转义问题。 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';

export type CommandResult = { stdout: string; stderr: string; code: number };

export const runCommand = (
  executable: string,
  args: string[],
  opts: { timeoutMs?: number; cwd?: string } = {},
): Promise<CommandResult> => new Promise((resolve, reject) => {
  const child = spawn(executable, args, {
    cwd: opts.cwd, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stdout = '';
  let stderr = '';
  child.stdout?.on('data', (chunk: Buffer) => { stdout += chunk.toString(); });
  child.stderr?.on('data', (chunk: Buffer) => {
    // ffmpeg 把进度写到 stderr，只留尾部，避免长任务吃掉内存
    stderr = (stderr + chunk.toString()).slice(-8000);
  });
  const timeout = opts.timeoutMs ?? 180_000;
  const timer = setTimeout(() => {
    child.kill('SIGKILL');
    reject(new Error(`${executable} 执行超时（${Math.round(timeout / 1000)}s）`));
  }, timeout);
  child.on('error', (error) => { clearTimeout(timer); reject(error); });
  child.on('close', (code) => {
    clearTimeout(timer);
    if (code === 0) resolve({ stdout, stderr, code });
    else reject(new Error(`${executable} 失败（exit ${code}）：${stderr.slice(-900)}`));
  });
});

export const ffmpeg = (args: string[], opts?: { timeoutMs?: number; cwd?: string }): Promise<CommandResult> =>
  runCommand(process.env.THAI_VIDEO_FFMPEG ?? 'ffmpeg', args, opts);

export const ffprobe = (args: string[], opts?: { timeoutMs?: number }): Promise<CommandResult> =>
  runCommand(process.env.THAI_VIDEO_FFPROBE ?? 'ffprobe', args, { timeoutMs: opts?.timeoutMs ?? 30_000 });

/** 音频真实时长：时间轴只认 ffprobe 实测值。 */
export const probeDuration = async (file: string): Promise<number> => {
  if (!fs.existsSync(file)) throw new Error(`音频文件不存在：${file}`);
  const result = await ffprobe([
    '-v', 'error', '-show_entries', 'format=duration',
    '-of', 'default=noprint_wrappers=1:nokey=1', file,
  ]);
  const value = Number.parseFloat(result.stdout.trim());
  if (!Number.isFinite(value) || value <= 0) throw new Error(`无法读取音频时长：${file}`);
  return value;
};
