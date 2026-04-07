import { build } from 'esbuild'

const NODE_BUILTINS = ['fs', 'fs/promises', 'url']

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
