import path from 'node:path';
import { fileURLToPath } from 'node:url';

// content 用绝对路径：Vite 从项目根运行，相对路径会扫不到 apps/web/src。
const here = path.dirname(fileURLToPath(import.meta.url)).replace(/\\/g, '/');

/** @type {import('tailwindcss').Config} */
export default {
  content: [`${here}/index.html`, `${here}/src/**/*.{ts,tsx}`],
  theme: {
    extend: {
      colors: {
        ink: '#20302f',
        warm: '#b4531a',
        panel: '#ffffff',
        canvas: '#f5f2ec',
      },
      boxShadow: {
        card: '0 1px 2px rgba(32,48,47,.06), 0 8px 24px rgba(32,48,47,.05)',
      },
    },
  },
  plugins: [],
};
