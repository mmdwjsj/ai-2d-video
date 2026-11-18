import React, { useState } from 'react';
import { useWorkbench } from './store';
import type { Page } from './store';
import { Modal } from './ui';
import { LANGUAGE_OPTIONS, SCRIPT_RULES, SCRIPT_MISTAKES } from './language';

export type GuideStep = {
  page: Page;
  title: string;
  goal: string;
  actions: string[];
  tip?: string;
  next?: { page: Page; label: string };
};

/** 三个菜单 = 三段工序，每段顶部只显示这一步，不堆说明书。 */
export const STEPS: GuideStep[] = [
  {
    page: 'projects',
    title: '选语言类型，建一个项目',
    goal: '先定「做中文、做泰语、还是双语」，再建项目。这一步定错了，后面每一段都会跟着变。',
    actions: [
      '填项目名称，例：下班后去夜市吃冬阴功',
      '在「语言类型」里选中文 / 泰语 / 双语（中文就只出现中文剧本框，成片也只出中文版）',
      '点「新建项目」，默认带入 3 个人物和 12 个泰国场景（人数可自由增删），并直接进「制作」',
      '第一次用可以直接打开「示例：下班后去夜市吃冬阴功」照着看',
    ],
    tip: '语言类型随时能在页面顶部改；切换只改变显示与导出目标，不会删掉另一种语言已经写好的内容。',
    next: { page: 'work', label: '进制作页' },
  },
  {
    page: 'work',
    title: '一页四段：人物 → 场景 → 剧本 → 分镜',
    goal: '从上往下四段，改完自动保存；填完点顶部「提交并自动分镜」，第 4 段直接生成镜头。',
    actions: [
      '第 1 段 人物：可增删、可从资源库一键带入六视图；剧本里写的名字要和这里一致',
      '第 2 段 场景：12 个泰国场景已建好；「匹配关键词」决定台词自动落到哪个场景',
      '第 3 段 剧本：一行一句写「人物名＋表情动作＋说：台词」，会拆成 说话人 / 台词 / 情绪 / 动作 四列；情绪动作可下拉选或自己填，【场景】行不占镜头；「旁白：…」是交代当时情况和人物心情的情境说明，不是人物、不进说话人下拉；主题只挑句式和场景，本地模板离线运行、不会创作剧情',
      '第 4 段 分镜：点顶部「提交并自动分镜」后自动展开，逐镜头改场景 / 台词 / 时长',
    ],
    tip: '往下滚时当前段的标题会停在顶部、顶部段导航也会高亮它，随时知道自己在看哪一段；段头上的「收起 / 立即保存」滚到哪儿都能点。收起某一段只是把面板折起来，内容不会丢。',
    next: { page: 'deliver', label: '去出片' },
  },
  {
    page: 'deliver',
    title: '预览 → 导出 MP4 → 查任务',
    goal: '一页三段：上面看版面，中间点一次导出就能拿到真实可播放的 MP4，下面查任务记录。',
    actions: [
      '① 预览：点时间轴色块切镜头，检查 9:16 竖屏版面（这是版面，不是 MP4）',
      '② 导出：确认语言类型 → 点「导出 MP4」→ 等进度 100% → 点「播放成片」验收',
      '③ 任务：默认折叠，出问题再展开看失败原因、重试或取消',
      '要纯数据备份就点「下载项目 JSON」',
    ],
    tip: '本地渲染无需密钥：画面是程序化插画 + 字幕，未配置 TTS 时音轨是氛围音（不是人声），任务结果会如实标注。',
  },
];

const COLLAPSE_KEY = 'thai-video.guide.collapsed.v1';

const readCollapsed = (): boolean => {
  try { return window.localStorage.getItem(COLLAPSE_KEY) === '1'; } catch { return false; }
};

