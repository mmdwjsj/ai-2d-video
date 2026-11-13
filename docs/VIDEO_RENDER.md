# 视频导出与配音配置

> 面向使用者：怎么点、成片在哪、能不能配音、以后怎么换成 AI 画面。
> 面向开发者：渲染管线各文件职责与替换点。

## 1. 最短路径

1. `npm run build && npm start`，打开 `http://localhost:4173`。
2. 走完第 1～5 步（建项目 → 剧本 → 自动分镜），到**导出页面**。
3. 点「导出 XX MP4」，进度条跑到 100%（约半分钟到一分钟）。
4. 点「播放成片」验收，或在「成片文件在哪看」里播放 / 下载。

也可以在命令行跑 `npm run example -- --render`，示例脚本会额外导出一份成片并打印文件路径。

**前置条件**：Node ≥ 22.5、FFmpeg + ffprobe 在 PATH、系统装有 Edge 或 Chrome。
`GET /api/config` 的 `capabilities.renderer` 会列出缺什么；缺失时导出页会禁用按钮并说明原因，而不是悄悄失败。
浏览器路径可用 `THAI_VIDEO_BROWSER` 覆盖，FFmpeg 路径用 `THAI_VIDEO_FFMPEG` / `THAI_VIDEO_FFPROBE`。

## 2. 成片规格

| 项 | 值 |
| --- | --- |
| 分辨率 / 比例 | 1080×1920 / 9:16 |
| 帧率 / 编码 | 30fps / H.264 + AAC |
| 结构 | 片头卡 → 每个分镜一帧 → 片尾卡 |
| 镜头动效 | 缓慢推近（Ken Burns）+ 开场淡入 |
| 字幕 | 中文版只中文字幕；泰语版只泰文；双语版中文主字幕 + 泰文原文次字幕 |
| 时长 | `max(分镜时长, ffprobe 实测配音时长 + 0.4s)` 逐镜头累加，视频不早于配音结束 |

文件落在 `output/<项目ID>/<项目名>-<版本>-<时间戳>.mp4`，同目录可存多个版本，不会互相覆盖。
导出页「③ 需要别的语言版本」可额外生成另外两种版本。

### 2.1 播放与下载（为什么曾经会下到 HTML）

- **播放**：`<video src="/output/<相对路径>">`，由后端静态托管 `output/`。
- **下载**：走 `GET /api/outputs/download?path=<output 相对路径>`，后端 `res.download` 强制 `attachment`，文件名保留中文原名；路径越界或文件缺失返回 404 JSON。
- **前端兜底**：下载前用 `fetch` 校验响应类型，只要返回 HTML / 空类型 / 错误就明确报错，不会把页面内容存成「视频文件」。
- **曾经的坑**：Vite 开发页（5173）只代理了 `/api`，`/output/xxx.mp4` 会命中 Vite 的 SPA 回退，返回 `index.html`，浏览器就把这个 HTML 当成下载文件保存了。现在 `/api`、`/output`、`/assets` 都代理到 4173，且后端对 `/output` 未命中文件返回 404 文本而不是 `index.html`。
- **最省事的用法**：`npm run build && npm start`，直接开 `http://localhost:4173`（单端口）。若用 5173 开发页，必须同时在另一个终端运行 `npm run dev:server`（4173），否则页面能打开但后端请求全失败。后端端口不同可用 `THAI_VIDEO_API` 指定代理目标。

## 3. 渲染管线

| 阶段 | 实现 | 说明 |
| --- | --- | --- |
| 挑台词 / 配音 | `apps/server/src/render.ts` | 按语言类型取对白；有 TTS 就合成，否则读镜头已有 WAV |
| 时间轴 | `video-renderer/src/timeline.ts` | `computeTimeline`，只认 ffprobe 实测音频时长 |
| 画面帧 | `video-renderer/src/sceneArt.ts` | 12 套场景配色 + 剪影/灯笼/货架等元素、3 个固定人物 SVG 立绘、字幕排版 |
| 截图 | `video-renderer/src/frames.ts` | 系统 Edge/Chrome `--headless --screenshot`，精确 1080×1920 |
| 音频 | `video-renderer/src/audio.ts` | 配音归一化 48k 立体声、镜头补齐静音、氛围音、混音 |
| 合成 | `video-renderer/src/render.ts` | FFmpeg 逐镜头动效 → concat → 混音 → H.264/AAC 封装 |
| 任务 | `core/src/tasks.ts` + `handlers.ts` | `video.render` 入队即返回，worker 后台接管，进度写 SQLite |

