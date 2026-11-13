/**
 * HTML → PNG：调用系统自带的 Edge / Chrome 无头截图。
 *
 * 为什么不用 Remotion / Puppeteer / sharp：
 * - 这三者都要额外下载 Chrome Headless Shell 或原生二进制，Windows 内网容易失败；
 * - 本机 Edge 已经能精确输出 1080×1920，且中/泰文字排版由浏览器负责，天然正确；
 * - 每个镜头一个独立 user-data-dir，不会和用户正在开的浏览器抢进程。
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { FRAME_HEIGHT, FRAME_WIDTH } from './sceneArt.js';

const WINDOWS_CANDIDATES = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  `${process.env.LOCALAPPDATA ?? ''}\\Google\\Chrome\\Application\\chrome.exe`,
];

/** 可用浏览器：环境变量优先，其次按常见安装路径找。 */
export const findBrowser = (): string | null => {
  const fromEnv = process.env.THAI_VIDEO_BROWSER;
  if (fromEnv && fs.existsSync(fromEnv)) return fromEnv;
  for (const candidate of WINDOWS_CANDIDATES) {
    if (candidate && fs.existsSync(candidate)) return candidate;
  }
  if (process.platform !== 'win32') {
    for (const candidate of ['/usr/bin/chromium', '/usr/bin/google-chrome', '/usr/bin/microsoft-edge']) {
      if (fs.existsSync(candidate)) return candidate;
    }
  }
  return null;
};

const run = (executable: string, args: string[], timeoutMs: number): Promise<void> =>
  new Promise((resolve, reject) => {
    const child = spawn(executable, args, { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    child.stderr?.on('data', (chunk: Buffer) => { stderr += chunk.toString(); });
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error(`浏览器截图超时（${timeoutMs / 1000}s）：${stderr.slice(-300)}`));
    }, timeoutMs);
    child.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(new Error(`浏览器截图失败（exit ${code}）：${stderr.slice(-300)}`));
    });
  });

/** 读 PNG 头，确认分辨率精确等于目标尺寸（不依赖 ffprobe）。 */
export const pngSize = (file: string): { width: number; height: number } | null => {
  const fd = fs.openSync(file, 'r');
  try {
    const buf = Buffer.alloc(24);
    fs.readSync(fd, buf, 0, 24, 0);
    if (buf.subarray(1, 4).toString('ascii') !== 'PNG') return null;
    return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
  } finally {
    fs.closeSync(fd);
  }
};

export type CaptureOptions = {
  browser?: string;
  timeoutMs?: number;
  /** 每个镜头用独立 profile 目录，避免复用已有浏览器进程 */
  profileDir: string;
};

/** 把一帧 HTML 写成 PNG；返回实际分辨率。 */
export const captureFrame = async (html: string, htmlPath: string, pngPath: string, opts: CaptureOptions): Promise<{ width: number; height: number }> => {
  const browser = opts.browser ?? findBrowser();
  if (!browser) {
    throw new Error('未找到 Edge/Chrome：请安装 Microsoft Edge，或设置环境变量 THAI_VIDEO_BROWSER 指向浏览器 exe');
  }
  fs.mkdirSync(path.dirname(htmlPath), { recursive: true });
  fs.mkdirSync(path.dirname(pngPath), { recursive: true });
  fs.mkdirSync(opts.profileDir, { recursive: true });
  fs.writeFileSync(htmlPath, html, 'utf8');
  const url = pathToFileURL(path.resolve(htmlPath)).href;
  await run(browser, [
    '--headless=new', '--disable-gpu', '--no-sandbox', '--no-first-run',
    '--disable-extensions', '--hide-scrollbars', '--force-device-scale-factor=1',
    `--window-size=${FRAME_WIDTH},${FRAME_HEIGHT}`,
    `--user-data-dir=${path.resolve(opts.profileDir)}`,
    `--screenshot=${path.resolve(pngPath)}`,
    url,
  ], opts.timeoutMs ?? 45_000);
  if (!fs.existsSync(pngPath)) throw new Error('浏览器未产出 PNG，请检查 Edge 是否可用');
  const size = pngSize(pngPath);
  if (!size) throw new Error('浏览器产出的 PNG 无法解析');
  return size;
};

export const FRAME_SIZE = { width: FRAME_WIDTH, height: FRAME_HEIGHT };
