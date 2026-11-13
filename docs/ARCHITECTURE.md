# 架构设计（V1.0）

## 1. 形态

模块化单体：一个 Node 进程（`apps/server`）同时提供 REST API 与前端静态文件，React 工作台（`apps/web`）通过 `/api` 访问。包之间靠 TypeScript 路径别名引用源码，不需要先编译子包；第一版不拆微服务、不引入消息队列。

## 2. 数据流

```text
主题 / 中文文案 / 泰语文案 / 导入剧本
        │
        ▼  TextProvider.generateScript()
   Script（zh / th 双栏、故事结构、人物分配、情绪、动作、场景建议）
        │
        ▼  TextProvider.splitShots() + core/storyboard
   Shot[]（每个镜头独立：场景、人物、动作、表情、双语台词、时长、状态、版本）
        │
        ├── ImageProvider / VideoProvider  → AI 画面素材（可选，未配置时跳过）
        ├── TtsProvider (zh / th)         → 配音 WAV（可选，未配置时只用字幕）
        └── core/tasks                    → 持久化任务队列（跨重启）
        │
        ▼  video-renderer（已实装，本地无密钥）
   sceneArt 生成 HTML/SVG 帧 → Edge 无头截图（1080×1920）
        → computeTimeline（ffprobe 实测音频撑开镜头）
        → FFmpeg 动效/拼接/混音（H.264 / AAC）
        → output/<项目ID>/ 中文 / 泰语 / 双语 MP4
```

分镜是核心数据对象，其余模块都只读写它的字段，不各自保存一份副本。

## 3. 包职责

| 包 | 职责 | 不负责 |
| --- | --- | --- |
| `core` | 领域模型、校验、持久化、分镜规则、版本、任务队列 | 不调外部 AI、不渲染 |
| `ai-providers` | 文本/图像/视频生成契约与实现选择 | 不落盘、不管任务状态 |
| `tts-providers` | 可替换命令式 TTS、配音缓存、ffprobe 时长 | 不混音、不排时间轴 |
| `animation` | 2D 动作/表情/嘴型参数契约 | 不生成图片 |
| `video-renderer` | 画面帧生成、截图、时间轴、音频、FFmpeg 合成 | 不管理项目数据 |
| `server` | HTTP、校验、编排、静态托管 | 不写业务逻辑副本 |
| `web` | 编辑与审核界面 | 不直接碰文件系统 |

## 4. 存储策略

- SQLite（`node:sqlite`）：`projects` 元数据、`assets` 素材元数据、`tasks` 任务、`shot_versions` 版本索引。任务队列持久化在表里，进程重启后 `pending/generating` 会被重新接管。
- JSON：`script.json` 与 `shots.json` 放 `data/projects/<id>/`，便于人工查看、版本比对与导入导出。写盘用「临时文件 + 原子重命名」，避免自动保存写坏一半。
- 素材本体在 `assets/`，数据库只存相对路径。参考图上传走 `/api/assets/images`，文件名带人物 ID 与槽位。

## 5. 关键不变量

1. **单镜头隔离**：任何编辑/重生成只作用于 `shotId`；批量操作遇到 `locked=true` 必须跳过。
2. **版本可恢复**：每次镜头变更先把旧值写入历史文件，再写新值；恢复历史本身也算一次变更，可再恢复。
3. **双语不静默覆盖**：中文与泰语分别存储；一侧变化只产生「待确认差异」提示，覆盖必须由用户显式操作。泰语要求日常口语，不做机械逐字翻译（阶段二由文本模型负责，本地规则实现只生成结构骨架）。
4. **人物一致性**：`identityLock.coreAppearance` 与新镜头任务里的参考图列表由 core 组装，Provider 只接收不解释；第一阶段不训练 LoRA。
5. **时长由音频决定**：`video-renderer/timeline.ts` 的 `shotDuration = max(画面最短时长, 该镜头所有语音时长 + 尾部留白)`，总时长为各镜头之和，禁止视频早于配音结束。
6. **成本与来源可追溯**：任务记录 provider、model、参数、耗时、成本；素材记录来源任务与版本。

## 6. 任务状态机

`pending → analyzing → generating → processing → completed`，任一环节异常进入 `failed` 并写失败原因。支持进度、取消（`cancelled` 终态）、失败重试（最多 `maxAttempts`）、单镜头重试。worker 轮询 SQLite，不使用内存队列，保证「关机重启不丢任务」。

## 7. Provider 可替换契约

`config/providers.json` 只写「用哪个」和环境变量名，密钥不进配置文件。

- `text.active = "local"`：确定性规则实现，主题 → 剧本骨架、句子级分镜、场景关键词匹配，无需联网。
- `text.http` 已写好兼容 `/chat/completions` 的调用骨架，把 `active` 改成 `http` 并配置环境变量即可切换，core 不用改。
- `tts.active = "command"`：任意语音命令模板，见 `docs/VIDEO_RENDER.md`；默认 `unconfigured`，不伪造人声。
- 图像/视频默认 `unconfigured`：单镜头重生成会明确报错、只重置，不生成占位假素材；整片导出仍用本地画面正常出片。

## 8. 已实装与接入点

- **已实装**：`video.render` 任务 → `apps/server/src/render.ts` → `video-renderer`（sceneArt / frames / timeline / audio / render）→ `output/<项目ID>/*.mp4`；导出页按钮、进度轮询、成片播放下载全部接通。
- **接 AI 画面**：`ai-providers/src/http.ts` 实装图像/视频 → 结果写 `shot.generatedImagePath` → 在 `render.ts` 生成帧前作为底图替换；分镜页「单独重新生成画面」按钮已有。
- **接真人配音**：`config/providers.json` 的 `tts` 改成 command 模板，或把 WAV 填进镜头音频字段，渲染时自动混入并按实测时长撑开镜头。
- **接复杂动作**：`animation` 输出动作与嘴型参数；`Composition.tsx.example` 是接正式 Remotion 组合的参考，当前本地链路不依赖它。

## 9. 第一版不做

复杂非线编、LoRA 训练、全镜头 AI 视频生成、多人协作、云端素材、自动发布、3D 人物建模。低分辨率预览与素材缓存的接口位置已留，实现排在阶段二之后。
