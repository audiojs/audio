// Refresh the audio modules used by the static website: node .site-build.js
import { build } from 'esbuild'

await build({
  entryPoints: {
    audio: 'audio.js',
    // logo.js: any signal through any window
    'window-function': 'node_modules/window-function/index.js',
    'periodic-function': 'node_modules/periodic-function/index.js',
    ...Object.fromEntries(['wav', 'mp3', 'flac', 'aiff', 'ogg'].map(format => [format, `node_modules/@audio/encode-${format}/${format}-encode.js`]))
  },
  outdir: 'assets',
  bundle: true,
  minify: true,
  format: 'esm',
  platform: 'browser',
  external: ['fs', 'fs/promises', 'url'],
  plugins: [{
    name: 'lazy-codecs',
    setup(build) {
      build.onResolve({ filter: /^@audio\/(decode|encode)-/ }, args => {
        if (args.kind === 'dynamic-import') return { path: args.path, external: true }
      })
    }
  }],
  legalComments: 'linked'
})
