// Build 1 of 2: the Vue pages (side panel + options).
//
// These are ordinary web pages living inside the extension, so they get the
// normal Vite treatment — ESM, code splitting, a shared vendor chunk. The
// content script and service worker cannot be built this way (they must each be
// one self-contained file), which is why they live in vite.script.config.ts.
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { fileURLToPath, URL } from 'node:url'

const src = fileURLToPath(new URL('./src', import.meta.url))
const dist = fileURLToPath(new URL('./dist', import.meta.url))

export default defineConfig({
  root: src,
  plugins: [vue()],
  resolve: {
    alias: { '@': src },
  },
  build: {
    outDir: dist,
    // The script build writes into the same folder; whoever runs first must not
    // wipe the other's output. scripts/build.mjs clears dist/ once up front.
    emptyOutDir: false,
    target: 'chrome114',
    rollupOptions: {
      input: {
        sidepanel: `${src}/sidepanel/index.html`,
        options: `${src}/options/index.html`,
      },
      output: {
        entryFileNames: 'assets/[name].js',
        chunkFileNames: 'assets/[name]-[hash].js',
        assetFileNames: 'assets/[name][extname]',
      },
    },
  },
})
