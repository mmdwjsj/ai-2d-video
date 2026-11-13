import type { ProviderConfig } from '@thai-video/core';
import { HttpTextProvider } from './http.js';
import { LocalRuleProvider } from './local.js';
import type { ImageProvider, TextProvider, VideoProvider } from './types.js';

export * from './types.js';
export { LocalRuleProvider } from './local.js';
export { HttpTextProvider } from './http.js';

const unavailable = (id: string, message: string) => ({
  id,
  available: false,
  async generate(): Promise<never> {
    throw new Error(message);
  },
});

export type Providers = {
  text: TextProvider;
  image: ImageProvider;
  video: VideoProvider;
};

/** 由 config/providers.json 决定实现；密钥只从环境变量取。 */
export const createProviders = (config: ProviderConfig): Providers => {
  const env = (name: unknown): string =>
    typeof name === 'string' && name ? (process.env[name] ?? '') : '';

  const httpText = config.text.http as
    | { baseUrlEnv?: string; apiKeyEnv?: string; modelEnv?: string }
    | undefined;
  const text: TextProvider = config.text.active === 'http'
    ? new HttpTextProvider({
        baseUrl: env(httpText?.baseUrlEnv),
        apiKey: env(httpText?.apiKeyEnv),
        model: env(httpText?.modelEnv),
      })
    : new LocalRuleProvider();

  const imageActive = config.image.active;
  const videoActive = config.video.active;
  return {
    text,
    image: imageActive === 'unconfigured'
      ? unavailable('image-unconfigured', '图像 Provider 未配置（阶段二接入）：本次只重置镜头，未生成画面')
      : unavailable('image-pending', `图像 Provider「${imageActive}」尚未实现，请按 ai-providers/types.ts 契约接入`),
    video: videoActive === 'unconfigured'
      ? unavailable('video-unconfigured', '视频 Provider 未配置（阶段二接入）：复杂动作镜头暂不可生成')
      : unavailable('video-pending', `视频 Provider「${videoActive}」尚未实现`),
  };
};
