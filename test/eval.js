// The eval: cases (test/eval/cases.js) that fail when a release makes a sound worse. Each case's take, made here from a
// seed or a voice of test/eval/voices, goes through the subject (this checkout's audio and what it has installed) and
// is read by this checkout's measures, so the subject can change and the reading stands.
//
//   node test/eval.js                          the subject as installed; exit 1 if a case fails
//   node test/eval.js name=path …              a package's folder in place of the installed one (a candidate before
//                                              it is published), its dependencies its own where it holds them
//   node test/eval.js --audio=dir              another install's audio as the subject (dir: its package folder)
//   node test/eval.js --only=text              the cases whose id holds text
//   node test/eval.js --bounds=file            the bounds read from file, not test/eval/bounds.json
//   node test/eval.js --readings=file          write every reading to file (JSON), for --tighten on another machine
//   node test/eval.js --tighten[=a.json,…]     write the bounds: a reading better than its bound (or a bound not yet
//                                              read) becomes it; with readings of other machines, the worst of them,
//                                              and their spread its scatter. Never a bound worse
//   node test/eval.js --accept=id/measure --why=text   write a reading worse than its bound, with why
//   node test/eval.js --offline                a case that may load DeepFilterNet3 (8 MB, fetched once into the neural
//                                              cache) is skipped where the model is not cached; without it the op
//                                              fetches the model, and a fetch that fails fails the case
//   node test/eval.js --strict                 a case skipped fails the run (CI: every package and model is there)
import { createHash } from 'node:crypto'
import os from 'node:os'
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createRequire } from 'node:module'
import { versionAt, satisfies } from './eval/candidate.js'

const here = path.dirname(fileURLToPath(import.meta.url)), repo = path.dirname(here)
const args = process.argv.slice(2), flag = k => args.find(a => a === `--${k}` || a.startsWith(`--${k}=`))?.split('=').slice(1).join('=')
const has = k => args.some(a => a === `--${k}` || a.startsWith(`--${k}=`))
const map = Object.fromEntries(args.filter(a => !a.startsWith('--') && a.includes('=')).map(a => { let [k, v] = a.split('='); return [k, path.resolve(v)] }))
const subjectDir = flag('audio') ? path.resolve(flag('audio')) : repo, root = subjectDir === repo ? repo : path.dirname(path.dirname(subjectDir))
const boundsFile = flag('bounds') ? path.resolve(flag('bounds')) : path.join(here, 'eval', 'bounds.json')
const pkg = d => JSON.parse(readFileSync(path.join(d, 'package.json')))

// the candidates, said before anything loads: each in place of what, and the version of each of its dependencies it gets
let unmet = []
for (let [name, dir] of process.env.AUDIO_EVAL_CANDIDATES ? [] : Object.entries(map)) {
  if (!existsSync(path.join(dir, 'package.json'))) throw new Error(`eval: ${name}=${dir}: no package.json there`)
  let p = pkg(dir), was = versionAt(name, subjectDir, root)
  if (p.name !== name) throw new Error(`eval: ${dir} holds ${p.name}, not ${name}`)
  console.log(`# candidate ${name} ${p.version} from ${dir}, in place of ${was ? was.version : 'none installed'}`)
  for (let [dep, range] of Object.entries({ ...p.dependencies, ...p.peerDependencies })) {
    let got = map[dep] ? { version: pkg(map[dep]).version } : versionAt(dep, dir, root), ok = got && satisfies(got.version, range)
    if (ok === false || !got) unmet.push(`${name} wants ${dep} ${range}, gets ${got ? got.version : 'none'}`)
    else if (ok == null) console.log(`#   ${dep} ${got.version} (${range}: a range this check does not read)`)
  }
}
if (unmet.length) { for (let u of unmet) console.log(`not ok - ${u}: install it beside the candidate, or give it as ${u.split(' ')[2]}=path`); process.exit(1) }
// the hook in every thread: this run again under --import of the module that registers it, the map in the environment
// (a worker, as parallel.js starts one for declip, takes the process's execArgv and environment)
if (Object.keys(map).length && !process.env.AUDIO_EVAL_CANDIDATES) {
  let { spawnSync } = await import('node:child_process')
  let r = spawnSync(process.execPath, ['--import', pathToFileURL(path.join(here, 'eval', 'register.js')).href, ...process.execArgv, fileURLToPath(import.meta.url), ...args],
    { stdio: 'inherit', env: { ...process.env, AUDIO_EVAL_CANDIDATES: JSON.stringify({ map, root }) } })
  process.exit(r.status ?? 1)
}

