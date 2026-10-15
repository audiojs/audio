/**
 * package.json — every runtime import of a shipped file must be a dependency.
 * Guards the class of bug where a package works in the dev tree (devDeps/symlinks
 * resolve) but breaks on registry install: @audio/decode was in devDependencies
 * while core.js imports it at module scope (2.6.0).
 */
import test, { is, ok } from 'tst'
import { readFileSync, readdirSync } from 'fs'
import { isBuiltin } from 'module'

let pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
let pkgName = spec => spec.split('/').slice(0, spec.startsWith('@') ? 2 : 1).join('/')
// a dependency always installs; an optional or peer one may be missing, so only a lazy import() may reach it
let deps = new Set(Object.keys(pkg.dependencies))
let declared = new Set(Object.keys({ ...pkg.dependencies, ...pkg.optionalDependencies, ...pkg.peerDependencies }))

test('fix package.json — shipped runtime imports are declared dependencies', () => {
  let shipped = pkg.files.filter(f => f.endsWith('.js'))
  // source folders ('fn/', 'bin/'); dist/ is built from them
  for (let d of pkg.files) if (d.endsWith('/') && d !== 'dist/')
    shipped.push(...readdirSync(new URL('../' + d, import.meta.url)).filter(x => x.endsWith('.js')).map(x => d + x))

  let missing = []
  for (let f of shipped) {
    let src
    // comments drop out: a usage example there is the reader's import, not this file's
    try { src = readFileSync(new URL('../' + f, import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\/|(^|[^:])\/\/.*$/gm, '$1') } catch { continue }
    for (let m of src.matchAll(/(from\s+|import\()\s*['"]([^'".][^'"]*)['"]/g)) {
      let [, how, spec] = m, name = pkgName(spec)
      if (isBuiltin(spec) || name === pkg.name) continue // self-reference (worker self-host)
      if (!(how.startsWith('from') ? deps : declared).has(name)) missing.push(`${name} (imported by ${f})`)
    }
  }
  is(missing, [], 'undeclared runtime deps')
})

test('fix package.json — every registry plugin is a declared dependency', async () => {
  let { default: audio } = await import('../audio.js')
  let specs = Object.values(audio.plugins)
  is(specs.map(pkgName).filter(n => !declared.has(n)), [], 'registry packages not declared')
  // and each loads by its spec, a subpath its package exports
  is(specs.filter(s => { try { import.meta.resolve(s) } catch { return true } }), [], 'registry specs that resolve to nothing')
})

// npm i audio --omit=optional: the core loads and runs; an op of a package left out says which to install
test('fix package.json — without its optional packages the core runs, an optional op names its package', async () => {
  let { execFileSync } = await import('child_process')
  let left = Object.keys(pkg.optionalDependencies)
  // every optional package resolves to nothing, as if npm had skipped it
  let hook = `data:text/javascript,${encodeURIComponent(`let left = ${JSON.stringify(left)}
export async function resolve(s, c, next) {
  if (left.some(n => s === n || s.startsWith(n + '/'))) throw Object.assign(new Error('Cannot find package ' + s), { code: 'ERR_MODULE_NOT_FOUND' })
  return next(s, c)
}`)}`
  let script = `import { register } from 'node:module'
register(${JSON.stringify(hook)})
let { default: audio } = await import('./audio.js')
let x = Float32Array.from({ length: 44100 }, (_, i) => Math.sin(i / 10) * .5), a = () => audio.from([x], { sampleRate: 44100 })
let out = {
  core: [(await a().highpass(100).read())[0].length, (await a().stretch(1.5).read())[0].length, (await a().pitch(2).read())[0].length, Math.round(await a().stat('loudness'))],
  missing: await Promise.all([a().compressor().read(), a().vocals().read(), a().convolve([x]).read(), a().stat('bpm')].map(p => p.then(() => 'ran', e => e.message.match(/install (@audio\\/[a-z]+)/)?.[1] ?? e.message)))
}
console.log(JSON.stringify(out))`
  let out = JSON.parse(execFileSync(process.execPath, ['--input-type=module', '-e', script], { cwd: new URL('..', import.meta.url), encoding: 'utf8' }))
  is(out.core.slice(0, 3), [44100, 66150, 44100], 'highpass, stretch, pitch: the core ops render')
  ok(Number.isFinite(out.core[3]), `loudness measured: ${out.core[3]} LUFS`)
  is(out.missing, ['@audio/dynamics', '@audio/vocals', '@audio/reverb', '@audio/beat'], 'each optional op names the package to install')
})
