#!/usr/bin/env node
// Builds dist/ for one browser target.
//
//   node scripts/build.mjs chrome
//   node scripts/build.mjs firefox
//
// Three Vite passes (pages, background, content) plus a manifest copy. The
// browser-specific manifests differ only in how the background script and the
// side panel are declared; everything else is shared.
import { rm, mkdir, cp, readFile, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { fileURLToPath, URL } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const dist = `${root}dist`

const TARGETS = {
  chrome: 'manifest.chrome.json',
  edge: 'manifest.chrome.json',
  firefox: 'manifest.firefox.json',
}

const target = process.argv[2] ?? 'chrome'
const manifestSrc = TARGETS[target]
if (!manifestSrc) {
  console.error(`Usage: node scripts/build.mjs {${Object.keys(TARGETS).join('|')}}`)
  process.exit(1)
}

function vite(configFile, env = {}) {
  const result = spawnSync(
    process.execPath,
    [fileURLToPath(new URL('../node_modules/vite/bin/vite.js', import.meta.url)), 'build', '--config', configFile],
    { cwd: root, stdio: 'inherit', env: { ...process.env, ...env } },
  )
  if (result.status !== 0) process.exit(result.status ?? 1)
}

await rm(dist, { recursive: true, force: true })
await mkdir(dist, { recursive: true })

vite('vite.config.ts')
vite('vite.script.config.ts', { FE_ENTRY: 'background' })
vite('vite.script.config.ts', { FE_ENTRY: 'content' })

// The manifest is the one file that differs per browser, so it is copied rather
// than generated — a dev can read manifest.chrome.json and know exactly what
// the extension asks for.
const manifest = JSON.parse(await readFile(`${root}${manifestSrc}`, 'utf8'))
manifest.version = JSON.parse(await readFile(`${root}package.json`, 'utf8')).version
await writeFile(`${dist}/manifest.json`, `${JSON.stringify(manifest, null, 2)}\n`)

if (existsSync(`${root}icons`)) {
  await cp(`${root}icons`, `${dist}/icons`, { recursive: true })
}
if (existsSync(`${root}fixtures`)) {
  await cp(`${root}fixtures`, `${dist}/fixtures`, { recursive: true })
}

console.log(`\nBuilt dist/ for ${target} — load it as an unpacked extension.`)