const audio = (await import(pathToFileURL(path.join(subjectDir, pkg(subjectDir).main ?? 'audio.js')))).default
const { default: CASES } = await import('./eval/cases.js'), { SOUNDS } = await import('./eval/sounds.js'), { read, MEASURES } = await import('./eval/measures.js')
const instrument = (await import('../audio.js')).default
const req = createRequire(path.join(subjectDir, 'package.json'))
// a package as the subject's tree gives it (a candidate where one is named)
const load = name => map[name] ? import(name) : import(pathToFileURL(req.resolve(name)))
const installed = name => !!map[name] || !!versionAt(name, subjectDir, root)
const version = name => map[name] ? pkg(map[name]).version : name === 'audio' ? pkg(subjectDir).version : versionAt(name, subjectDir, root)?.version ?? null

const bounds = existsSync(boundsFile) ? JSON.parse(readFileSync(boundsFile)) : { figures: {} }
// a reading's step, under which no two readings are told apart: dB to 0.01, shares to 0.1 %, a score of 1 to 0.001 and
// of 100 to 0.1, counts and frames whole
const STEP = { dB: 0.01, '%': 0.1, 'of 1': 0.001, 'of 100': 0.1, '': 0, frames: 0 }
const worse = (m, a, b) => MEASURES[m].better === 'up' ? b - a : a - b   // how much a is worse than b (positive: worse)
const fmt = (m, v) => v == null ? 'none' : `${v.toFixed(STEP[MEASURES[m].unit] ? STEP[MEASURES[m].unit] < 0.01 ? 3 : 2 : 0)}${MEASURES[m].unit ? ' ' + MEASURES[m].unit : ''}`

const only = flag('only'), cases = CASES.filter(c => !only || c.id.includes(only))
const made = new Map(), readings = {}, out = { pass: 0, fail: 0, known: 0, skip: 0 }, lines = []
const say = (kind, text) => { console.log(`${kind} - ${text}`); lines.push([kind, text]) }
let cpu0 = process.cpuUsage(), names = new Set()
// the model a case may load (one with neural-denoise in its needs, or auto(), which plans the model where the package is
// installed), and whether it is in the neural cache (@audio/neural-runtime's: its URL's SHA-256 under the folder)
const modelCached = async () => {
  if (!installed('@audio/neural-denoise')) return true
  let { MODEL } = await load('@audio/neural-denoise'), dir = process.env.AUDIO_NEURAL_CACHE || path.join(os.homedir(), '.cache', 'audiojs', 'neural')
  return existsSync(path.join(dir, createHash('sha256').update(MODEL).digest('hex')))
}
const offline = has('offline') && !await modelCached()

