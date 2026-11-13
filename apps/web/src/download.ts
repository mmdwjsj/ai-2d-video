/**
 * 下载一律走 /api 开头的专用接口：Vite 开发页（5173）本来就代理 /api 到后端。
 * 之前直接 <a href="/output/xxx.mp4" download>，5173 上 /output 没有代理，
 * Vite 会把它当成前端路由回退成 index.html，浏览器就把这个 HTML 存成了「下载文件」。
 *
 * 这里再校验一次响应类型：只要拿到 HTML / 空类型 / 错误 JSON，就明确报错，
 * 绝不把页面内容当成视频或备份文件保存到用户磁盘。
 */
const BACKEND_HINT =
  '请确认后端已启动：推荐 npm run build && npm start 后用 http://localhost:4173 打开；' +
  '若用 5173 开发页，必须在另一个终端同时运行 npm run dev:server（4173）。';

const saveBlob = (blob: Blob, fileName: string): void => {
  const objectUrl = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = objectUrl;
  anchor.download = fileName;
  anchor.style.display = 'none';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  // 大文件下载需要一点时间启动，延迟回收 Blob URL
  setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);
};

export const downloadFromApi = async (url: string, fileName: string): Promise<void> => {
  const response = await fetch(url);
  const contentType = (response.headers.get('content-type') ?? '').toLowerCase();
  if (!response.ok || !contentType || contentType.includes('text/html')) {
    let detail = '';
    if (contentType.includes('application/json')) {
      try {
        detail = ((await response.json()) as { error?: string }).error ?? '';
      } catch { /* 错误响应不是 JSON，忽略 */ }
    }
    throw new Error(
      detail ||
      `下载失败（HTTP ${response.status}，返回 ${contentType || '空类型'}）。${BACKEND_HINT}`,
    );
  }
  const blob = await response.blob();
  if (!blob.size) throw new Error(`下载到空文件。${BACKEND_HINT}`);
  saveBlob(blob, fileName);
};

/** 成片下载：path 是 output/ 下的相对路径，文件名保留中文原名。 */
export const downloadOutput = (relPath: string): Promise<void> =>
  downloadFromApi(
    `/api/outputs/download?path=${encodeURIComponent(relPath)}`,
    relPath.split('/').pop() ?? 'video.mp4',
  );

/** 项目 JSON 备份下载。 */
export const downloadProjectJson = (projectId: string): Promise<void> =>
  downloadFromApi(
    `/api/projects/${encodeURIComponent(projectId)}/export`,
    `${projectId}.json`,
  );
