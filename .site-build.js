// The website's bundles, which git ignores: node .site-build.js makes them all, as Pages does before it deploys, the Mac
// app's server as it starts and a test before it runs (bundles()). Watched (npm run serve, which starts the server with
// --watch): the playground's output cleared first, each bundle made again as its sources change
import { build, context } from 'esbuild'
import { builtinModules } from 'node:module'
import { copyFile, readFile, rm } from 'node:fs/promises'
import { normalize } from 'node:path'
import { fileURLToPath } from 'node:url'
import audio from './audio.js'

// Node's own modules stay out of the browser bundles: the library imports them only on Node, when a path is a file
const node = builtinModules.flatMap(name => [name, `node:${name}`])

// made once, or watched: made, then made again as its sources change
const make = async (opts, watch) => { if (!watch) return build(opts); const ctx = await context(opts); await ctx.rebuild(); return ctx.watch() }

// The library for a page, the logo's functions, the codecs: each one module
const LIBRARY = {
  entryPoints: {
    audio: 'audio.js',
    // logo/logo.js: any signal through any window
    'window-function': 'node_modules/window-function/index.js',
    'periodic-function': 'node_modules/periodic-function/index.js',
    ...Object.fromEntries(['wav', 'mp3', 'flac', 'aiff', 'ogg'].map(format => [format, `node_modules/@audio/encode-${format}/${format}-encode.js`])),
  },
  outdir: 'assets',
  bundle: true,
  minify: true,
  format: 'esm',
  platform: 'browser',
  external: node,
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
}

// The editor's code pane: CodeMirror with the JavaScript language, which the page loads once it shows (script.js); and
// the parser alone, which reads the scripts from the first (code.js). The two share the parser's chunk.
const entries = {
  codemirror: `
    export { EditorState, StateField, StateEffect, Transaction } from '@codemirror/state'
    export { EditorView, keymap, lineNumbers, highlightActiveLine, drawSelection, dropCursor, showTooltip, tooltips } from '@codemirror/view'
    export { defaultKeymap, history, historyKeymap, indentWithTab, isolateHistory, undo, redo, undoDepth, redoDepth } from '@codemirror/commands'
    export { javascript, localCompletionSource, scopeCompletionSource } from '@codemirror/lang-javascript'
    export { autocompletion, completionKeymap, closeBrackets, closeBracketsKeymap } from '@codemirror/autocomplete'
    export { syntaxHighlighting, HighlightStyle, bracketMatching, indentOnInput, syntaxTree } from '@codemirror/language'
    export { setDiagnostics } from '@codemirror/lint'
    export { highlightSelectionMatches } from '@codemirror/search'
    export { tags } from '@lezer/highlight'`,
  lezer: `export { parser } from '@lezer/javascript'`
}
const PANE = {
  entryPoints: Object.keys(entries).map(name => ({ in: `entry:${name}`, out: name })),
  outdir: 'assets',
  // one chunk, the one both read: its name kept, as assets/ is committed
  chunkNames: 'lezer-[name]',
  bundle: true,
  splitting: true,
  minify: true,
  format: 'esm',
  legalComments: 'eof',
  plugins: [{
    name: 'entries',
    setup(build) {
      build.onResolve({ filter: /^entry:/ }, args => ({ path: args.path.slice(6), namespace: 'entry' }))
      build.onLoad({ filter: /.*/, namespace: 'entry' }, args => ({ contents: entries[args.path], resolveDir: '.' }))
    }
  }]
}

// What the library loads by name (audio.import): each registry plugin, and the optional packages its own ops load on
// first use, its peer dependencies (deepfilter's @audio/neural-denoise, vocals' -separate)
const { peerDependencies = {} } = JSON.parse(await readFile('package.json', 'utf8'))
const named = [...new Set([...Object.values(audio.plugins), ...Object.keys(peerDependencies)])]

