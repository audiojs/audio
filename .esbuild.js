import { build } from 'esbuild'

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

const base = {
  entryPoints: ['audio.js'],
  bundle: true,
  format: 'esm',
  platform: 'browser',
  plugins: [lazyAtoms, ownDeck],
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

console.log('done')
