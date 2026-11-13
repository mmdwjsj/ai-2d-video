import path from 'node:path';
import { fileURLToPath } from 'node:url';
import tailwindcss from 'tailwindcss';
import autoprefixer from 'autoprefixer';

// Vite 从项目根运行，显式给出 Tailwind 配置路径，否则它会用默认配置
// （content 为空、自定义颜色缺失），导致构建出的 CSS 没有样式。
const here = path.dirname(fileURLToPath(import.meta.url));
export default {
  plugins: [
    tailwindcss({ config: path.join(here, 'tailwind.config.js') }),
    autoprefixer(),
  ],
};
