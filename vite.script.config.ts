// Build 2 of 2: the service worker and the content script.
//
// Both must be a single self-contained file: the content script is injected as
// a classic script into a page we do not control, and the background script has
// to work as a Firefox classic script as well as a Chrome module worker. IIFE
// lib mode allows exactly one entry per pass, so scripts/build.mjs runs this
// config once per entry with FE_ENTRY set.
import { defineConfig } from 'vite'
import { fileURLToPath, URL } from 'node:url'

const src = fileURLToPath(new URL('./src', import.meta.url))
const dist = fileURLToPath(new URL('./dist', import.meta.url))

const ENTRIES = {
  background: { entry: `${src}/background/index.ts`, name: 'background' },
  content: { entry: `${src}/content/index.ts`, name: 'content' },
} as const

type EntryName = keyof typeof ENTRIES

const requested = process.env.FE_ENTRY as EntryName | undefined
if (!requested || !(requested in ENTRIES)) {
  throw new Error(`FE_ENTRY must be one of: ${Object.keys(ENTRIES).join(', ')}`)
}
const target = ENTRIES[requested]

export default defineConfig({
  resolve: {
    alias: { '@': src },
  },
  build: {
    outDir: dist,
    emptyOutDir: false,
    target: 'chrome114',
    lib: {
      entry: target.entry,
      formats: ['iife'],
      name: `freshEyes_${target.name}`,
      fileName: () => `${target.name}.js`,
    },
    rollupOptions: {
      output: {
        // A stray `extend` or global assignment would leak into the host page.
        extend: false,
      },
    },
  },
})
