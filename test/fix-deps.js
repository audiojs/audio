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

// `audio` in a page is dist/audio.js, `audio/worker` is worker.js importing ./deck.js: the bundle importing the same
// deck.js, a page using both runs one deck (one AudioContext, one worklet), with no copy to reconcile
test('fix package.json — the browser bundle imports the deck the worker does, not a copy of it', async () => {
  let { execFileSync } = await import('child_process')
  execFileSync(process.execPath, ['.esbuild.js'], { cwd: new URL('..', import.meta.url) })
  for (let f of ['audio.js', 'audio.min.js']) {
    let src = readFileSync(new URL(`../dist/${f}`, import.meta.url), 'utf8')
    ok(/from\s*"\.\.\/deck\.js"/.test(src), `${f} imports ../deck.js`)
    ok(!src.includes('audio.deck'), `${f} holds no deck of its own`)
  }
})

// the types shipped name every op a call can make: one landed without its declaration is a method TypeScript refuses
test('fix package.json — audio.d.ts declares every op the library registers', async () => {
  let { default: audio } = await import('../audio.js')
  let dts = readFileSync(new URL('../audio.d.ts', import.meta.url), 'utf8')
  let ops = Object.keys(audio.op()).filter(k => !audio.op(k).hidden)
  is(ops.filter(k => !new RegExp(`^\\s+${k}\\(`, 'm').test(dts)), [], 'ops without a method in audio.d.ts')
})

// the deployed site is built into a folder cleared first (node .site-build.js _site): never the repository nor one above it
test('fix package.json — the site\'s build clears no folder that holds the repository', async () => {
  let { holds } = await import('../.site-build.js'), root = '/a/repo/'
  is(['/a/repo', '/a/repo/', '/a', '/'].filter(d => !holds(d, root)), [], 'the repository and the folders above it refused')
  is(['/a/repo/_site', '/tmp/audio-site-x', '/a/other'].filter(d => holds(d, root)), [], 'a folder of its own allowed')
})

// ... and copied there: CI's folder is inside the repository, which Node's cp refuses of a folder whole (2026-11-10: no deploy)
test('fix package.json — the site\'s build copies the repository into a folder inside it', async () => {
  let { mirror } = await import('../.site-build.js')
  let { mkdtempSync, mkdirSync, writeFileSync, rmSync } = await import('fs'), { tmpdir } = await import('os'), { join, dirname } = await import('path')
  let root = mkdtempSync(join(tmpdir(), 'audio-site-'))
  try {
    for (let f of ['a.js', 'sub/b.js', '.git/c', 'node_modules/d/e.js', 'sub/node_modules/f.js', 'sub/.hid']) { mkdirSync(dirname(join(root, f)), { recursive: true }); writeFileSync(join(root, f), f) }
    await mirror(join(root, '_site'), root)
    is(readdirSync(join(root, '_site'), { recursive: true }).sort(), ['a.js', 'sub', 'sub/b.js'], 'what is served: nothing hidden, no node_modules, not the folder itself')
  } finally { rmSync(root, { recursive: true, force: true }) }
})

// A publish goes out only tested by CI at the latest commit: .tested.js asks GitHub for the branch's tip and the
// commit's `test` workflow (the suites of npm run test:node on three Nodes), and stops the publish on anything else
test('fix package.json — a publish needs CI\'s tests passed for the commit, and the package\'s files the commit\'s', async () => {
  let { verdict, changed } = await import('../.tested.js'), T = '.github/workflows/test.yml', B = '.github/workflows/browser.yml'
  let run = (path, status, conclusion) => ({ path, status, conclusion })
  ok(/&& node \.tested\.js$/.test(pkg.scripts.prepublishOnly), 'prepublishOnly ends on it')
  is(verdict([]).is, 'none', 'no run for the commit')
  is(verdict([run(B, 'completed', 'success')]).is, 'none', 'another workflow\'s pass is not the tests\'')
  is(verdict([run(B, 'completed', 'failure'), run(T, 'completed', 'success')]).is, 'passed', 'the tests passed, whatever the pages\' suites did')
  is(verdict([run(T, 'in_progress', null)]).is, 'running', 'a run still going is waited for')
  is([verdict([run(T, 'completed', 'failure')]).is, verdict([run(T, 'completed', 'cancelled')]).is], ['failed', 'failed'], 'a run that failed, or was cancelled, stops the publish')
  is(verdict([run(T, 'completed', 'success'), run(T, 'completed', 'failure')]).is, 'passed', 'the newest run of the tests is the one read')
  // the files a publish packs must be the commit's: one changed since stops it
  let { mkdtempSync, writeFileSync, rmSync, mkdirSync } = await import('fs'), { tmpdir } = await import('os'), { join } = await import('path'), { execFileSync } = await import('child_process')
  let dir = mkdtempSync(join(tmpdir(), 'audio-tested-')), git = (...a) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t.t', ...a], { cwd: dir, stdio: 'pipe' })
  try {
    mkdirSync(join(dir, 'fn')); for (let f of ['core.js', 'fn/a.js', 'package.json', 'notes.md']) writeFileSync(join(dir, f), 'x')
    git('init', '-q'); git('add', '.'); git('commit', '-q', '-m', 'x')
    let files = { files: ['core.js', 'fn/', 'dist/'] }
    is(changed(files, dir), [], 'as committed: none')
    writeFileSync(join(dir, 'notes.md'), 'y')
    is(changed(files, dir), [], 'a file the package does not hold changed: none')
    writeFileSync(join(dir, 'fn/a.js'), 'y'); writeFileSync(join(dir, 'fn/new.js'), 'z')
    is(changed(files, dir).map(l => l.slice(3)).sort(), ['fn/a.js', 'fn/new.js'], 'a file of the package changed, another added')
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

