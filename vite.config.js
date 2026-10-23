import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * The renderer is a local shell: it talks to the main process over the preload bridge, never over
 * HTTP. So production gets a locked-down policy (`connect-src 'none'`), while the dev server keeps
 * the websocket/HMR allowances it needs. Injected at build time so the shipped HTML carries it.
 */
function csp() {
  const production = [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https:",
    "font-src 'self' data:",
    "connect-src 'none'",
    "media-src 'self' data: blob:",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
    "frame-ancestors 'none'",
  ].join('; ');
  const development = [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https:",
    "font-src 'self' data:",
    "connect-src 'self' ws: wss: http: https:",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
  ].join('; ');
  return {
    name: 'asteria-csp',
    transformIndexHtml(html, context) {
      const content = context.server ? development : production;
      return {
        html,
        tags: [{ tag: 'meta', attrs: { 'http-equiv': 'Content-Security-Policy', content }, injectTo: 'head-prepend' }],
      };
    },
  };
}

export default defineConfig({
  plugins: [react(), csp()],
  base: './',
  clearScreen: false,
  server: { port: 5173, strictPort: true },
  build: {
    outDir: 'dist/renderer',
    emptyOutDir: true,
    target: 'chrome128',
    sourcemap: false,
    reportCompressedSize: false,
  },
});
