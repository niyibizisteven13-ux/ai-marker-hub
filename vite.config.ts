import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig} from 'vite';

export default defineConfig(() => {
  return {
    plugins: [react(), tailwindcss()],
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