for (let c of cases) {
  if (names.has(c.id)) throw new Error(`eval: two cases named ${c.id}`)
  names.add(c.id)
  let missing = (c.needs ?? []).filter(n => !installed(n))
  if (missing.length) { out.skip++; say('skip', `${c.id}: ${missing.join(', ')} not installed`); continue }
  if (offline && (c.needs?.includes('@audio/neural-denoise') || c.do[0] === 'auto')) { out.skip++; say('skip', `${c.id}: offline, DeepFilterNet3 not in the neural cache`); continue }
  let key = JSON.stringify(c.sound)
  if (!made.has(key)) made.set(key, SOUNDS[c.sound[0]](c.sound[1]))
  let snd = await made.get(key), x = snd.x, fs = snd.fs, y, t0 = process.cpuUsage()
  try { y = await run(c, x, fs) }
  catch (e) { out.fail++; say('not ok', `${c.id}: ${e.message.split('\n')[0]}`); continue }
  // the take as the op gave it, for a measure of its length (`whole`); every other reads it cut to the input's length
  let take = y
  let ctx = { ...snd, x: c.do.stat ? x : x.length === 1 ? x[0] : x, fs }, dt = process.cpuUsage(t0), took = +((dt.user + dt.system) / 1e6).toFixed(2)
  // where a measure reads the take sample by sample against what the case knows, at the lag compare() reads
  if (!c.do.stat && Object.keys(c.hold).some(m => ['sisdr', 'lost', 'shown', 'bed', 'estoi'].includes(m))) {
    // under 2 s compare() reads no lag: read at 0 there (a lag the op left would read worse, never better)
    let cmp = await instrument.from(y, { sampleRate: fs }).compare(instrument.from(x, { sampleRate: fs })), d = cmp.lag == null ? cmp.why === 'short' ? 0 : null : Math.round(cmp.lag * fs)
    if (d == null) { out.fail++; say('not ok', `${c.id}: no lag between the take and the input (${cmp.why}): its measures are not read`); continue }
    if (cmp.why === 'short') ctx.at0 = true
    if (d) y = y.map(ch => { let z = new Float32Array(x[0].length); for (let i = 0; i < z.length; i++) z[i] = ch[i + d] ?? 0; return z })
  }
  for (let [m, rule] of Object.entries(c.hold)) {
    let id = `${c.id}/${m}`, v = await read(m, c.do.stat ? y : MEASURES[m].whole ? take : y.map(ch => ch.subarray(0, x[0].length)), ctx), b = bounds.figures[id]
    readings[id] = { value: v, cpu: took, with: Object.fromEntries([...(c.pkgs ?? []), 'audio'].map(n => [n, version(n)])) }
    if (v == null) { out.fail++; say('not ok', `${id}: no reading`); continue }
    let fails = [], notes = []
    if (rule.harm != null) {
      let ref = MEASURES[m].plan || ['level', 'tone', 'onset', 'balance', 'under', 'silenced'].includes(m) ? 0 : await read(m, x, ctx)
      let w = worse(m, v, ref)
      if (w > rule.harm + STEP[MEASURES[m].unit]) fails.push(`no harm: ${fmt(m, v)} against the input's ${fmt(m, ref)}, past the ${rule.harm} margin`)
    }
    if (rule.back) {
      if (!b) fails.push(`no step back: no bound read (npm run eval -- --tighten)`)
      else {
        let tol = Math.max(b.scatter ?? 0, STEP[MEASURES[m].unit]), w = worse(m, v, b.value)
        if (w > tol) fails.push(`no step back: ${fmt(m, v)} against ${fmt(m, b.value)} read ${b.read} (${Object.entries(b.with ?? {}).map(([k, x]) => `${k} ${x}`).join(', ')}), past its scatter ${tol}`)
        else if (-w > tol) notes.push(`better than its bound ${fmt(m, b.value)}: --tighten holds it there`)
      }
    }
    // a known failure: a harm today's packages do, held where it stands until it is gone
    if (fails.length && b?.known && fails.every(f => f.startsWith('no harm')) && worse(m, v, b.value) <= Math.max(b.scatter ?? 0, STEP[MEASURES[m].unit])) {
      out.known++; say('known', `${id}: ${fmt(m, v)} (${b.known}): ${fails[0]}`); continue
    }
    if (fails.length) { out.fail++; say('not ok', `${id}: ${fmt(m, v)}: ${fails.join('; ')}`) }
    else { out.pass++; say('ok', `${id}: ${fmt(m, v)}${ctx.at0 ? ' (at lag 0: under 2 s)' : ''}${b?.known ? '; no longer a known failure: --tighten lifts it' : ''}${notes.length ? '; ' + notes.join('; ') : ''}`) }
  }
}

