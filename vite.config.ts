import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import electron from 'vite-plugin-electron/simple';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [
    react(),
    electron({
      main: {
        entry: 'electron/main.ts',
        vite: {
          resolve: {
            alias: {
              '@shared': path.resolve(__dirname, 'shared'),
            },
          },
          build: {
            sourcemap: false,
            minify: 'esbuild',
            rollupOptions: {
              external: [
                'better-sqlite3',
                'playwright-core',
                'proxy-chain',
                'https-proxy-agent',
                'socks-proxy-agent',
                'socks',
                'ssh2',
                '@puppeteer/browsers',
              ],
            },
          },
        },
      },
      preload: {
        input: path.join(__dirname, 'electron/preload.ts'),
        vite: {
          resolve: {
            alias: {
              '@shared': path.resolve(__dirname, 'shared'),
            },
          },
          build: {
            sourcemap: false,
            minify: 'esbuild',
            rollupOptions: {
              output: {
                format: 'cjs',
                entryFileNames: 'preload.cjs',
              },
            },
          },
        },
      },
      renderer: {},
    }),
  ],
  build: {
    sourcemap: false,
    minify: 'esbuild',
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules/react/') || id.includes('node_modules/react-dom/')) {
            return 'vendor-react';
          }
          if (
            id.includes('node_modules/zod/') ||
            id.includes('node_modules/react-hook-form/') ||
            id.includes('node_modules/@hookform/')
          ) {
            return 'vendor-forms';
          }
          if (id.includes('node_modules/lucide-react/')) {
            return 'vendor-icons';
          }
          return undefined;
        },
      },
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
      '@shared': path.resolve(__dirname, 'shared'),
    },
  },
});