**为什么不用 Remotion**：Remotion 渲染需要额外下载 Chrome Headless Shell（国内网络常失败），而系统自带 Edge 已经能精确输出 1080×1920，且中/泰文字由浏览器排版，泰文元音与声调不会错位。`packages/video-renderer/src/remotion/Composition.tsx.example` 仍保留作为以后接正式 Remotion 组合的参考。

## 4. 配音：默认已接通 edge-tts

| 情况 | 结果 |
| --- | --- |
| `tts.active = "command"`（当前默认） | 调用配置里的命令逐句合成，自动缓存、混入 |
| 镜头 `audioZhPath` / `audioThPath` 指向磁盘上存在的 WAV | 也可直接混入，并按实测时长撑开镜头 |
| 离线 / 命令失败 / 设回 `unconfigured` | 该句退回字幕并告警，任务结果写「未配音」，绝不伪造人声 |

本机先装一次 `python -m pip install edge-tts`（联网、无需 API 密钥）。`config/providers.json` 的 `tts` 已是完整 command 配置，角色级音色在 `config/characters.json` 的 `voices` 里。换引擎只需改 `command` / `args`，模板占位符：

- `{text}` 台词，`{voice}` 声音名，`{language}` zh/th
- `{output}` 输出文件路径，`{shotId}` 镜头 ID
- `outputExt` 写成 `mp3` 时会自动转成 48k 立体声 WAV

当前生效的配置（edge-tts）：

```json
"tts": {
  "active": "command",
  "command": "python",
  "args": ["-m", "edge_tts", "--text", "{text}", "--voice", "{voice}", "--write-media", "{output}"],
  "voices": { "zh": "zh-CN-XiaoxiaoNeural", "th": "th-TH-PremwadeeNeural" },
  "outputDir": "assets/audio/tts",
  "outputExt": "mp3",
  "timeoutMs": 60000
}
```

每个人物在「人物管理 → 中文/泰语声音配置」里可单独填 engine / voice / 语速 / 音量 / 情绪，渲染时按镜头的出场人物挑选。

## 5. 换成 AI 画面

当前画面是本地程序化插画，不是 AI 生成图。以后接图像模型时：

- 单镜头生成结果写回 `shot.generatedImagePath`（已有字段）；
- 在 `apps/server/src/render.ts` 生成帧之前，若该字段指向存在的图片，把它作为该镜头底图（替换 `sceneArt` 背景层），字幕与人物层仍由本地渲染；
- 复杂动作镜头可用 `shot.generatedVideoPath` 走 AI 视频片段，替换该镜头的动效段。

`config/providers.json` 的 `image.http` / `video` 已留好 baseUrl / apiKeyEnv / modelEnv 契约，`ai-providers/src/http.ts` 是调用骨架。

## 6. 常见问题

**导出页按钮是灰的**：看 `capabilities.renderer.reason`；多数是 FFmpeg 没进 PATH 或找不到浏览器。装好后重启服务端。

**渲染很慢 / 想切页面**：渲染是后台任务，可切页面；导出页轮询任务状态，回来继续显示进度。任务记录持久化，关程序重启也不丢。

**成片没有说话声**：先确认 `python -m edge_tts --version` 能跑通且可联网；离线或命令失败时该句会退回字幕并在任务结果里写明，不会拿假人声冒充。按第 4 节排查。

**output 里出现很多临时文件**：中间产物放在 `data/render-tmp/` 与系统临时目录，导出完成后异步清理；成片列表会跳过隐藏目录，只显示 `output/` 下的媒体文件。

**中文字体或泰文显示成方框**：Windows 自带微软雅黑与 Leelawadee UI 即可；Linux 环境需安装 Noto Sans CJK 与 Noto Sans Thai。

**任务失败**：到「生成任务」页看失败原因，点「重试」；同一项目在渲染中重复点导出会复用同一个任务，不会重复生成。
