// Vendors @audio/scrub, the ways of hearing a moment, from its checkout at ~/projects/@audio/scrub into
// editor/scrub-methods.js: one ES module with no imports, which the editor page and its AudioWorklet (editor/scrub.js) load
// as it is. Run: node .scrub-vendor.js
import { build } from 'esbuild'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { readFileSync, writeFileSync } from 'node:fs'

const dir = join(homedir(), 'projects/@audio/scrub'), { name, version } = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'))
const { outputFiles: [bundle] } = await build({ entryPoints: ['index.js'], absWorkingDir: dir, bundle: true, format: 'esm', platform: 'neutral', target: 'es2022', write: false })
writeFileSync(new URL('editor/scrub-methods.js', import.meta.url), `// ${name}@${version} (~/projects/@audio/scrub), bundled by .scrub-vendor.js: edit it there, not here.\n` + bundle.text)
