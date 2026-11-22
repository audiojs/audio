import { build } from 'esbuild'
import { readFileSync } from 'fs'
import { gzipSync } from 'zlib'

const NODE_BUILTINS = ['fs', 'fs/promises', 'url', 'path', 'node:*']

// WASM codec packages — loaded on demand by audio-decode / encode-audio
const CODECS = [
  '@audio/decode-*', '@audio/encode-*',
]

// Atoms an op loads on demand (`import('@audio/…')`) stay out of the bundle: fetched on first use.
// The device backends (speaker, mic) are I/O, not DSP: play()/record() need them in the page.
const lazyAtoms = {
  name: 'lazy-atoms',
  setup(build) {
    build.onResolve({ filter: /^@audio\// }, args => args.kind === 'dynamic-import' && !/^@audio\/(speaker|mic)\b/.test(args.path) ? { path: args.path, external: true } : undefined)
  }
}

// deck.js stays the module it is beside dist/, the one `audio/worker` imports too: a page using both runs one deck
const ownDeck = {
  name: 'own-deck',
  setup(build) {
    build.onResolve({ filter: /(^|\/)deck\.js$/ }, () => ({ path: '../deck.js', external: true }))
  }
}

// compare's module, and deslop's, stay beside dist/, fetched on first use (audio.js imports each then): a page that
// never compares, or never deslops, never loads it
const ownLazy = {
  name: 'own-lazy',
  setup(build) {
    build.onResolve({ filter: /^\.\/fn\/(compare|deslop)\.js$/ }, args => args.kind === 'dynamic-import' ? { path: `../fn/${args.path.slice(5)}`, external: true } : undefined)
  }
}

const base = {
  entryPoints: ['audio.js'],
  bundle: true,
  format: 'esm',
  platform: 'browser',
  plugins: [lazyAtoms, ownDeck, ownLazy],
}

// dist/audio.js — core + dispatch, codecs load on demand via import()
await build({
  ...base,
  outfile: 'dist/audio.js',
  external: [...NODE_BUILTINS, ...CODECS],
})

// dist/audio.min.js — same, minified
await build({
  ...base,
  outfile: 'dist/audio.min.js',
  external: [...NODE_BUILTINS, ...CODECS],
  minify: true,
})

// The size README.md and docs/comparison.md give for the page (`144 KB gzipped`, `144 KB gz`) is dist/audio.min.js at
// gzip level 9, in KB of 1000 bytes: the build stops where one is more than 2 KB off, so a stale figure can't be published
let gz = gzipSync(readFileSync('dist/audio.min.js'), { level: 9 }).length
for (let file of ['README.md', 'docs/comparison.md'])
  for (let [, kb] of readFileSync(file, 'utf8').matchAll(/(\d+(?:\.\d+)?) KB gz/g))
    if (Math.abs(kb * 1000 - gz) > 2000) throw new Error(`${file} says ${kb} KB gzipped, dist/audio.min.js is ${(gz / 1000).toFixed(1)} KB at gzip level 9: write that in ${file}`)

console.log('done')