// The editor's engine worker: the library with every plugin and codec as a chunk that loads on first use.
// Workers have no import maps, so no bare import is left for the browser to resolve.
const ENGINE = {
  entryPoints: { worker: 'playground/worker.js', jobs: 'playground/jobs.js' },
  outdir: 'playground/dist',
  chunkNames: 'chunks/[name]-[hash]',
  bundle: true,
  splitting: true,
  minify: true,
  // plugins register by their factory's name
  keepNames: true,
  format: 'esm',
  platform: 'browser',
  external: node,
  plugins: [{
    // one literal import per package the library loads by name, which the worker loads through audio.import
    name: 'registry',
    setup(build) {
      build.onResolve({ filter: /^editor:plugins$/ }, () => ({ path: 'plugins', namespace: 'editor' }))
      build.onLoad({ filter: /.*/, namespace: 'editor' }, () => ({
        resolveDir: '.',
        contents: `export default {${named.map(spec => `${JSON.stringify(spec)}: () => import(${JSON.stringify(spec)})`).join(',\n')}}`
      }))
    }
  }, {
    // an optional codec that is not installed stays an import that fails only if a file needs it
    name: 'optional-codecs',
    setup(build) {
      build.onResolve({ filter: /^@audio\// }, async args => {
        if (args.pluginData?.resolving) return
        const found = await build.resolve(args.path, { kind: args.kind, resolveDir: args.resolveDir, importer: args.importer, pluginData: { resolving: true } })
        return found.errors.length ? { path: args.path, external: true } : found
      })
    }
  }],
  legalComments: 'eof'
}

// The deck's worker (playground/voices.js): the library as playback needs it, which audio/worker's host takes for the
// whole library it would otherwise load (its `import('./audio.js')`, here core with the ops voices.js imports)
const VOICES = {
  entryPoints: { voices: 'playground/voices.js' },
  outdir: 'playground/dist',
  chunkNames: 'voices/[name]-[hash]',
  bundle: true,
  splitting: true,
  minify: true,
  keepNames: true,
  format: 'esm',
  platform: 'browser',
  external: node,
  plugins: [{
    name: 'lean',
    setup(build) {
      build.onResolve({ filter: /^\.\/audio\.js$/ }, args => /[\\/]worker\.js$/.test(args.importer) ? { path: fileURLToPath(new URL('./core.js', import.meta.url)) } : undefined)
      // a package not installed (an optional one) stays an import that fails only if it is asked for
      build.onResolve({ filter: /^@audio\// }, async args => {
        if (args.pluginData?.resolving) return
        const found = await build.resolve(args.path, { kind: args.kind, resolveDir: args.resolveDir, importer: args.importer, pluginData: { resolving: true } })
        return found.errors.length ? { path: args.path, external: true } : found
      })
    }
  }],
  legalComments: 'eof'
}

// What the worker's chunks fetch beside themselves: the ONNX runtime's wasm, RNNoise's weights, the music guard's
const FETCHED = [['onnxruntime-web/ort-wasm-simd-threaded.wasm', 'ort-wasm-simd-threaded.wasm'], ['onnxruntime-web/ort-wasm-simd-threaded.asyncify.wasm', 'ort-wasm-simd-threaded.asyncify.wasm'], ['@audio/neural-denoise/rnnoise.bin', 'rnnoise.bin'], ['@audio/neural-denoise/guard.bin', 'guard.bin']]

// The bundles in assets/: the library, its codecs, the logo's functions, the code pane, the pictures
async function assets(watch) {
  await make(LIBRARY, watch)
  await make(PANE, watch)
  // the editor's pictures: gl-waveform and gl-spectrogram, each one ES module with no dependencies, as published
  for (const name of ['gl-waveform', 'gl-spectrogram']) await copyFile(`node_modules/${name}/index.js`, `assets/${name}.js`)
}
// The playground's workers in playground/dist: the engine and its jobs thread, the deck's voices
async function workers(watch) {
  // only serve clears: a test's build leaves the folder, as another session's suite may be serving it
  if (watch) await rm('playground/dist', { recursive: true, force: true })
  await make(ENGINE, watch)
  await make(VOICES, watch)
  for (const [from, name] of FETCHED) try { await copyFile(fileURLToPath(import.meta.resolve(from)), `playground/dist/chunks/${name}`) } catch {}
}
/** Every bundle made from the source as it is; watched, made again as it changes */
export async function bundles(watch = false) { await assets(watch); await workers(watch) }

if (process.argv[1] && fileURLToPath(import.meta.url) === normalize(process.argv[1])) await bundles()
