import { build } from 'esbuild'
import { readFileSync } from 'fs'

const { version } = JSON.parse(readFileSync('package.json', 'utf8'))

const NODE_BUILTINS = ['fs', 'fs/promises', 'url']

// Shim node:module for browser — inlines version from package.json
const versionPlugin = {
  name: 'version',
  setup(b) {
    b.onResolve({ filter: /^node:module$/ }, () => ({ path: 'version', namespace: 'virtual' }))
    b.onLoad({ filter: /.*/, namespace: 'virtual' }, () => ({
      contents: `export function createRequire() { return p => ({ version: ${JSON.stringify(version)} }) }`,
    }))
  }
}

// WASM codec packages — loaded on demand by audio-decode / encode-audio
const CODECS = [
  'mpg123-decoder', 'ogg-opus-decoder', 'qoa-format',
  '@wasm-audio-decoders/*', '@audio/decode-*', '@audio/encode-*',
  'codec-parser', '@eshaz/*', 'simple-yenc',
  'wasm-media-encoders', 'opusscript', 'libflacjs',
]

const base = {
  entryPoints: ['audio.js'],
  bundle: true,
  format: 'esm',
  platform: 'browser',
  plugins: [versionPlugin],
}

// dist/audio.js — core + dispatch, codecs load on demand via import()
await build({
  ...base,
  outfile: 'dist/audio.js',
  external: [...NODE_BUILTINS, 'audio-speaker', ...CODECS],
})

// dist/audio.min.js — same, minified
await build({
  ...base,
  outfile: 'dist/audio.min.js',
  external: [...NODE_BUILTINS, 'audio-speaker', ...CODECS],
  minify: true,
})

// dist/audio.all.js — everything bundled (for zero-config / testing)
await build({
  ...base,
  outfile: 'dist/audio.all.js',
  external: NODE_BUILTINS,
})

console.log('done')
