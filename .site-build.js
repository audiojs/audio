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
    name: 'lazy-atoms',
    setup(build) {
      // codecs and on-demand atoms (match, spectral, repair, dialog) load when used, not with the page;
      // the device backends (speaker, mic) stay bundled for play()/record()
      build.onResolve({ filter: /^@audio\// }, args => {
        if (args.kind === 'dynamic-import' && !/^@audio\/(speaker|mic)\b/.test(args.path)) return { path: args.path, external: true }
      })
    }
  }],
  legalComments: 'linked'
})