export const HelpModal: React.FC<{ onClose: () => void }> = ({ onClose }) => (
  <Modal title="怎么用这个工作台 · 完整流程" onClose={onClose}>
    <div className="space-y-4 text-xs leading-6 text-stone-700">
      <div>
        <p className="mb-1 font-semibold text-ink">只有 3 个菜单，从零到出片</p>
        <ol className="space-y-1">
          {STEPS.map((step, i) => (
            <li key={step.page}>
              <span className="mr-2 font-semibold text-warm">{i + 1}.</span>
              <span className="font-medium">{step.title}</span>
              <span className="text-stone-500"> — {step.goal}</span>
            </li>
          ))}
        </ol>
        <p className="mt-1 text-stone-500">侧栏可以折叠：点标题栏右边的「‹‹」，只剩三个图标；再点「››」展开。</p>
      </div>
      <div>
        <p className="mb-1 font-semibold text-ink">「制作」是一页四段，不用来回切页</p>
        <p>· 段头有「展开 / 收起」；顶部吸顶条上有四段的锚点，点一下直接滚到那一段。</p>
        <p>· 每段都自动保存，段头显示「已保存 14:32」；顶部和段头都有「立即保存」。</p>
        <p>· 填完前 3 段，点顶部「提交并自动分镜」：校验 → 保存 → 切镜头 → 自动滚到第 4 段。</p>
        <p>· 第 4 段分镜是左右两栏，窄屏时只有这一段横向滚动，整页不会横滚。</p>
      </div>
      <div>
        <p className="mb-1 font-semibold text-ink">先选语言类型（最关键的一步）</p>
        {LANGUAGE_OPTIONS.map((option) => (
          <p key={option.value}>· <span className="font-medium">{option.label}</span>：{option.desc}</p>
        ))}
        <p className="mt-1 text-stone-500">在「项目库」新建时选，或随时在页面顶部切换。它同时决定剧本框、台词、字幕、配音语种和成片版本。</p>
      </div>
      <div>
        <p className="mb-1 font-semibold text-ink">剧本规范（写错格式，自动分镜会切不准）</p>
        {SCRIPT_RULES.slice(0, 5).map((rule) => (
          <p key={rule.title}>· <span className="font-medium">{rule.title}</span>：{rule.detail}</p>
        ))}
        <p className="mt-1 text-stone-500">常见错误：{SCRIPT_MISTAKES.slice(0, 3).join('、')}。</p>
      </div>
      <div>
        <p className="mb-1 font-semibold text-ink">成品视频在哪看</p>
        <p>· 「出片」页点「导出 MP4」→ 等进度 100% → 点「播放成片」即可验收。</p>
        <p>· 文件实际落在项目根目录的 <code className="rounded bg-stone-100 px-1">output/&lt;项目ID&gt;/</code>，出片页会显示绝对路径并可下载。</p>
        <p>· 「出片」页最上面的预览只是版面，不是 MP4；未导出过成片时 output 为空是正常的。</p>
        <p>· 成片规格：1080×1920 / 30fps / H.264 + AAC，时长按配音实测值撑开，不会早于配音结束。</p>
      </div>
    </div>
  </Modal>
);

export const StepGuide: React.FC<{ page: Page }> = ({ page }) => {
  const setPage = useWorkbench((s) => s.setPage);
  const setWorkSection = useWorkbench((s) => s.setWorkSection);
  const [collapsed, setCollapsed] = useState(readCollapsed);
  const [helpOpen, setHelpOpen] = useState(false);
  const index = STEPS.findIndex((s) => s.page === page);
  const step = STEPS[index];
  if (!step) return null;

  const toggle = (): void => {
    const next = !collapsed;
    setCollapsed(next);
    try { window.localStorage.setItem(COLLAPSE_KEY, next ? '1' : '0'); } catch { /* 无痕模式忽略 */ }
  };

  const goNext = (): void => {
    if (!step.next) return;
    if (step.next.page === 'work') setWorkSection('characters');
    setPage(step.next.page);
  };

  return (
    <>
      <section className="mb-4 rounded-xl border border-amber-200 bg-amber-50/70 px-4 py-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <span className="rounded-md bg-warm px-2 py-0.5 text-[11px] font-semibold text-white">
              第 {index + 1} / {STEPS.length} 步
            </span>
            <span className="text-sm font-semibold text-ink">{step.title}</span>
          </div>
          <div className="flex items-center gap-2 text-[11px]">
            <button className="text-stone-500 underline" onClick={() => setHelpOpen(true)}>完整帮助</button>
            <button className="text-stone-500 underline" onClick={toggle}>{collapsed ? '展开步骤' : '收起'}</button>
          </div>
        </div>

        <div className="mt-2 flex items-center gap-1" aria-label="步骤进度">
          {STEPS.map((s, i) => (
            <span key={s.page} title={`${i + 1}. ${s.title}`}
              className={`h-1.5 flex-1 rounded-full ${i <= index ? 'bg-warm' : 'bg-amber-200'}`} />
          ))}
        </div>

        {!collapsed && (
          <>
            <p className="mt-2 text-xs text-stone-700">{step.goal}</p>
            <ol className="mt-2 space-y-1">
              {step.actions.map((action, i) => (
                <li key={i} className="flex gap-2 text-xs leading-5 text-stone-700">
                  <span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-white text-[10px] font-semibold text-warm">{i + 1}</span>
                  <span>{action}</span>
                </li>
              ))}
            </ol>
            <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
              <p className="max-w-xl text-[11px] leading-5 text-stone-500">
                {step.tip ? `提示：${step.tip}` : '这一页的改动会自动保存。'}
              </p>
              {step.next && (
                <button className="btn btn-primary py-1 text-xs" onClick={goNext}>
                  下一步：{step.next.label} →
                </button>
              )}
            </div>
          </>
        )}
      </section>
      {helpOpen && <HelpModal onClose={() => setHelpOpen(false)} />}
    </>
  );
};
