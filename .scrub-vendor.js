// Vendors @audio/scrub's vocoder + noise, the way a held caret sounds, from its checkout at ~/projects/@audio/scrub into
// playground/scrub-voice.js: one ES module with no imports, which the playground's AudioWorklet (playground/scrub.js)
// loads as it is. The others are the lab's (audiojs.github.io/lab/scrub). Run: node .scrub-vendor.js
import { build } from 'esbuild'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { readFileSync, writeFileSync } from 'node:fs'

const dir = join(homedir(), 'projects/@audio/scrub'), { name, version } = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'))
const { outputFiles: [bundle] } = await build({ stdin: { contents: `export { Voice } from './voice.js'`, resolveDir: dir }, bundle: true, format: 'esm', platform: 'neutral', target: 'es2022', write: false })
writeFileSync(new URL('playground/scrub-voice.js', import.meta.url), `// ${name}@${version} (~/projects/@audio/scrub), bundled by .scrub-vendor.js: edit it there, not here.\n` + bundle.text)