/** What the case does to the take, on the subject: the channels out, or a plan */
async function run(c, x, fs) {
  if (c.do.call) {
    let mod = await load(c.do.call), f = mod.default, opts = { ...c.do.opts }
    if (opts.model && mod.load) opts.model = await mod.load(opts.model)
    try { return await f(x, { sampleRate: fs, ...opts }) } finally { opts.model?.free?.() }
  }
  let a = audio.from(x, { sampleRate: fs })
  if (c.do.stat) { if (c.do.use) await audio.use(c.do.use); return a.stat(c.do.stat) }
  let [op, ...rest] = c.do
  if (typeof a[op] !== 'function') throw new Error(`the subject has no ${op}()`)
  return a[op](...rest).read()
}

let cpu = process.cpuUsage(cpu0)
console.log(`# ${cases.length} cases, ${out.pass + out.fail + out.known} figures: ${out.pass} pass, ${out.fail} fail, ${out.known} known failures; ${out.skip} cases skipped; ${((cpu.user + cpu.system) / 1e6).toFixed(1)} s CPU`)
console.log(`# subject audio ${version('audio')} at ${subjectDir}`)

if (flag('readings')) writeFileSync(path.resolve(flag('readings')), JSON.stringify({ node: process.version, arch: `${process.platform}/${process.arch}`, readings }, null, 1))

if (has('tighten') || has('accept')) {
  let others = (flag('tighten') || '').split(',').filter(Boolean).map(f => JSON.parse(readFileSync(f)).readings)
  // a scatter to two figures: the machines' spread is down to 1e-15 dB, and its size is what the file tells
  let today = new Date().toISOString().slice(0, 10), fig = bounds.figures, sig = v => +v.toPrecision(2)
  if (has('accept') && !flag('why')) throw new Error('eval: --accept takes --why=text: the reason a step back is taken')
  for (let [id, r] of Object.entries(readings)) {
    if (r.value == null) continue
    let m = id.split('/').pop(), c = cases.find(k => id === `${k.id}/${m}`), rule = c.hold[m], b = fig[id]
    let all = [r.value, ...others.map(o => o[id]?.value).filter(v => v != null)]
    let value = all.reduce((p, v) => worse(m, v, p) > 0 ? v : p), scatter = Math.max(...all) - Math.min(...all)
    let harmed = lines.some(([k, t]) => t.startsWith(id + ':') && (k === 'known' || k === 'not ok' && t.includes('no harm')))
    let entry = { value: +value.toFixed(4), scatter: sig(Math.max(scatter, others.length ? 0 : b?.scatter ?? 0)), read: today, with: r.with, ...harmed && { known: `read ${today}: no harm fails with these packages` } }
    if (has('accept') && flag('accept') === id) fig[id] = { ...entry, accepted: flag('why') }
    // a figure held by no harm alone keeps a bound only while it is a known failure
    else if (!rule.back && !harmed) delete fig[id]
    // a bound is written to four places: a reading the same there is the bound, not better than it (its reason kept)
    else if (!b || worse(m, b.value, entry.value) > 0) fig[id] = entry
    else {
      let keep = { ...b, ...others.length && scatter > (b.scatter ?? 0) && { scatter: sig(scatter) } }
      if (keep.known && !harmed) delete keep.known
      fig[id] = keep
    }
  }
  writeFileSync(boundsFile, JSON.stringify({ figures: Object.fromEntries(Object.entries(fig).sort()) }, null, 1) + '\n')
  console.log(`# bounds written: ${boundsFile}`)
}

if (has('strict') && out.skip) console.log(`not ok - ${out.skip} cases skipped where every one must run (--strict)`)
process.exitCode = out.fail || has('strict') && out.skip ? 1 : 0
