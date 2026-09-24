// Refresh the audio modules used by the static website: node .site-build.js
import { build } from 'esbuild'

await build({
  entryPoints: { audio: 'audio.js', wav: 'node_modules/@audio/encode-wav/wav-encode.js', mp3: 'node_modules/@audio/encode-mp3/mp3-encode.js' },
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
