import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

/** 前端直连同源 /batch /pipeline …，开发时需全部反代到 Runner（与 nginx 一致） */
const runnerTarget = 'http://127.0.0.1:8787';
const runnerUpstream = {
  target: runnerTarget,
  changeOrigin: true,
} as const;

const devProxy = {
  '/api': {
    target: runnerTarget,
    changeOrigin: true,
    rewrite: (path: string) => path.replace(/^\/api/, ''),
  },
  '/batch': runnerUpstream,
  '/pipeline': runnerUpstream,
  '/ports': runnerUpstream,
  '/ip': runnerUpstream,
  '/reports': runnerUpstream,
  '/system': runnerUpstream,
  '/self-check': runnerUpstream,
  '/search': runnerUpstream,
  '/number-library': runnerUpstream,
  '/admin': runnerUpstream,
  '/engine': runnerUpstream,
} as Record<string, object>;

export default defineConfig({
  base: './',
  plugins: [react()],
  server: {
    proxy: { ...devProxy },
  },
  preview: {
    proxy: { ...devProxy },
  },
});
