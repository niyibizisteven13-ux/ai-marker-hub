import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import fs from 'fs';
import { execFileSync } from 'node:child_process';
import {defineConfig} from 'vite';

/**
 * Face detection for timed tests runs in the student's browser with files served by us (no third-party host, so
 * nothing about a test leaves our server). The WebAssembly files come from the pinned package at build time; the
 * small model file is committed under public/vendor/mediapipe.
 */
function mediapipeWasm() {
  const dir = path.resolve(__dirname, 'node_modules/@mediapipe/tasks-vision/wasm');
  const files = ['vision_wasm_internal.js', 'vision_wasm_internal.wasm', 'vision_wasm_nosimd_internal.js', 'vision_wasm_nosimd_internal.wasm'];
  return {
    name: 'mediapipe-wasm',
    configureServer(server: any) {
      server.middlewares.use('/vendor/mediapipe/wasm', (req: any, res: any, next: any) => {
        const name = decodeURIComponent((req.url || '').split('?')[0]).replace(/^\//, '');
        if (!files.includes(name)) return next();
        res.setHeader('Content-Type', name.endsWith('.wasm') ? 'application/wasm' : 'text/javascript');
        fs.createReadStream(path.join(dir, name)).pipe(res);
      });
    },
    closeBundle() {
      const out = path.resolve(__dirname, 'dist/vendor/mediapipe/wasm');
      if (!fs.existsSync(dir)) return;
      fs.mkdirSync(out, { recursive: true });
      for (const f of files) fs.copyFileSync(path.join(dir, f), path.join(out, f));
    },
  };
}

export default defineConfig(() => {
  const build = (process.env.APP_BUILD || process.env.VERCEL_GIT_COMMIT_SHA || process.env.GIT_COMMIT || process.env.SOURCE_VERSION || (() => { try { return execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(); } catch { return String(Date.now()); } })()).slice(0, 12);
  return {
    define: { __BWENGE_BUILD__: JSON.stringify(build) },
    plugins: [react(), tailwindcss(), mediapipeWasm(), { name: 'bwenge-build', generateBundle() { this.emitFile({ type: 'asset', fileName: 'build.json', source: JSON.stringify({ build }) }); } }],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    build: {
      rollupOptions: {
        // scanner.html: the document scanner opened from the Telegram bot (Mini App).
        input: { main: path.resolve(__dirname, 'index.html'), scanner: path.resolve(__dirname, 'scanner.html') },
        // Libraries in their own files: they change rarely, so browsers keep them cached between releases.
        output: {
          manualChunks(id) {
            if (!id.includes('node_modules')) return undefined;
            if (/node_modules\/(react|react-dom|scheduler)\//.test(id)) return 'vendor-react';
            if (/node_modules\/(react-markdown|remark-|rehype-|micromark|mdast-|hast-|unified|unist-|vfile|katex|property-information|space-separated|comma-separated|decode-named|character-|html-url|trim-lines|devlop|bail|is-plain-obj|trough|zwitch|ccount|markdown-table|longest-streak|estree-|style-to)/.test(id)) return 'vendor-markdown';
            if (/node_modules\/(motion|framer-motion|motion-dom|motion-utils)\//.test(id)) return 'vendor-motion';
            if (/node_modules\/lucide-react\//.test(id)) return 'vendor-icons';
            return undefined;
          },
        },
      },
    },
    server: {
      host: '0.0.0.0',
      port: 3000,
      allowedHosts: true as const,
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modify—file watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true' ? true : false,
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      watch: process.env.DISABLE_HMR === 'true' ? null : { ignored: ['**/exports/**'] },
      proxy: {
        '/api': {
          target: 'http://127.0.0.1:3000',
          changeOrigin: true,
          secure: false,
          timeout: 600000, // 10 minutes
          proxyTimeout: 600000,
        },
        '/exports': {
          target: 'http://127.0.0.1:3000',
          changeOrigin: true,
          secure: false,
        },
      },
    },
  };
});
