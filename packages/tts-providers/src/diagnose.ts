/**
 * TTS 失败原因分类。
 *
 * 之前所有失败都被界面写成「联网恢复后重新导出即可补回人声」，但最常见的
 * 失败其实是本机 Python 没装 edge_tts（或 PATH 里选中了另一个解释器），
 * 跟网络一点关系都没有，用户按提示等网络恢复只会一直失败。
 * 这里把「本机环境 / 网络 / 引擎参数」分开，各自给可操作的修复建议。
 */

export type TtsFailureKind = 'local-env' | 'network' | 'engine' | 'unknown';

export type TtsDiagnosis = {
  kind: TtsFailureKind;
  /** 一句话结论，写进任务结果 */
  summary: string;
  /** 可操作的修复建议，直接展示在导出页 */
  hint: string;
  /** 失败后是否值得对同一句重试（网络抖动值得，缺依赖不值得） */
  retryable: boolean;
};

/** 本项目唯一联网点的说明，界面与文档共用同一句，避免各处口径漂移。 */
export const TTS_NETWORK_NOTE =
  '配音由 edge-tts 调用微软在线语音服务合成，是本项目唯一联网点；剧本、画面、字幕、口型和 MP4 合成全在本机完成。';

export const TTS_OFFLINE_HINT =
  '不想联网配音：把 config/providers.json 的 tts.active 改成 "unconfigured"（成片为字幕 + 本地氛围音），或把 command 换成完全离线的本地语音引擎。';

/**
 * 从 `where python` / `which -a python` 的输出整理候选解释器。
 * 一台机器上常有多个 Python，装了 edge-tts 的未必是 PATH 里第一个；
 * WindowsApps 下的 python.exe 只是商店占位，执行会弹商店，必须排除。
 */
export const pythonCandidates = (lookupOutput: string, configured: string, envPython?: string): string[] => {
  const found = lookupOutput.split(/\r?\n/)
    .map((line) => line.trim().replace(/^['"]|['"]$/g, ''))
    .filter((p) => /(?:^|[\\/])python(?:\d+(?:\.\d+)?)?(?:\.exe)?$/i.test(p))
    .filter((p) => !/WindowsApps/i.test(p));
  // 泛称 python 已由 PATH 列表覆盖；绝对路径的配置则优先尝试。
  const generic = /^(?:python|python3|py)(?:\.exe)?$/i.test(configured);
  const ordered = [
    envPython?.trim(),
    generic ? undefined : configured,
    ...found,
    generic ? undefined : 'python3',
  ].filter((v): v is string => Boolean(v && v.trim()));
  return [...new Set(ordered)];
};

/** 只从完整报错判断；调用方不要再对原始 message 做 slice(0, 80) 之后再分类。 */
export const diagnoseTtsError = (message: string, command = 'python'): TtsDiagnosis => {
  const text = message.replace(/\s+/g, ' ').trim();

  const missing = /No module named\s+['"]?([\w.]+)/i.exec(text)?.[1];
  if (missing) {
    const pkg = missing.replace(/_/g, '-');
    return {
      kind: 'local-env',
      summary: `本机 Python 缺少 ${missing} 模块（与网络无关）`,
      hint: `用 ${command} -m pip install ${pkg} 装一次，或把 tts.command 改成已装好 ${pkg} 的 Python 绝对路径（也可用环境变量 THAI_VIDEO_TTS_PYTHON 指定）。${TTS_OFFLINE_HINT}`,
      retryable: false,
    };
  }

  if (/ENOENT|command not found|不是内部或外部命令|系统找不到指定的(?:路径|文件)|No such file or directory|spawn\s+\S+\s+ENOENT/i.test(text)) {
    return {
      kind: 'local-env',
      summary: `找不到配音命令 ${command}（与网络无关）`,
      hint: `把 tts.command 改成可执行文件的绝对路径，或用环境变量 THAI_VIDEO_TTS_PYTHON 指定 Python。${TTS_OFFLINE_HINT}`,
      retryable: false,
    };
  }

  if (/超时|timeout|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|ECONNREFUSED|ECONNRESET|Cannot connect|Connection|WebSocket|WSServer|ClientConnector|网络|403|502|503/i.test(text)) {
    return {
      kind: 'network',
      summary: '配音服务联网失败',
      hint: `联网恢复后重新导出即可补回人声；已成功的句子会命中 assets/audio/tts 里的本地缓存，不会重复联网。${TTS_OFFLINE_HINT}`,
      retryable: true,
    };
  }

  if (/TTS 命令失败|TTS 命令超时|没有产出音频文件|无法读取音频时长|exit \d+/i.test(text)) {
    return {
      kind: 'engine',
      summary: '配音命令执行失败（详见原始报错）',
      hint: `检查 tts.command / args 与引擎参数是否匹配，先手动跑一次 ${command} -m edge_tts --help。${TTS_OFFLINE_HINT}`,
      retryable: false,
    };
  }

  return {
    kind: 'unknown',
    summary: '配音合成失败（详见原始报错）',
    hint: `查看下方逐句报错定位原因。${TTS_OFFLINE_HINT}`,
    retryable: true,
  };
};
