// Refresh the audio modules used by the static website: node .site-build.js
import { build } from 'esbuild'
import { builtinModules } from 'node:module'
import { copyFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import audio from './audio.js'

// Node's own modules stay out of the browser bundles: the library imports them only on Node, when a path is a file
const node = builtinModules.flatMap(name => [name, `node:${name}`])
// atoms by their names, each to its module as Node finds it, one not installed (an optional one) left out
const atoms = names => Object.fromEntries(names.flatMap(name => { try { return [[name.split('/')[1], fileURLToPath(import.meta.resolve(name))]] } catch { return [] } }))

await build({
  entryPoints: {
    audio: 'audio.js',
    // logo/logo.js: any signal through any window
    'window-function': 'node_modules/window-function/index.js',
    'periodic-function': 'node_modules/periodic-function/index.js',
    ...Object.fromEntries(['wav', 'mp3', 'flac', 'aiff', 'ogg'].map(format => [format, `node_modules/@audio/encode-${format}/${format}-encode.js`])),
    // what the editor page's library loads on demand, by editor.html's import map: a voice's pitch, its formants, heard as
    // they are dragged
    ...atoms(['@audio/tune-curve', '@audio/stft'])
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
})

// The editor's code pane: CodeMirror with the JavaScript language, one module.
await build({
  stdin: {
    contents: `
      export { EditorState, StateField, StateEffect, Transaction } from '@codemirror/state'
      export { EditorView, keymap, lineNumbers, highlightActiveLine, drawSelection, dropCursor, showTooltip, tooltips } from '@codemirror/view'
      export { defaultKeymap, history, historyKeymap, indentWithTab, undo, redo, undoDepth, redoDepth } from '@codemirror/commands'
      export { javascript, localCompletionSource, scopeCompletionSource } from '@codemirror/lang-javascript'
      export { autocompletion, completionKeymap, closeBrackets, closeBracketsKeymap } from '@codemirror/autocomplete'
      export { syntaxHighlighting, HighlightStyle, bracketMatching, indentOnInput, syntaxTree } from '@codemirror/language'
      export { setDiagnostics } from '@codemirror/lint'
      export { highlightSelectionMatches } from '@codemirror/search'
      export { tags } from '@lezer/highlight'
      export { parser } from '@lezer/javascript'`,
    resolveDir: '.',
    sourcefile: 'codemirror.js'
  },
  outfile: 'assets/codemirror.js',
  bundle: true,
  minify: true,
  format: 'esm',
  legalComments: 'eof'
})

// The editor's engine worker: the library with every plugin and codec as a chunk that loads on first use.
// Workers have no import maps, so no bare import is left for the browser to resolve.
await build({
  entryPoints: { worker: 'editor/worker.js' },
  outdir: 'editor/dist',
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
    // one literal import per registry plugin, which the worker loads through audio.import
    name: 'registry',
    setup(build) {
      build.onResolve({ filter: /^editor:plugins$/ }, () => ({ path: 'plugins', namespace: 'editor' }))
      build.onLoad({ filter: /.*/, namespace: 'editor' }, () => ({
        resolveDir: '.',
        contents: `export default {${[...new Set(Object.values(audio.plugins))].map(spec => `${JSON.stringify(spec)}: () => import(${JSON.stringify(spec)})`).join(',\n')}}`
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
})

// The editor's pictures: gl-waveform and gl-spectrogram, each one ES module with no dependencies, as published
for (const name of ['gl-waveform', 'gl-spectrogram']) await copyFile(`node_modules/${name}/index.js`, `assets/${name}.js`)
