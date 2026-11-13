import React, { useEffect } from 'react';
import { useWorkbench } from '../store';
import type { Task } from '@thai-video/core/types';
import { Badge, Banner, Card, Empty, InlineBar, SectionTitle } from '../ui';

const TONE: Record<Task['status'], 'gray' | 'green' | 'orange' | 'red' | 'blue'> = {
  pending: 'gray', analyzing: 'blue', generating: 'orange', processing: 'blue',
  completed: 'green', failed: 'red', cancelled: 'gray',
};

const LABELS: Record<Task['type'], string> = {
  'project.init': '项目初始化', 'script.generate': '生成剧本',
  'storyboard.split': '自动分镜', 'shot.image': '镜头画面',
  'shot.audio.zh': '中文配音', 'shot.audio.th': '泰语配音', 'video.render': '视频合成',
};

export const TasksPage: React.FC<{ embedded?: boolean; active?: boolean }> = ({ embedded = false, active = true }) => {
  const tasks = useWorkbench((s) => s.tasks);
  const refreshTasks = useWorkbench((s) => s.refreshTasks);
  const cancelTask = useWorkbench((s) => s.cancelTask);
  const retryTask = useWorkbench((s) => s.retryTask);
  const bundle = useWorkbench((s) => s.bundle)!;

  // 只有这一段被展开时才轮询，折叠着就不打接口。
  useEffect(() => {
    if (!active) return;
    void refreshTasks();
    const timer = setInterval(() => void refreshTasks(), 4000);
    return () => clearInterval(timer);
  }, [refreshTasks, active]);

  return (
    <div>
      {embedded ? (
        <InlineBar
          hint="任务队列持久化在 SQLite：程序关闭重启后记录不丢，卡在中间态的任务会被重新接管。"
          right={<button className="btn btn-ghost py-1 text-xs" onClick={() => void refreshTasks()}>刷新</button>}
        />
      ) : (
        <SectionTitle
          title="生成任务"
          hint="任务队列持久化在 SQLite：程序关闭重启后记录不丢，卡在中间态的任务会被重新接管。"
          right={<button className="btn btn-ghost" onClick={() => void refreshTasks()}>刷新</button>}
        />
      )}
      <Banner tone="info">
        视频合成本地就能跑（无需密钥）；图像 / 配音 Provider 未配置时，单镜头重生成任务会如实记录「仅重置、未生成素材」，不产出假文件。
      </Banner>

      {tasks.length === 0 ? (
        <Empty title="还没有任务" hint="生成剧本、自动分镜或单镜头重生成后，任务会出现在这里。" />
      ) : (
        <div className="space-y-2">
          {tasks.map((task) => (
            <Card key={task.id} className="p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold">{LABELS[task.type]}</span>
                  <Badge tone={TONE[task.status]}>{task.status}</Badge>
                  <span className="text-[11px] text-stone-400">{task.id}</span>
                </div>
                <div className="flex items-center gap-2">
                  {(task.status === 'pending' || task.status === 'generating' || task.status === 'processing') && (
                    <button className="btn btn-ghost px-2 py-0.5 text-xs" onClick={() => void cancelTask(task.id)}>取消</button>
                  )}
                  {(task.status === 'failed' || task.status === 'cancelled') && (
                    <button className="btn btn-ghost px-2 py-0.5 text-xs" onClick={() => void retryTask(task.id)}>重试</button>
                  )}
                </div>
              </div>
              <div className="mt-2 h-1.5 w-full overflow-hidden rounded bg-stone-100">
                <div className="h-full bg-warm transition-all" style={{ width: `${task.progress}%` }} />
              </div>
              <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-stone-500">
                <span>进度 {task.progress}%</span>
                <span>Provider {task.provider || '—'}</span>
                <span>尝试 {task.attempts}/{task.maxAttempts}</span>
                <span>镜头 {task.shotId || '—'}</span>
                <span>成本 ¥{task.cost.toFixed(2)}</span>
                <span>{new Date(task.createdAt).toLocaleString('zh-CN')}</span>
              </div>
              {task.error && <p className="mt-2 text-xs text-red-600">失败原因：{task.error}</p>}
              {Object.keys(task.result).length > 0 && (
                <p className="mt-1 truncate text-[11px] text-stone-400" title={JSON.stringify(task.result)}>
                  结果：{JSON.stringify(task.result)}
                </p>
              )}
            </Card>
          ))}
        </div>
      )}
      <p className="mt-3 text-[11px] text-stone-400">项目：{bundle.meta.name}</p>
    </div>
  );
};
