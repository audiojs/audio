// Contract atoms as audio ops — audio.use(module) hosts the contract natively.
// Pilots: @audio/dynamics-compressor (dynamics kernel, live/automated params) and
// @audio/reverb-freeverb (declared tail → composed trailing pad, decay preserved).

import test, { ok, almost, is } from 'tst'
import { tone as genTone } from './gen.js'
import audio from '../audio.js'
import { widening } from '../plan.js'
import { layoutChannels } from '../batch.js'
import { compressor } from '@audio/dynamics-compressor/audio'
import { freeverb } from '@audio/reverb-freeverb/audio'

audio.use(compressor, freeverb)

const SR = 44100

const tone = (freq, dur, amp = 0.8, sr = SR) => genTone(freq, dur, amp, sr)
function rms(d, from = 0, to = d.length) {
  let s = 0
  for (let i = from; i < to; i++) s += d[i] * d[i]
  return Math.sqrt(s / (to - from))
}

test('use(module) registers an op; compressor reduces hot material', async () => {
  ok(typeof audio.fn.compressor === 'function', 'method registered')
  let a = audio.from([tone(440, 1)], { sampleRate: SR })
  let dry = (await audio.from([tone(440, 1)], { sampleRate: SR }).read())[0]
  let wet = (await a.compressor({ threshold: -24, ratio: 6 }).read())[0]
  ok(rms(wet, SR / 2) < rms(dry, SR / 2) * 0.8, `compressed (${(20 * Math.log10(rms(wet, SR / 2) / rms(dry, SR / 2))).toFixed(1)} dB)`)
  ok(wet.every(isFinite))
})

test('module op params flow through engine automation (fn param ≡ static param)', async () => {
  let stat = (await audio.from([tone(440, 1)], { sampleRate: SR }).compressor({ threshold: -24, ratio: 6 }).read())[0]
  let auto = (await audio.from([tone(440, 1)], { sampleRate: SR }).compressor({ threshold: () => -24, ratio: 6 }).read())[0]
  let diff = 0
  for (let i = 0; i < stat.length; i++) diff = Math.max(diff, Math.abs(stat[i] - auto[i]))
  ok(diff < 1e-6, `automated ≡ static (${diff.toExponential(1)})`)

  // ramp: threshold drops mid-signal → later material more compressed
  let ramp = (await audio.from([tone(440, 2)], { sampleRate: SR }).compressor({ threshold: t => t < 1 ? 0 : -30, ratio: 8 }).read())[0]
  ok(rms(ramp, Math.round(1.5 * SR)) < rms(ramp, Math.round(0.25 * SR), Math.round(0.75 * SR)) * 0.7, 'automation engages mid-stream')
})

test('declared tail composes a trailing pad — freeverb decay is not truncated', async () => {
  let a = audio.from([tone(440, 0.5)], { sampleRate: SR })
  let dur0 = a.duration
  a.freeverb({ room: 0.8, mix: 1 })
  almost(a.duration, dur0 + 6, 0.05, `duration extended by tail (${a.duration.toFixed(2)}s)`)
  let out = (await a.read())[0]
  let tailRms = rms(out, Math.round(0.7 * SR), Math.round(1.5 * SR))
  ok(tailRms > 1e-4, `reverb rings past the source (${tailRms.toExponential(1)})`)
  ok(out.every(isFinite))
})

test('op introspection carries module param metadata (CLI help substrate)', () => {
  let d = audio.op('compressor')
  is(d.plugin.params.threshold.min, -60)
  is(d.plugin.params.threshold.unit, 'dB')
  ok(d.params.includes('ratio'))
  is(audio.op('freeverb').tail, freeverb.tail)
})

test('tail op is undo-atomic and serializes as one edit', async () => {
  let a = audio.from([tone(440, 0.5)], { sampleRate: SR })
  let dur0 = a.duration
  a.freeverb({ room: 0.8 })
  is(a.edits.length, 1, 'one edit recorded (pad composed at compile)')
  is(a.toJSON().edits.length, 1)
  a.undo()
  is(a.duration, dur0, 'undo removes reverb AND its tail pad')
})

for (let name of ['delay', 'freeverb']) {
  test(`parity: ${name} dry bypass preserves samples, length and source in read/stream`, async () => {
    await audio.use(name)
    for (let sampleRate of [16000, 48000, 96000]) for (let channels of [1, 2]) for (let frames of [0, 1, 1024, 1025]) {
      let input = Array.from({ length: channels }, (_, c) => Float32Array.from({ length: frames }, (_, i) => ((i + c) % 19 - 9) / 16))
      let source = audio.from(input.map(x => x.slice()), { sampleRate }), a = source.clone()[name]({ mix: 0 })
      try {
        is(a.length, frames, 'dry effect adds no tail')
        let out = await a.read()
        for (let c = 0; c < channels; c++) is(out[c], input[c], 'sample-exact bypass')
        let offset = 0
        for await (let chunk of a.stream()) {
          for (let c = 0; c < channels; c++) is(chunk[c], input[c].subarray(offset, offset + chunk[c].length))
          offset += chunk[0].length
        }
        is(offset, frames, 'stream length')
        let original = await source.read()
        for (let c = 0; c < channels; c++) is(original[c], input[c], 'source unchanged')
      } finally { a.dispose(); source.dispose() }
    }
  })

  test(`parity: ${name} rerenders A/A/B without stale effect state`, async () => {
    await audio.use(name)
    const sampleRate = 16000, opts = { mix: 1, ...(name === 'delay' ? { time: .01, feedback: .5 } : {}) }
    let A = new Float32Array(1025), B = new Float32Array(1025)
    A[0] = .5; B[512] = -.25
    let a = audio.from([A], { sampleRate })[name](opts)
    let b = audio.from([B], { sampleRate })[name](opts)
    try {
      let first = (await a.read())[0]
      is((await a.read())[0], first, 'A again')
      a.undo(); a.write([B]); a[name](opts)
      is((await a.read())[0], (await b.read())[0], 'changed B equals a fresh instance')
    } finally { a.dispose(); b.dispose() }
  })

  test(`parity: ${name} retains wet tails, including mix automation starting dry`, async () => {
    await audio.use(name)
    const sampleRate = 16000, length = 3200
    for (let mix of [1, t => t < .05 ? 0 : 1, { t: [0, .05], v: [0, 1] }]) {
      let input = tone(440, length / sampleRate, .5, sampleRate)
      let a = audio.from([input], { sampleRate })[name]({ mix, ...(name === 'delay' ? { time: .01, feedback: .5 } : {}) })
      try {
        let out = (await a.read())[0]
        ok(out.length > length, 'wet tail has frames')
        ok(out.subarray(length).some(x => Math.abs(x) > 1e-5), 'wet tail is audible')
        let offset = 0
        for await (let chunk of a.stream()) {
          is(chunk[0], out.subarray(offset, offset + chunk[0].length), 'stream matches read')
          offset += chunk[0].length
        }
        is(offset, out.length)
        is(a.edits.length, 1, 'effect and its tail remain one edit')
        a.undo()
        is(a.length, length, 'undo removes effect and tail')
      } finally { a.dispose() }
    }
  })
}

test('parity: delay tail remains finite with automated feedback', async () => {
  await audio.use('delay')
  let a = audio.from([Float32Array.of(1, 0, 0)], { sampleRate: 16000 }).delay({ time: .01, feedback: () => .5, mix: 1 })
  try {
    let out = (await a.read())[0]
    ok(out.length > 160, 'reserves the delayed impulse')
    ok(out.every(Number.isFinite), 'no invalid tail planning')
    ok(out.subarray(3).some(x => x !== 0), 'delayed impulse survives')
  } finally { a.dispose() }
})

test('audio.use(name) resolves through the registry (dynamic import)', async () => {
  is(audio.atoms, audio.plugins, 'audio.atoms is a deprecated alias of audio.plugins')
  audio.plugins ??= {}
  audio.plugins.tube = '@audio/saturate-tube/audio'
  await audio.use('tube')
  ok(typeof audio.fn.tube === 'function', 'registry-resolved module registered')
  let out = (await audio.from([tone(440, 0.2)], { sampleRate: SR }).tube({ drive: 8 }).read())[0]
  ok(out.every(isFinite))
  let err = null
  try { audio.use('nosuchmodule') } catch (e) { err = e }
  ok(/unknown plugin/.test(err?.message), 'unknown name throws')
})

test('audio.use(name) loads through audio.import, so a bundle can supply literal imports', async () => {
  let asked = [], original = audio.import
  let echo = () => (inputs, outputs) => { inputs[0].forEach((c, i) => outputs[0][i].set(c)) }
  echo.channels = 'any'
  echo.params = { level: { type: 'number', min: 0, max: 1, default: 1 } }
  audio.plugins.echo = '@audio/echo-probe/audio'
  audio.import = spec => (asked.push(spec), spec === '@audio/echo-probe/audio' ? Promise.resolve({ echo }) : original(spec))
  try {
    await audio.use('echo')
    is(asked.join(), '@audio/echo-probe/audio', 'the registry name loaded through audio.import, once')
    let input = tone(440, 0.1)
    let out = (await audio.from([input], { sampleRate: SR }).echo().read())[0]
    ok(out.length === input.length && out.every((v, i) => v === input[i]), 'the supplied module renders')
  } finally { audio.import = original; delete audio.plugins.echo; delete audio.fn.echo }
})

// A registry op's module loads at the first read; a width asked before that cannot know what the op makes of it
test('channels asked before a registry op is loaded: the width read, from the read on', async () => {
  let original = audio.import
  let wideprobe = () => (inputs, outputs) => { for (let out of outputs[0]) out.set(inputs[0][0]) }
  wideprobe.channels = { inputs: 1, outputs: 2 }
  wideprobe.params = {}
  audio.plugins.wideprobe = '@audio/wide-probe/audio'
  audio.import = spec => spec === '@audio/wide-probe/audio' ? Promise.resolve({ wideprobe }) : original(spec)
  try {
    let one = () => audio.from([tone(440, 0.1)], { sampleRate: SR }).run(['wideprobe'])
    let a = one(), b = one()
    ok(!audio.op('wideprobe'), 'not loaded yet')
    // both asked before the load: what either says then is not kept
    void a.channels, void b.channels
    let out = await a.read()
    is([out.length, a.channels], [2, 2], 'two channels read, two said')
    is(b.channels, 2, 'by a sound asked before the load and not read since')
    is(a.clone().channels, 2, 'and by a copy')
  } finally { audio.import = original; delete audio.plugins.wideprobe; delete audio.fn.wideprobe }
})

// A registry op that can change the width (audio.js names them, each with the width it makes of a width given): asked
// before it has loaded, the width is the one it will make; where a layout option picks it, no width is known, so asking
// is an error, as the length is, naming each such op and the call that makes it known. An op that keeps every width,
// one on chosen channels (in place) and a remix to a count after it answer with the width they leave, and edits after
// it still plan
test('channels asked before a registry op that can change the width has loaded: the width it makes, or an error naming it and the call', async () => {
  let names = ['surround', 'panner', 'widener', 'tremolo', 'ambisonic-panner', 'ambisonic-decoder'], held = names.flatMap(n => [n, '_' + n]).map(n => [n, audio.op(n)])
  let unload = () => { for (let [n] of held) delete audio.op()[n] }, said = a => { try { return a.channels } catch (e) { return e.message } }
  unload()
  try {
    let mono = () => audio.from([tone(440, 0.1)], { sampleRate: SR }), stereo = () => audio.from([tone(440, 0.1), tone(440, 0.1)], { sampleRate: SR })
    is(said(mono().surround()), 6, 'a count of its own: that count')
    is(said(mono().widener()), 2, 'a stereo processor on a mono sound: two')
    is(said(mono().widener().surround()), 6, 'one after another: the last one\'s')
    is(said(mono().surround().widener()), 6, 'a stereo processor after six channels: six kept')
    is(said(mono()['ambisonic-panner']()), "ambisonic-panner: can change the channel count, and is not loaded until the first read (await audio.use('ambisonic-panner') to know it before)", 'layouts of its own: the op named, and the call')
    is(said(mono()['ambisonic-panner']()['ambisonic-decoder']()), "ambisonic-panner, ambisonic-decoder: can change the channel count, and are not loaded until the first read (await audio.use('ambisonic-panner', 'ambisonic-decoder') to know it before)", 'each such op named, and the call that loads them all')
    is(said(mono()['ambisonic-panner']().surround()), 6, 'a count of its own after it: known again')
    is(mono().surround().sampleRate, SR, 'its rate as it was')
    is(said(mono().tremolo()), 1, 'an op that keeps the width: the width as it was')
    is(said(audio.from([1, 2, 3, 4].map(() => tone(440, 0.1)), { sampleRate: SR }).panner({ channel: [2, 3] })), 4, 'on chosen channels: in place, the width as it was')
    is(said(stereo().panner()), 2, 'a stereo processor on a stereo sound: the width it keeps')
    is(said(stereo().widener().clip({ at: 0.01 })), 2, 'and a clip of it')
    is(said(mono().surround().remix(2)), 2, 'a remix to a count after it: that count')
    is(said(mono().surround().remix(2).widener()), 2, 'and a width kept after that')
    let b = mono().surround().gain(-3)
    is((await b.read()).length, 6, 'surround().gain(-3) before any read: planned, six channels read')
    is(b.channels, 6, 'and said')
    unload()
    let c = mono().widener().surround(), d = mono()['ambisonic-panner']()
    await audio.use('widener', 'surround', 'ambisonic-panner')
    is(c.channels, 6, 'the ops loaded: the same answer')
    is(d.channels, 4, "await audio.use('ambisonic-panner'): known with no read")
  } finally { for (let [n, d] of held) if (d) audio.op()[n] = d; else delete audio.op()[n] }
})

// A processor that declares a tail is hosted as a pad and a hidden op that renders it (core.js hostOp): what an edit
// gives it reaches that op, a param by its former name (its alias) too, and its op says the latency it declares, as the
// op of one without a tail does
test('a processor with a tail: a param by its alias reaches it, and its op says its latency', async () => {
  let make = tail => Object.assign(() => (inputs, outputs, p) => {
    for (let c = 0; c < outputs[0].length; c++) {
      let inp = inputs[0][c], out = outputs[0][c], g = p.gain
      for (let i = 0; i < out.length; i++) out[i] = inp[i] * 10 ** ((typeof g === 'number' ? g : g[g.length > 1 ? i : 0]) / 20)
    }
  }, { params: { gain: { type: 'number', min: -60, max: 24, default: 0, unit: 'dB', alias: 'g' } }, latency: 64, tail })
  let names = { 'probe-tailed': 0.05, 'probe-flat': 0 }
  for (let [n, t] of Object.entries(names)) audio.op(n, make(t))
  try {
    let x = tone(440, 0.1), read = async (n, o) => (await audio.from([x], { sampleRate: SR })[n](o).read())[0].subarray(0, x.length)
    let peak = y => y.reduce((m, v) => Math.max(m, Math.abs(v)), 0)
    for (let n in names) {
      let byName = await read(n, { gain: -6 })
      ok(peak(byName) < 0.6 * peak(await read(n, {})), `${n}: -6 dB taken`)
      is(await read(n, { g: -6 }), byName, `${n}: by its alias, as by its name`)
    }
    is([audio.op('probe-tailed').latency, audio.op('probe-flat').latency], [64, 64], 'its latency said, with a tail as without')
  } finally {
    for (let n in names) { delete audio.op()[n]; delete audio.op()['_' + n]; delete audio.fn[n]; delete audio.fn[n.replace(/-(.)/g, (_, c) => c.toUpperCase())] }
  }
})

import { keeping } from '../core.js'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'

// A repair or a pitch shift keeps its take's length (core.js keeping, ring): a processor the registry loads from a
// package in audio.js's list renders none of the tail it declares; any other renders its tail, however short, and an
// endless one audio.TAIL seconds. An edit's `tail` says otherwise: true, the ring; false, none; a number, that many
// seconds of one that declares a tail. The processors here ring as a one-pole echo of their input, streaming or whole
// (streaming: false), loaded as the registry loads its own (audio.import): over the take their samples are the same
// either way, the tail cut and nothing else moved, and the ring asked for is the one they make
test("a repair's or a pitch shift's tail is cut to the take unless an edit asks; any other's, rendered unless it says false", async () => {
  let ringing = (id, tail, whole, params = {}) => Object.assign(ctx => {
    let y = new Float64Array(ctx.maxChannels)
    return (inputs, outputs) => {
      for (let c = 0; c < outputs[0].length; c++) for (let i = 0, inp = inputs[0][c], out = outputs[0][c]; i < out.length; i++) out[i] = y[c] = inp[i] + 0.995 * y[c]
    }
  }, { id, params, channels: 'any', tail, ...whole && { streaming: false } })
  let load = audio.import, mods = {}, made = [], held = ['pitch-delay', audio.plugins['pitch-delay'], audio.op('pitch-delay')], T = audio.TAIL
  let entry = (name, tail, whole, keeps, params) => {
    let spec = `@probe/${name}/audio`
    mods[spec] = { [name]: ringing(name, tail, whole, params) }; audio.plugins[name] = spec; made.push(name)
    if (keeps) keeping.add(spec)
  }
  audio.import = spec => mods[spec] ? Promise.resolve(mods[spec]) : load(spec)
  try {
    audio.TAIL = 0.05
    for (let w of [false, true]) {
      let s = w ? '-whole' : ''
      entry('probe-repair' + s, 0.1, w, true); entry('probe-echo' + s, 0.1, w, false)
      entry('probe-short' + s, 31 / SR, w, false)
      entry('probe-endless' + s, Infinity, w, false); entry('probe-repair-endless' + s, Infinity, w, true)
    }
    // a param of the processor's own named tail is its own, as a `mix` param is
    entry('probe-own-tail', 0.1, false, false, { tail: { type: 'number', min: 0, max: 1, default: 0 } })
    // pitch({ method }) reaches its shifter through the registry, the rule with it
    entry('pitch-delay', 0.1, true, true, { semitones: { type: 'number', min: -24, max: 24, default: 0 } })
    delete audio.op()['pitch-delay']
    for (let n of made.filter(n => n !== 'pitch-delay')) await audio.use(n)

    let x = tone(440, 0.2), n = x.length, sound = () => audio.from([x.slice()], { sampleRate: SR })
    let render = async (name, o) => (await sound()[name](o).read())[0]
    let same = (p, q, k = q.length) => p.length >= k && q.length >= k && p.subarray(0, k).every((v, i) => v === q[i])
    for (let w of [false, true]) {
      let s = w ? '-whole' : '', kind = w ? 'whole' : 'streaming', ring = Math.round(0.1 * SR), endless = Math.round(0.05 * SR)
      let full = await render('probe-echo' + s), kept = await render('probe-repair' + s), asked = await render('probe-repair' + s, { tail: true })
      is([kept.length - n, asked.length - n, full.length - n], [0, ring, ring], `${kind}: a repair's 0.1 s cut, rendered on tail: true; another's rendered`)
      ok(same(asked, full) && same(kept, full, n), `${kind}: the take the same samples either way; tail: true the very ring`)
      ok(full.subarray(n).some(v => Math.abs(v) > 1e-3), `${kind}: there is a ring to cut`)
      let part = await render('probe-repair' + s, { tail: 0.05 }), none = await render('probe-echo' + s, { tail: false })
      is([part.length - n, none.length - n], [Math.round(0.05 * SR), 0], `${kind}: tail: 0.05, 0.05 s of it; another's, tail: false, none`)
      ok(same(part, full, part.length) && same(none, full, n), `${kind}: what is kept is the ring as rendered whole`)
      let grown = async (name, o) => (await render(name + s, o)).length - n
      is([await grown('probe-short'), await grown('probe-short', { tail: false })], [31, 0], `${kind}: a short ring (31 frames) of a processor not in the list rendered as declared; tail: false none`)
      is([await grown('probe-endless'), await grown('probe-repair-endless'), await grown('probe-repair-endless', { tail: true })], [endless, 0, endless], `${kind}: an endless tail audio.TAIL seconds; a repair's none, unless asked`)
    }
    is([audio.op('probe-repair').keeps, audio.op('probe-repair-whole').keeps, audio.op('probe-echo').keeps], [true, true, undefined], 'the op says it keeps the length')
    is((await render('probe-own-tail', { tail: 0 })).length - n, Math.round(0.1 * SR), 'a param named tail is the processor\'s: its tail rendered')

    // a processor of the user's own renders its tail, though it takes the name of a registry op that keeps the length
    audio.op('probe-repair', ringing('probe-repair', 0.1, false))
    audio.use(ringing('probe-user', 0.1, true))
    is([(await render('probe-repair')).length - n, (await render('probe-user')).length - n], [Math.round(0.1 * SR), Math.round(0.1 * SR)], 'the user\'s own processor renders its tail')

    let shifted = (await sound().pitch(5, { method: 'delay' }).read())[0], rung = (await sound().pitch(5, { method: 'delay', tail: true }).read())[0]
    is([shifted.length - n, rung.length - n], [0, Math.round(0.1 * SR)], 'pitch({ method }): the shifter\'s tail cut, rendered on tail: true')
    ok(same(shifted, rung, n), 'pitch({ method }): the take the same samples either way')
  } finally {
    audio.import = load; audio.TAIL = T
    for (let n of [...made, 'probe-user']) {
      keeping.delete(audio.plugins[n])
      for (let k of [n, '_' + n]) delete audio.op()[k]
      // the registry's own op keeps its method
      if (n === held[0]) continue
      delete audio.plugins[n]; delete audio.fn[n]; delete audio.fn[n.replace(/-(.)/g, (_, c) => c.toUpperCase())]
    }
    let [name, spec, d] = held
    audio.plugins[name] = spec
    if (d) audio.op()[name] = d
  }
})

// audio.js's list of the registry ops that keep a take's length (core.js keeping), against the packages installed: an
// op is in it if and only if the package that defines its processor says `restoration` or `pitch-shift` in its keywords,
// an umbrella's member (a module that re-exports one other) followed to the package it re-exports. So a package that
// gains or loses either keyword fails here, by its op's name and the package's version. An op whose package is not
// installed is named and left out
test("the registry ops that keep a take's length: audio.js's list, the packages' keywords", () => {
  let req = createRequire(import.meta.url), say = {}, neither = {}, absent = []
  let pkgOf = file => { for (let d = dirname(file); ; d = dirname(d)) { let f = join(d, 'package.json'); if (existsSync(f)) { let p = JSON.parse(readFileSync(f, 'utf8')); if (p.name) return p } } }
  let defining = spec => { let file = req.resolve(spec), m = readFileSync(file, 'utf8').match(/^\s*export \* from '([^']+)'\s*$/); return m ? defining(m[1]) : pkgOf(file) }
  for (let name of Object.keys(audio.plugins).filter(n => audio.fn[n]?.op === n)) {
    let p
    try { p = defining(audio.plugins[name]) } catch { absent.push(name); continue }
    let kw = (p.keywords || []).filter(k => k === 'restoration' || k === 'pitch-shift')
    if (kw.length) say[name] = `${p.name}@${p.version} says ${kw.join(' and ')}`
    else neither[name] = `${p.name}@${p.version} says neither`
  }
  let listed = Object.keys(audio.plugins).filter(n => keeping.has(audio.plugins[n]))
  is(Object.keys(say).filter(n => !listed.includes(n)).map(n => `${n}: ${say[n]}`), [], 'every op whose package says it keeps the length is in the list')
  is(listed.filter(n => !say[n]).map(n => `${n}: ${neither[n] ?? 'not installed'}`), [], 'every op in the list is one whose package says so')
  ok(listed.length > 20, `${listed.length} ops in the list${absent.length ? `; not installed: ${absent.join(', ')}` : ''}`)
})

// ── Wave B: dynamics-gate + denoise-dehum ─────────────────────────────

import { gate } from '@audio/dynamics-gate/audio'
import { dehum } from '@audio/denoise-dehum/audio'
audio.use(gate, dehum)

/** Goertzel magnitude at f Hz. */
function energyAt(buf, f, sr = SR) {
  let n = buf.length, w = 2 * Math.PI * f / sr
  let coeff = 2 * Math.cos(w), s1 = 0, s2 = 0
  for (let i = 0; i < n; i++) { let s = buf[i] + coeff * s1 - s2; s2 = s1; s1 = s }
  return Math.sqrt(s1 * s1 + s2 * s2 - coeff * s1 * s2) / n
}

test('gate: passes signal, silences the floor', async () => {
  // 0.5s tone at -6dB, then 0.5s floor at -50dB
  let n = SR, ch = new Float32Array(n)
  for (let i = 0; i < n / 2; i++) ch[i] = 0.5 * Math.sin(2 * Math.PI * 440 * i / SR)
  for (let i = n / 2; i < n; i++) ch[i] = 0.003 * Math.sin(2 * Math.PI * 440 * i / SR)
  let out = (await audio.from([ch], { sampleRate: SR }).gate({ threshold: -40, range: -90 }).read())[0]
  ok(rms(out, SR * 0.1, SR * 0.4) > 0.3, 'signal above threshold passes')
  ok(rms(out, SR * 0.8) < 0.0005, `floor gated (${rms(out, SR * 0.8).toExponential(1)})`)
})

test('dehum: notches mains fundamental + harmonics, preserves program', async () => {
  let n = SR, ch = new Float32Array(n)
  for (let i = 0; i < n; i++) ch[i] = 0.5 * Math.sin(2 * Math.PI * 440 * i / SR)
    + 0.2 * Math.sin(2 * Math.PI * 50 * i / SR) + 0.1 * Math.sin(2 * Math.PI * 150 * i / SR)
  let a = audio.from([ch], { sampleRate: SR })
  let out = (await a.dehum({ freq: 50, harmonics: 4 }).read())[0]
  let mid = out.subarray(SR / 4, (3 * SR) / 4)  // skip filter settle
  let dry = ch.subarray(SR / 4, (3 * SR) / 4)
  ok(energyAt(mid, 50) < energyAt(dry, 50) * 0.1, `50Hz hum removed (${(energyAt(mid, 50) / energyAt(dry, 50)).toFixed(3)}×)`)
  ok(energyAt(mid, 150) < energyAt(dry, 150) * 0.1, '3rd harmonic removed')
  ok(energyAt(mid, 440) > energyAt(dry, 440) * 0.9, 'program at 440Hz preserved')
})

// ── Latency compensation (plugin delay compensation) ──────────────────

test('declared latency compensates to identity', async () => {
  const L = 300
  const latdelay = (ctx) => {
    let bufs = []
    for (let c = 0, N = ctx.maxChannels ?? 8; c < N; c++) bufs.push({ b: new Float32Array(L), i: 0 })
    return (inputs, outputs) => {
      let inp = inputs[0], out = outputs[0]
      for (let c = 0; c < inp.length; c++) {
        let st = bufs[c], x = inp[c], y = out[c]
        for (let i = 0; i < x.length; i++) { y[i] = st.b[st.i]; st.b[st.i] = x[i]; st.i = (st.i + 1) % L }
      }
    }
  }
  latdelay.params = {}
  latdelay.latency = L
  audio.use(latdelay)

  let dry = tone(440, 0.5)
  let out = (await audio.from([dry.slice()], { sampleRate: SR }).latdelay().read())[0]
  is(out.length, dry.length, 'length preserved')
  let d = 0
  for (let i = 0; i < dry.length; i++) d = Math.max(d, Math.abs(out[i] - dry[i]))
  ok(d < 1e-7, `read compensated to identity (${d.toExponential(1)})`)

  let seg = (await audio.from([dry.slice()], { sampleRate: SR }).latdelay().read({ at: 0.1, duration: 0.2 }))[0]
  let ref = dry.subarray(Math.round(0.1 * SR), Math.round(0.3 * SR))
  let d2 = 0
  for (let i = 0; i < ref.length; i++) d2 = Math.max(d2, Math.abs(seg[i] - ref[i]))
  ok(d2 < 1e-7, `ranged read aligned (${d2.toExponential(1)})`)

  let a2 = audio.from([dry.slice()], { sampleRate: SR }).latdelay()
  let total = 0, d3 = 0, pos = 0
  for await (let c of a2.stream()) {
    for (let i = 0; i < c[0].length; i++) d3 = Math.max(d3, Math.abs(c[0][i] - dry[pos + i]))
    pos += c[0].length; total += c[0].length
  }
  is(total, dry.length, 'stream length preserved')
  ok(d3 < 1e-7, `stream compensated (${d3.toExponential(1)})`)
})

// ── Wave B continued: limiter (declared latency), deesser, softclip ───

import { limiter } from '@audio/dynamics-limiter/audio'
import { deesser } from '@audio/dynamics-deesser/audio'
import { softclip } from '@audio/dynamics-softclip/audio'
audio.use(limiter, deesser, softclip)

test('limiter: brickwall under ceiling, latency-compensated onset', async () => {
  let a = audio.from([tone(440, 0.5, 1.0)], { sampleRate: SR })
  let out = (await a.limiter({ ceiling: -6, lookahead: 5 }).read())[0]
  is(out.length, Math.round(0.5 * SR), 'length preserved (latency compensated)')
  let peak = 0
  for (let i = 0; i < out.length; i++) peak = Math.max(peak, Math.abs(out[i]))
  ok(20 * Math.log10(peak) < -5.9, `peak under ceiling (${(20 * Math.log10(peak)).toFixed(2)} dB)`)
  // onset aligned: energy present within the first millisecond
  ok(rms(out, 0, Math.round(0.001 * SR)) > 0.05, 'onset not delayed by lookahead')
})

test('limiter truePeak: the waveform between samples held at the ceiling, its 96 samples of delay compensated', async () => {
  // a sine at fs/4, 45° on: samples at ±0.707 of a peak of 1 (ITU-R BS.1770 Annex 2); quadrature samples give its amplitude
  let n = SR / 2, x = Float32Array.from({ length: n }, (_, i) => Math.sin(Math.PI * i / 2 + Math.PI / 4))
  let amp = y => 20 * Math.log10(Math.hypot(y[n / 2], y[n / 2 + 1]))
  let sp = (await audio.from([x], { sampleRate: SR }).limiter({ ceiling: -1 }).read())[0]
  let tp = (await audio.from([x], { sampleRate: SR }).limiter({ ceiling: -1, truePeak: true }).read())[0]
  ok(Math.abs(amp(sp)) < 1e-4, `sample peak: ${amp(sp).toFixed(4)} dBTP`)
  ok(amp(tp) <= -1 + 1e-4 && amp(tp) > -1.05, `true peak: ${amp(tp).toFixed(4)} dBTP`)
  let click = new Float32Array(n); click[1000] = 0.1
  let y = (await audio.from([click], { sampleRate: SR }).limiter({ truePeak: true }).read())[0]
  is(y.indexOf(Math.max(...y)), 1000, 'aligned')
})

test('deesser: sibilance-keyed broadband reduction, inactive without sibilance', async () => {
  // kernel design: bandpass sidechain drives BROADBAND gain reduction
  let n = SR, ch = new Float32Array(n)
  for (let i = 0; i < n; i++) ch[i] = 0.3 * Math.sin(2 * Math.PI * 300 * i / SR) + 0.4 * Math.sin(2 * Math.PI * 7000 * i / SR)
  let out = (await audio.from([ch.slice()], { sampleRate: SR }).deesser({ freq: 7000, threshold: -30, ratio: 8 }).read())[0]
  let mid = out.subarray(SR / 4, (3 * SR) / 4), dry = ch.subarray(SR / 4, (3 * SR) / 4)
  ok(energyAt(mid, 7000) < energyAt(dry, 7000) * 0.7, `sibilance reduced (${(energyAt(mid, 7000) / energyAt(dry, 7000)).toFixed(2)}×)`)

  // no sibilance in the keyed band → no reduction at all
  let low = new Float32Array(n)
  for (let i = 0; i < n; i++) low[i] = 0.3 * Math.sin(2 * Math.PI * 300 * i / SR)
  let out2 = (await audio.from([low.slice()], { sampleRate: SR }).deesser({ freq: 7000, threshold: -30, ratio: 8 }).read())[0]
  let m2 = out2.subarray(SR / 4, (3 * SR) / 4), d2 = low.subarray(SR / 4, (3 * SR) / 4)
  ok(energyAt(m2, 300) > energyAt(d2, 300) * 0.95, 'no sibilance → signal untouched')
})

test('softclip: bounded by ceiling, enum curve validated', async () => {
  let out = (await audio.from([tone(440, 0.2, 1.0)], { sampleRate: SR }).softclip({ curve: 'hard', drive: 4, ceiling: 0.5 }).read())[0]
  ok(out.every(v => Math.abs(v) <= 0.5 + 1e-6), 'hard curve clamps at ceiling')
  // a value the enum does not declare is refused at the call (CONTRACT.md § What a host owes, 2); it fell back to the
  // default and rendered
  let err = null
  try { audio.from([tone(440, 0.2, 1.0)], { sampleRate: SR }).softclip({ curve: 'nope' }) } catch (e) { err = e }
  is(err?.message, "softclip: curve takes 'tanh', 'atan', 'cubic', 'sin' or 'hard', not 'nope'", 'an unknown enum value: refused at the call, naming its values')
})

// ── Dynamics wave: expander, compand, leveler, transient-shaper, ducker ───
// Not yet published to npm — import via the sibling @audio/dynamics checkout;
// switch to '@audio/dynamics-<atom>/audio' after next publish.
import { expander } from '@audio/dynamics-expander/audio'
import { compand } from '@audio/dynamics-compand/audio'
import { leveler } from '@audio/dynamics-leveler/audio'
import { transientShaper } from '@audio/dynamics-transient-shaper/audio'
import { ducker } from '@audio/dynamics-ducker/audio'
audio.use(expander, compand, leveler, transientShaper, ducker)

const db = (lin) => 20 * Math.log10(Math.max(lin, 1e-12))

// 0.2.x expander: range is a magnitude (≥0), sign applied by mode — was signed in 0.1.x
test('expander: attenuates below threshold, passes material above it', async () => {
  let loud = tone(440, 0.6, 0.5), quiet = tone(440, 0.6, 0.003)
  let combined = new Float32Array([...loud, ...quiet])
  let out = (await audio.from([combined], { sampleRate: SR }).expander({ threshold: -30, ratio: 2, range: 40 }).read())[0]
  ok(out.every(isFinite))
  let settle = Math.round(0.3 * SR)
  let loudDrop = db(rms(loud, settle)) - db(rms(out, settle, loud.length))
  let quietDrop = db(rms(quiet, settle)) - db(rms(out, loud.length + settle))
  ok(quietDrop > loudDrop + 6, `quiet parts attenuated well past loud (${quietDrop.toFixed(1)} dB vs ${loudDrop.toFixed(1)} dB)`)
})

test('compand: transfer curve pulls loud material down, leaves quiet identity segment untouched', async () => {
  let loud = tone(1000, 1.5, 0.9), quiet = tone(1000, 1.5, 0.03)
  let combined = new Float32Array([...loud, ...quiet])
  let out = (await audio.from([combined], { sampleRate: SR }).compand({ out0: -90, out1: -60, out2: -20, out3: -8, attack: 5, release: 200 }).read())[0]
  ok(out.every(isFinite))
  let settle = Math.round(1.0 * SR)
  let loudDelta = db(rms(out, settle, loud.length)) - db(rms(loud, settle))
  let quietDelta = db(rms(out, loud.length + settle)) - db(rms(quiet, settle))
  ok(loudDelta < -3, `loud (near 0dB, above the -20dB knee) pulled toward -8dB (delta ${loudDelta.toFixed(2)} dB)`)
  ok(Math.abs(quietDelta) < 1, `quiet (below -20dB) identity segment unchanged (delta ${quietDelta.toFixed(2)} dB)`)
})

test('leveler: loud/quiet sections converge in RMS toward target loudness', async () => {
  // Hosted whole-render: the manifest declares `streaming: false`, so the engine
  // materializes the timeline and calls process() once with the full signal
  // (core.js whole() dispatch) — the shape the kernel's cross-frame gaussian
  // smoothing needs. Steady-tone convergence here; the time-varying case that
  // per-block hosting could not level is covered in the engine-hosting block below.
  let loud = tone(440, 10, 0.5), quiet = tone(440, 10, 0.006)
  let combined = new Float32Array([...loud, ...quiet])
  // gate 40: the quiet tone, 38 dB under, is a quiet voice to lift, not a pause to hold (the default gate is 20 dB)
  let out = (await audio.from([combined], { sampleRate: SR }).leveler({ target: -20, frame: 0.5, maxGain: 12, smooth: 5, gate: 40 }).read())[0]
  ok(out.every(isFinite))
  let margin = Math.round(3 * SR)
  let gapBefore = Math.abs(db(rms(loud, 0, loud.length - margin)) - db(rms(quiet, margin)))
  let gapAfter = Math.abs(db(rms(out, 0, loud.length - margin)) - db(rms(out, loud.length + margin)))
  ok(gapAfter < gapBefore * 0.5, `RMS gap narrows toward target loudness (${gapBefore.toFixed(1)} -> ${gapAfter.toFixed(1)} dB)`)
})

test('transient-shaper: attackGain raises crest factor (attack emphasis)', async () => {
  let hitLen = Math.round(0.05 * SR), nHits = 20
  let burst = new Float32Array(hitLen * nHits)
  for (let h = 0; h < nHits; h++) {
    let base = h * hitLen, tLen = Math.round(0.002 * SR)
    for (let i = 0; i < hitLen; i++) burst[base + i] = (i < tLen ? 1.0 : 0.25) * Math.sin(2 * Math.PI * 1000 * i / SR)
  }
  // prime with 300ms of steady tone: the kernel's transient = envFast/envSlow-derived
  // ratio is unbounded and spikes hugely from a true cold start (both envelopes at 0);
  // priming keeps the measurement in the kernel's normal operating regime — see
  // audio.js's header comment for the underlying kernel defect.
  let prime = tone(1000, 0.3, 0.25)
  let full = new Float32Array([...prime, ...burst])
  let out0 = (await audio.from([full.slice()], { sampleRate: SR })['transient-shaper']({ attackGain: 0, sustainGain: 0 }).read())[0]
  let out1 = (await audio.from([full.slice()], { sampleRate: SR })['transient-shaper']({ attackGain: 2, sustainGain: 0 }).read())[0]
  ok(out0.every(isFinite) && out1.every(isFinite))
  let crest = d => { let p = 0, s = 0; for (let i = 0; i < d.length; i++) { let a = Math.abs(d[i]); if (a > p) p = a; s += d[i] * d[i] }; return p / Math.sqrt(s / d.length) }
  let c0 = crest(out0.subarray(prime.length)), c1 = crest(out1.subarray(prime.length))
  ok(c1 > c0, `attack emphasis raises crest factor (${c0.toFixed(2)} -> ${c1.toFixed(2)})`)
})

test('ducker: self-keyed fallback engages when the host feeds only the main bus', async () => {
  // The manifest declares a real two-bus sidechain ({ inputs: [2,2], outputs: [2] })
  // per CONTRACT §channels. When the chain passes no `key`, the host feeds bus 1
  // as undefined (core.js: `st.process([input, undefined], ...)`) — this exercises
  // the documented fallback: keys off the main signal itself instead of crashing.
  // True key-bus routing is covered in the engine-hosting block below.
  let main = tone(220, 0.5, 0.9)
  let out = (await audio.from([main], { sampleRate: SR }).ducker({ threshold: -30, ratio: 4 }).read())[0]
  ok(out.every(isFinite))
  let settle = Math.round(0.1 * SR)
  ok(db(rms(out, settle)) < db(rms(main, settle)) - 3, `self-keyed reduction engages (${db(rms(out, settle)).toFixed(1)} dB)`)
})

// ── Engine hosting: streaming:false (whole-render) + sidechain key bus ──
// (leveler/ducker imported + registered in the wave-2 block above)

test('whole-render hosting: leveler converges time-varying levels (streaming:false)', async () => {
  // loud 1s then quiet 1s — exactly what per-block hosting could not level
  let n = 2 * SR, ch = new Float32Array(n)
  for (let i = 0; i < SR; i++) ch[i] = 0.5 * Math.sin(2 * Math.PI * 330 * i / SR)
  for (let i = SR; i < n; i++) ch[i] = 0.02 * Math.sin(2 * Math.PI * 330 * i / SR)
  let a = audio.from([ch.slice()], { sampleRate: SR })
  // gate 40: the quiet second, 28 dB under, is a quiet voice to lift, not a pause to hold (the default gate is 20 dB)
  let out = (await a.leveler({ maxGain: 30, frame: 0.1, smooth: 2, gate: 40 }).read())[0]
  is(out.length, n, 'length preserved')
  let gap0 = 20 * Math.log10(rms(ch, SR * 0.2, SR * 0.8) / rms(ch, SR * 1.2, SR * 1.8))
  let gap1 = 20 * Math.log10(rms(out, SR * 0.2, SR * 0.8) / rms(out, SR * 1.2, SR * 1.8))
  ok(gap1 < gap0 - 10, `level gap narrowed ${gap0.toFixed(1)}dB → ${gap1.toFixed(1)}dB`)
  ok(out.every(isFinite))

  // whole-render composes: ops after it apply to the materialized result
  let b = audio.from([ch.slice()], { sampleRate: SR })
  b.leveler({ maxGain: 30, frame: 0.1, smooth: 2, gate: 40 }).gain(-6)
  let out2 = (await b.read())[0]
  almost(rms(out2, SR * 0.2, SR * 0.8), rms(out, SR * 0.2, SR * 0.8) * 10 ** (-6 / 20), 1e-3, 'post-op applies to materialized output')
  b.undo(); b.undo()
  is(b.duration, 2, 'undo unwinds whole-render edit')
})

test('sidechain key bus: ducker ducks under the key, recovers after', async () => {
  let n = Math.round(1.5 * SR)
  let main = new Float32Array(n)
  for (let i = 0; i < n; i++) main[i] = 0.4 * Math.sin(2 * Math.PI * 440 * i / SR)
  let key = new Float32Array(n)
  for (let i = Math.round(0.5 * SR); i < SR; i++) key[i] = 0.8 * Math.sin(2 * Math.PI * 220 * i / SR)

  let a = audio.from([main.slice(), main.slice()], { sampleRate: SR })
  let k = audio.from([key, key], { sampleRate: SR })
  a.ducker({ key: k, threshold: -30, ratio: 8, range: -40, attack: 5, release: 50 })
  let out = (await a.read())[0]
  let before = rms(out, SR * 0.1, SR * 0.4)
  let during = rms(out, SR * 0.6, SR * 0.9)
  let after = rms(out, Math.round(1.25 * SR), Math.round(1.45 * SR))
  ok(during < before * 0.25, `ducked under key (${(20 * Math.log10(during / before)).toFixed(1)}dB)`)
  ok(after > before * 0.7, `recovers after key (${(20 * Math.log10(after / before)).toFixed(1)}dB)`)
  // the key is a keyed op's first argument: a.ducker(voice, opts) ≡ a.ducker({ key: voice, ...opts }); it once
  // landed on the first number, threshold, and nothing ducked
  let positional = (await audio.from([main.slice(), main.slice()], { sampleRate: SR }).ducker(k, { threshold: -30, ratio: 8, range: -40, attack: 5, release: 50 }).read())[0]
  ok(positional.every((v, i) => v === out[i]), 'ducker(key, opts) ≡ ducker({ key, ...opts })')
})

// A whole-render keyed module (streaming: false) reads its key bus whole too: here, the input less the key
test('sidechain key bus: a whole-render module gets the key over its whole length', async () => {
  const keyLess = () => (inputs, outputs) => {
    let [x, k] = inputs, y = outputs[0]
    for (let c = 0; c < y.length; c++) for (let i = 0; i < y[c].length; i++) y[c][i] = x[c][i] - (k?.[c % k.length]?.[i] ?? 0)
  }
  keyLess.channels = { inputs: [1, 1], outputs: [1] }
  keyLess.streaming = false
  keyLess.params = { amount: { type: 'number', min: 0, max: 1, default: 1 } }
  audio.use(keyLess)
  let n = SR, x = Float32Array.from({ length: n }, (_, i) => Math.sin(i / 9)), k = Float32Array.from({ length: n }, (_, i) => 0.25 * Math.sin(i / 31))
  let [y] = await audio.from([x], { sampleRate: SR })['key-less'](audio.from([k], { sampleRate: SR })).read()
  ok(y.every((v, i) => Math.abs(v - (x[i] - k[i])) < 1e-6), 'the key, whole, under the input')
  let [z] = await audio.from([x], { sampleRate: SR })['key-less']().read()
  ok(z.every((v, i) => v === x[i]), 'no key: none taken')
})

// Renamed params (contract §Parameter metadata `alias`): the new name drives the op, and
// the former name, kept as `alias`, still does, identically, through the host.
import { defeedback } from '@audio/defeedback/audio'
import { exciter as exciterAtom } from '@audio/effect-exciter/audio'
import { subbass as subbassAtom } from '@audio/effect-subbass/audio'
import { sbr as sbrAtom } from '@audio/effect-sbr/audio'
import { toBatch } from '../batch.js'
import { execFileSync } from 'node:child_process'

audio.use(defeedback, exciterAtom, subbassAtom, sbrAtom)

test('renamed params: new names work, former names (alias) give identical output', async () => {
  let src = () => { let d = tone(220, 0.5, 0.4); for (let i = 0; i < d.length; i++) d[i] += 0.3 * Math.sin(2 * Math.PI * 6800 * i / SR); return d }
  let run = async (op, opts) => (await audio.from([src()], { sampleRate: SR })[op](opts).read())[0]
  let same = (a, b) => a.length === b.length && a.every((v, i) => v === b[i])
  for (let [op, now, was, dflt] of [
    ['deesser', { mode: 'band', fc: 6800, Q: 3, threshold: -40 }, { mode: 'band', freq: 6800, q: 3, threshold: -40 }, { mode: 'band', threshold: -40 }],
    ['exciter', { fc: 1200, amount: 0.8 }, { freq: 1200, amount: 0.8 }, { amount: 0.8 }],
    ['subbass', { fc: 150, amount: 0.8 }, { freq: 150, amount: 0.8 }, { amount: 0.8 }],
    ['sbr', { fc: 4000, amount: 0.8 }, { cutoff: 4000, amount: 0.8 }, { amount: 0.8 }],
    ['defeedback', { Q: 60 }, { q: 60 }, {}],
  ]) {
    let a = await run(op, now), b = await run(op, was), c = await run(op, dflt)
    ok(same(a, b), `${op}: ${Object.keys(was)[0]} ≡ ${Object.keys(now)[0]}`)
    if (op !== 'defeedback') ok(!same(a, c), `${op}: ${Object.keys(now)[0]} changes the sound`)
  }
  // engine-free host too
  let x = src()
  let viaNew = toBatch(deesser)(x, { params: { fc: 6800, Q: 3, threshold: -40 }, sampleRate: SR })
  let viaOld = toBatch(deesser)(x, { params: { freq: 6800, q: 3, threshold: -40 }, sampleRate: SR })
  ok(same(viaNew, viaOld), 'toBatch: freq/q ≡ fc/Q')
})

test('filter ops: Q, and the former q still read', async () => {
  let x = tone(1000, 0.3, 0.5)
  for (let op of ['eq', 'bandpass', 'notch', 'lowshelf']) {
    let args = op === 'eq' || op === 'lowshelf' ? { freq: 1000, gain: -6 } : { freq: 1000 }
    let a = (await audio.from([x.slice()], { sampleRate: SR })[op]({ ...args, Q: 4 }).read())[0]
    let b = (await audio.from([x.slice()], { sampleRate: SR })[op]({ ...args, q: 4 }).read())[0]
    let c = (await audio.from([x.slice()], { sampleRate: SR })[op](args).read())[0]
    ok(a.every((v, i) => v === b[i]), `${op}: q ≡ Q`)
    ok(a.some((v, i) => Math.abs(v - c[i]) > 1e-6), `${op}: Q shapes the filter`)
  }
  let pos = (await audio.from([x.slice()], { sampleRate: SR }).bandpass(1000, 4).read())[0]
  let named = (await audio.from([x.slice()], { sampleRate: SR }).bandpass({ freq: 1000, Q: 4 }).read())[0]
  ok(pos.every((v, i) => v === named[i]), 'positional (freq, Q) ≡ named')
})

// Layout tags (contract § Channels), declared as @audio/spatial-ambisonic declares them from 1.0, a choice of layouts as
// one bus `[{ layouts: [...] }]`: widths follow the resolved layout, the factory sees ctx.layouts, and a `layouts`
// option picks among the declared ones. The same declared as lists of tags, the form manifests published before 1.0
// carry (@audio/spatial-ambisonic 0.1.0, as audio installs it), is hosted alike
let built = []
const AMBI = ['ambisonic-1', 'ambisonic-2', 'ambisonic-3'], SPEAKERS = ['stereo', 'quad', '5.1', '7.1']
function layoutEncode(ctx) {
  built.push(ctx.layouts)
  return (inputs, outputs) => { for (let c = 0; c < outputs[0].length; c++) outputs[0][c].set(inputs[0][0]) }
}
layoutEncode.channels = { inputs: 1, outputs: [{ layouts: AMBI }] }
layoutEncode.params = {}
function layoutDecode(ctx) {
  built.push(ctx.layouts)
  return (inputs, outputs) => { for (let c = 0; c < outputs[0].length; c++) outputs[0][c].set(inputs[0][c]) }
}
layoutDecode.channels = { inputs: [{ layouts: AMBI }], outputs: [{ layouts: SPEAKERS }] }
layoutDecode.params = {}
audio.use(layoutEncode, layoutDecode)
audio.op('layout-encode-0', Object.assign(ctx => layoutEncode(ctx), { params: {}, channels: { inputs: 1, outputs: AMBI } }))
audio.op('layout-decode-0', Object.assign(ctx => layoutDecode(ctx), { params: {}, channels: { inputs: AMBI, outputs: SPEAKERS } }))

test('use(module) hosts declared layouts: mono → ambisonic → speakers; lists of tags, as before 1.0, alike', async () => {
  let x = tone(440, 0.5)
  for (let [encode, decode] of [['layout-encode', 'layout-decode'], ['layout-encode-0', 'layout-decode-0']]) {
    let enc = await audio.from([x], { sampleRate: SR })[encode]().read()
    is(enc.length, 4, `${encode}: first order by default`)
    ok(enc.every(c => c.every((v, i) => v === x[i])), 'every channel written')
    is(built.at(-1), { inputs: [undefined], outputs: ['ambisonic-1'] })
    is((await audio.from([x], { sampleRate: SR })[encode]({ layouts: { outputs: ['ambisonic-2'] } }).read()).length, 9, 'second order chosen')
    let dec = await audio.from([x], { sampleRate: SR })[encode]()[decode]().read()
    is(dec.length, 2, `${decode}: decoded to stereo`)
    is(built.at(-1), { inputs: ['ambisonic-1'], outputs: ['stereo'] })
  }
})

// One op to a name. A built-in's is not a processor's to take (effect-gain's `gain`, in dB, over the built-in gain;
// pitch-yin's analyzer over the pitch shifter): the error says how to register it under another, which audio.op does. A
// processor registered under its id before gives way to a new one: a script run again in the editor defines its
// processor again. The same one again is there already. An instance method's name (read, save, clone) no call could
// reach, and one with neither an id nor a function name has no name a call can mean: both throw
test('use(module): a built-in\'s name throws, saying how to register it under another; a processor\'s is replaced; the same one again is a no-op', async () => {
  let pass = (inputs, outputs) => { for (let c = 0; c < outputs[0].length; c++) outputs[0][c].set(inputs[0][c]) }
  function gain() { return pass }
  gain.channels = 'any'
  gain.params = { dB: { type: 'number', min: -60, max: 24, default: 0, unit: 'dB' } }
  let err = null
  try { audio.use(gain) } catch (e) { err = e }
  ok(err?.message.includes(`'gain' is a built-in op; register this processor under another name: audio.op('my-gain', processor)`), `a built-in's name: ${err?.message}`)
  is(audio.op('gain').params, ['value'], 'the built-in gain is the one called')
  ok(!audio.op('gain').plugin, 'not the processor')
  audio.op('my-gain', gain)
  is(audio.op('my-gain').plugin, gain, 'audio.op(name, processor): hosted under the name given')
  let x = tone(440, 0.05)
  ok((await audio.from([x], { sampleRate: SR })['my-gain']().read())[0].every((v, i) => v === x[i]), 'and called by it')

  for (let take = 0; take < 2; take++) {
    let again = () => (inputs, outputs) => { for (let c = 0; c < outputs[0].length; c++) outputs[0][c].fill(take + 1) }
    again.id = 'freeverb'
    again.channels = 'any'
    again.params = {}
    audio.use(again)
    is(audio.op('freeverb').plugin, again, `another processor under freeverb's id replaces it, take ${take + 1}`)
    is((await audio.from([x], { sampleRate: SR }).freeverb().read())[0][0], take + 1, 'and is the one called')
  }
  audio.use(freeverb)
  is(audio.op('freeverb').plugin, freeverb, 'and the first back again')

  let before = audio.op('compressor')
  audio.use(compressor)
  await audio.use('compressor')
  is(audio.op('compressor'), before, 'the same processor again, by itself or by its registry name: as it was')

  for (let id of ['read', 'save', 'clone']) {
    let f = Object.assign(() => pass, { id, channels: 'any', params: {} })
    for (let register of [() => audio.use(f), () => audio.op(id, f)]) {
      err = null
      try { register() } catch (e) { err = e }
      ok(err?.message.includes(`'${id}' is an instance method (a.${id}())`), `${id}: ${err?.message}`)
    }
    ok(!audio.op(id), `nothing registered as ${id}`)
  }

  let nameless = [() => pass, () => pass].map(f => Object.assign(f, { channels: 'any', params: {} }))
  for (let f of nameless) {
    err = null
    try { audio.use(f) } catch (e) { err = e }
    ok(/needs an id or a function name/.test(err?.message), 'neither an id nor a name')
  }
  ok(!audio.op('module'), 'nothing registered as "module"')
})

// One stat to a name, by the same rule: a built-in stat's, an op's or an instance method's name throws, saying how to
// register it under another; a stat plugin under a stat plugin's name replaces it
test('use(stat): a built-in stat\'s, an op\'s or a method\'s name throws, saying how; a stat plugin\'s is replaced', async () => {
  for (let [stat, what] of [['rms', 'a built-in stat'], ['gain', 'an op'], ['read', 'an instance method (a.read())']]) {
    let err = null
    try { audio.use({ stat, compute: () => 1 }) } catch (e) { err = e }
    ok(err?.message.includes(`'${stat}' is ${what}; register this stat under another name: audio.use({ ...stat, stat: 'my-${stat}' })`), `${stat}: ${err?.message}`)
  }
  ok(audio.stat('rms').query, 'the built-in rms kept')
  let a = audio.from([new Float32Array(64)], { sampleRate: SR })
  for (let v of [1, 2]) {
    audio.use({ stat: 'probe-stat', compute: () => v })
    is(await a.stat('probe-stat'), v, `take ${v}: the latest is the one asked`)
  }
})

// A whole-signal processor over no samples has nothing to be called with (contract § process: a call's frame count is
// never 0)
test('process is never called with 0 frames: a whole-signal processor over none is not called', async () => {
  let calls = []
  let whole = () => (inputs, outputs) => { calls.push(outputs[0][0].length); for (let c = 0; c < outputs[0].length; c++) outputs[0][c].set(inputs[0][c]) }
  Object.assign(whole, { id: 'whole-probe', channels: 'any', params: {}, streaming: false })
  audio.use(whole)
  is((await audio.from([new Float32Array(0)], { sampleRate: SR })['whole-probe']().read())[0].length, 0, 'no frames out')
  is(calls, [], 'not called')
  await audio.from([new Float32Array(5)], { sampleRate: SR })['whole-probe']().read()
  is(calls, [5], 'called once over 5')
})

// Buffers (contract § Buffers): an option of the buffer's name; a sound is rendered at the op's rate, samples pass as
// they are; a channel count the declaration does not take throws at the call, naming it
test('buffers: a sound rendered at the op\'s rate, samples as they are, none undefined; a count not declared throws', async () => {
  let got = []
  let probe = ctx => { got.push(ctx.buffers.ir); return (inputs, outputs) => { for (let c = 0; c < outputs[0].length; c++) outputs[0][c].set(inputs[0][c]) } }
  Object.assign(probe, { id: 'buffer-probe', channels: 'any', params: {}, buffers: { ir: { channels: [1, 2] } } })
  audio.use(probe)
  let a = () => audio.from([new Float32Array(64)], { sampleRate: SR }), x = Float32Array.from({ length: 8 }, (_, i) => i / 8)
  await a()['buffer-probe']({ ir: audio.from([x], { sampleRate: SR / 2 }) }).read()
  is(got.at(-1).length, 1, 'a sound of 1 channel')
  is(got.at(-1)[0].length, 16, 'at half the rate: twice the frames at the op\'s')
  is(got.at(-1)[0][2], x[1], 'a sample of it, where it lands')
  await a()['buffer-probe']({ ir: x }).read()
  is(got.at(-1), [x], 'a Float32Array: one channel, as it is')
  await a()['buffer-probe']().read()
  is(got.at(-1), undefined, 'none: undefined')
  // an AudioBuffer (a stand-in of its shape: Node has none) has a rate, as a sound has: its channels at the op's rate
  // (its length is its frames, which were counted as its channels: 8 refused, as not 1 or 2)
  let y = Float32Array.from(x, v => -v)
  await a()['buffer-probe']({ ir: { numberOfChannels: 2, length: 8, sampleRate: SR / 2, duration: 16 / SR, getChannelData: c => [x, y][c] } }).read()
  is([got.at(-1).length, got.at(-1)[0].length, got.at(-1)[0][2], got.at(-1)[1][2]], [2, 16, x[1], y[1]], 'an AudioBuffer of 2 channels at half the rate: 2 channels, twice the frames at the op\'s')
  let err = null
  try { a()['buffer-probe']({ ir: [x, x, x] }) } catch (e) { err = e }
  ok(err?.message.includes('buffer-probe: buffer ir has 3 channels, it takes 1 or 2'), `at the call: ${err?.message}`)
  // a sound with an op of its own still to load: counted at the call where the width that op makes is known, and where
  // it renders, its edits loaded then, where it is not (an op with layouts of its own)
  let held = ['widener', 'surround', 'ambisonic-panner'].map(n => [n, audio.op(n)])
  for (let [n] of held) delete audio.op()[n]
  try {
    await a()['buffer-probe']({ ir: audio.from([x], { sampleRate: SR }).widener() }).read()
    is(got.at(-1).length, 2, 'a mono sound through widener: 2 channels')
    err = null
    try { a()['buffer-probe']({ ir: audio.from([x, x], { sampleRate: SR }).surround() }) } catch (e) { err = e }
    ok(err?.message.includes('buffer-probe: buffer ir has 6 channels, it takes 1 or 2'), `through surround, at the call: ${err?.message}`)
    err = await a()['buffer-probe']({ ir: audio.from([x], { sampleRate: SR })['ambisonic-panner']() }).read().then(() => null, e => e)
    ok(err?.message.includes('buffer-probe: buffer ir has 4 channels, it takes 1 or 2'), `through an op whose width is not known before it loads, at the render: ${err?.message}`)
  } finally { for (let [n, d] of held) if (d) audio.op()[n] = d; else delete audio.op()[n] }
})

// Contract § process: "Input bus 0 always carries its channels". A processor that declares a count on bus 0, fed one
// channel, gets it on each, as plugin hosts feed a mono track to a stereo plugin, and the edits after it read its
// output's width; another count it cannot carry is refused at the render, naming both
test('bus 0 of a declared count: one channel copied to each, the width the edits after it read; another count refused', async () => {
  let seen = []
  let swap = () => (inputs, outputs) => { seen.push(inputs[0].length); outputs[0][0].set(inputs[0][1]); outputs[0][1].set(inputs[0][0]) }
  Object.assign(swap, { id: 'swap-probe', params: {}, channels: 2 })
  audio.use(swap)
  let x = tone(440, 0.05), g = 10 ** (-6 / 20)
  let a = audio.from([x], { sampleRate: SR })['swap-probe']().gain(-6)
  is(a.channels, 2, 'stereo from it on')
  let y = await a.read()
  is(y.length, 2, 'the gain after it reads 2 channels')
  ok(y.every(c => c.every((v, i) => Math.abs(v - x[i] * g) < 1e-6)), 'each the mono input, through the gain')
  ok(seen.length && seen.every(n => n === 2), 'bus 0 carried 2 at every call')
  let err = await audio.from([x, x, x], { sampleRate: SR })['swap-probe']().read().then(() => null, e => e)
  ok(err?.message.includes('swap-probe: input bus 0 takes 2 channels, not the 3 that feed it'), `3 refused: ${err?.message}`)
  // a range is taken where the width stays, refused where it changes
  is((await audio.from([x, x], { sampleRate: SR })['swap-probe']({ at: 0.01 }).read()).length, 2, 'a range on 2 channels')
  err = await audio.from([x], { sampleRate: SR })['swap-probe']({ at: 0.01 }).read().then(() => null, e => e)
  ok(/a range keeps the channel count, and this changes it \(1 → 2\)/.test(err?.message), `a range on 1: ${err?.message}`)
  // a published one: @audio/spatial-panner (channels: 2) on a mono sound renders as on two channels of it
  await audio.use('panner')
  let mono = await audio.from([x], { sampleRate: SR }).panner({ pan: -0.5 }).read(), two = await audio.from([x, x], { sampleRate: SR }).panner({ pan: -0.5 }).read()
  is(mono.length, 2, 'panner: stereo from mono')
  ok(mono.every((c, k) => c.every((v, i) => v === two[k][i])), 'panner on 1 channel ≡ panner on 2 of it')
})

// An edit on chosen channels (`channel`) hands its op those alone, in and out: a processor that takes 2 cannot run on a
// choice of 1 (it threw inside the processor at the render, writing a second output it was not given). Refused at the
// call, naming the op, both counts and what to do instead; on a choice of its count it runs
test('a processor of a fixed count on a choice of channels of another count: refused at the call, saying what to do', async () => {
  let x = tone(440, 0.05), z = tone(330, 0.05, 0.5)
  for (let name of ['panner', 'widener', 'haas', 'autopan']) {
    await audio.use(name)
    let a = audio.from([x, z], { sampleRate: SR }), err = null
    try { a[name]({ channel: 0 }) } catch (e) { err = e }
    is(err?.message, `${name}: it takes 2 channels, and channel: 0 chooses 1; an op on chosen channels reads and writes those alone: choose 2 (channel: [0, 1]) or leave channel out`, `${name}: refused at the call`)
    is(a.edits, [], `${name}: no edit made`)
    // a choice of 2 of 4 channels: those through it, the others as they were (not haas: a param of its own is named
    // `channel`, left or right, and takes a choice of channels for its value)
    if (name === 'haas') continue
    let four = await audio.from([x, z, z, x], { sampleRate: SR })[name]({ channel: [2, 3] }).read(), whole = await audio.from([z, x], { sampleRate: SR })[name]().read()
    ok(four.length === 4 && [0, 1].every(c => four[c].every((v, i) => v === ([x, z][c][i] ?? 0))) && [2, 3].every(c => four[c].every((v, i) => v === whole[c - 2][i])), `${name}: on a choice of 2, those 2 as it renders a stereo sound, the rest untouched`)
  }
})

// On a mono sound a processor of 2 channels makes it stereo; a range or a mix keeps the width, so with either it is
// refused, naming the op as written (haas, which has a tail, renders as a hidden op, _haas) and the way through
test('a range or a mix on a mono sound through a processor of 2 channels: refused, naming the op and the way through', async () => {
  let x = tone(440, 0.05)
  for (let name of ['haas', 'panner']) {
    await audio.use(name)
    for (let [opts, why] of [[{ at: 0.01 }, 'a range keeps the channel count, and this changes it'], [{ mix: 0.5 }, 'mix blends the output with the input, and this changes the channel count']]) {
      let err = await audio.from([x], { sampleRate: SR })[name](opts).read().then(() => null, e => e)
      is(err?.message, `${name}: ${why} (1 → 2); make the sound stereo first: a.remix(2)`, `${name} ${JSON.stringify(opts)}`)
    }
    let y = await audio.from([x], { sampleRate: SR }).remix(2)[name]({ at: 0.01, mix: 0.5 }).read()
    ok(y.length === 2 && y.every(c => c.every(Number.isFinite)), `${name}: the way through renders`)
  }
})

// A mic on lena's voice with another stretch of lena (`ref`) bled into it 6 ms late, 10 dB under, half a second of it:
// enough for @audio/denoise-debleed to find the path and take it out (between tones it finds none and passes the mic on)
import raw from 'audio-lena/raw'
const lena = new Float32Array(raw)
const bled = (n = SR / 2) => { let ref = lena.subarray(5 * SR, 5 * SR + n); return { ref, mic: Float32Array.from(lena.subarray(0, n), (v, i) => v + 0.3 * (ref[i - 265] ?? 0)) } }

// A whole-signal processor (streaming: false) renders by another branch of the engine than a streaming one, under the
// same rule: of 2 channels on a mono sound, a range or a mix is refused as a streaming one's is (it rendered 2 channels,
// the range ignored, the mix blended over the width it changed); on the sound made stereo first, the range holds
test('a whole-signal processor of 2 channels on a mono sound: a range or a mix refused as a streaming one\'s; debleed too', async () => {
  let neg = () => (inputs, outputs) => { for (let c = 0; c < 2; c++) for (let i = 0; i < outputs[0][c].length; i++) outputs[0][c][i] = -inputs[0][c][i] }
  Object.assign(neg, { id: 'whole-pair', params: {}, channels: 2, streaming: false })
  audio.use(neg)
  await audio.use('debleed')
  let x = tone(440, 0.05), key = audio.from([tone(220, 0.05)], { sampleRate: SR })
  let range = 'a range keeps the channel count, and this changes it', mix = 'mix blends the output with the input, and this changes the channel count'
  for (let [name, run] of [['whole-pair', (a, o) => a['whole-pair'](o)], ['debleed', (a, o) => a.debleed(key, o)]])
    for (let [opts, why] of [[{ at: 0.01 }, range], [{ duration: 0.02 }, range], [{ mix: 0.5 }, mix]]) {
      let err = await run(audio.from([x], { sampleRate: SR }), opts).read().then(() => null, e => e)
      is(err?.message, `${name}: ${why} (1 → 2); make the sound stereo first: a.remix(2)`, `${name} ${JSON.stringify(opts)}`)
    }
  // made stereo first: the input as it was outside the range, the op's output inside it past the 10 ms crossfades
  let two = await audio.from([x], { sampleRate: SR }).remix(2).read(), y = await audio.from([x], { sampleRate: SR }).remix(2)['whole-pair']({ at: 0.01, duration: 0.03 }).read()
  let a = Math.round(0.01 * SR), b = Math.round(0.04 * SR), mid = Math.round(0.025 * SR)
  ok(y.length === 2 && y.every((c, k) => c.every((v, i) => i >= a && i < b || v === two[k][i]) && c[mid] === -two[k][mid]), 'stereo first: the range holds')
})

// A whole-signal processor on chosen channels is handed those alone, its output written back in place, the others as
// they came, as a streaming one's (an 'any' one processed every channel; one of 2 on 2 of 4 was refused at the read,
// handed all 4); its tail pads the others with silence, as the pad before a streaming one does
test('a whole-signal processor on chosen channels: those alone, written back in place, the others as they came; debleed', async () => {
  let neg = () => (inputs, outputs) => { for (let c = 0; c < outputs[0].length; c++) for (let i = 0; i < outputs[0][c].length; i++) outputs[0][c][i] = -inputs[0][c][i] }
  Object.assign(neg, { id: 'whole-neg', params: {}, channels: 'any', streaming: false, tail: 0.01 })
  let swap = () => (inputs, outputs) => { outputs[0][0].set(inputs[0][1]); outputs[0][1].set(inputs[0][0]) }
  Object.assign(swap, { id: 'whole-swap', params: {}, channels: 2, streaming: false })
  audio.use(neg, swap)
  let x = tone(440, 0.05), z = tone(330, 0.05, 0.5), n = x.length, t = Math.round(0.01 * SR), at = (c, i) => c[i] ?? 0
  let y = await audio.from([x, z], { sampleRate: SR })['whole-neg']({ channel: 1 }).read()
  ok(y.length === 2 && y[0].length === n + t && y[0].every((v, i) => v === at(x, i)) && y[1].every((v, i) => v === -at(z, i)), 'channel 1 alone; channel 0 as it came, the tail\'s silence after it')
  let four = await audio.from([x, z, z, x], { sampleRate: SR })['whole-swap']({ channel: [2, 3] }).read()
  ok(four.length === 4 && [x, z, x, z].every((s, c) => four[c].every((v, i) => v === s[i])), 'a choice of 2 of 4: those through it, the others as they came')
  let r = await audio.from([x, z, z, x], { sampleRate: SR })['whole-swap']({ channel: [2, 3], at: 0.01, duration: 0.03 }).read()
  let a = Math.round(0.01 * SR), b = Math.round(0.04 * SR), mid = Math.round(0.025 * SR)
  ok([x, z, z, x].every((s, c) => r[c].every((v, i) => c > 1 && i >= a && i < b || v === s[i])) && r[2][mid] === x[mid] && r[3][mid] === z[mid], 'and a range: the choice within it alone')
  let err = null
  try { audio.from([x, z], { sampleRate: SR })['whole-swap']({ channel: 0 }) } catch (e) { err = e }
  is(err?.message, 'whole-swap: it takes 2 channels, and channel: 0 chooses 1; an op on chosen channels reads and writes those alone: choose 2 (channel: [0, 1]) or leave channel out', 'a choice of 1: refused at the call')
  // the published debleed on 2 of 4 channels: those as it renders a stereo mic, the others as they came
  await audio.use('debleed')
  let { mic, ref } = bled(), from = chs => audio.from(chs.map(c => c.slice()), { sampleRate: SR })
  let stereo = await from([mic, mic]).debleed(from([ref])).read(), got = await from([ref, ref, mic, mic]).debleed(from([ref]), { channel: [2, 3] }).read()
  ok(stereo.some(c => c.some((v, i) => v !== mic[i])), 'debleed takes the bleed out here')
  ok(got.length === 4 && [0, 1].every(c => got[c].every((v, i) => v === ref[i])) && [2, 3].every(c => got[c].every((v, i) => v === stereo[c - 2][i])), 'debleed on 2 of 4: those as on a stereo mic, the others as they came')
})

// A streaming edit on chosen channels with a range leaves the others bit for bit, as without one: the range's 10 ms seams
// crossfade the chosen channels alone (they crossfaded every channel, at a power that made one that was its own input up
// to 1.155 times as loud at each edge); an op with latency (the limiter's true peak) the same
test('a range on chosen channels: the others bit for bit at its edges too; the chosen as on a sound of their own', async () => {
  let q = [440, 330, 550, 220].map(f => tone(f, 0.1, 0.4)), from = chs => audio.from(chs.map(c => c.slice()), { sampleRate: SR })
  for (let [name, f] of [
    ['lowpass', (a, o) => a.lowpass(800, o)],
    ['compressor', (a, o) => a.compressor({ threshold: -30, ratio: 6, ...o })],
    ['limiter', (a, o) => a.limiter({ ceiling: -12, truePeak: true, ...o })],
  ]) for (let range of [{ at: 0.02, duration: 0.03 }, { at: 0.02, duration: 0.03, mix: 0.4 }]) {
    let y = await f(from(q), { channel: [2, 3], ...range }).read(), two = await f(from([q[2], q[3]]), range).read()
    ok([0, 1].every(c => y[c].every((v, i) => v === q[c][i])), `${name} ${JSON.stringify(range)}: channels 0 and 1 as they came`)
    ok([2, 3].every(c => y[c].every((v, i) => v === two[c - 2][i])), `${name} ${JSON.stringify(range)}: 2 and 3 as on a sound of their own`)
  }
})

// An op made ahead of the render over its whole input (declip, auto, dereverb: plan.js prepared) given a channel the
// sound lacks says so, as every other op does (it threw a TypeError from inside, reading the channel that is not there)
test('an op prepared ahead on a channel the sound lacks: the message every op gives', async () => {
  let x = tone(440, 0.1, 0.4)
  await audio.use('declip')
  for (let [name, f, chs, channel] of [['declip', a => a.declip({ channel: [0, 1] }), 1, 1], ['auto', a => a.auto({ channel: [0, 1] }), 1, 1], ['dereverb', a => a.dereverb({ channel: [0, 1] }), 1, 1], ['declip', a => a.declip({ channel: 2 }), 2, 2]]) {
    let err = await f(audio.from(Array.from({ length: chs }, () => x.slice()), { sampleRate: SR })).read().then(() => null, e => e)
    is(err?.message, `channel ${channel}: the audio has ${chs} channel${chs === 1 ? '' : 's'}`, `${name} on ${chs}: channel ${channel}`)
  }
})

// A processor with no input bus (a generator) on chosen channels writes what it makes into them, the others as they
// came, streaming or whole (a streaming one's stage was sized to its one channel, and the engine threw copying the
// other channel into it; a whole one ignored the choice); a choice of another count is refused, saying what it makes
// (it said it took the count chosen)
test('a generator on chosen channels: what it makes in those, the others as they came; another count refused', async () => {
  let x = tone(440, 0.05), z = tone(330, 0.05, 0.5)
  for (let streaming of [true, false]) {
    let id = streaming ? 'gen-probe' : 'gen-whole', gen = () => (inputs, outputs) => { outputs[0][0].fill(0.25) }
    Object.assign(gen, { id, params: {}, channels: { inputs: [], outputs: [1] }, streaming })
    audio.use(gen)
    let a = audio.from([x, z], { sampleRate: SR })[id]({ channel: 1 })
    is(a.channels, 2, `${id}: the width kept`)
    let y = await a.read()
    ok(y.length === 2 && y[0].every((v, i) => v === x[i]) && y[1].every(v => v === 0.25), `${id}: channel 1 what it makes, channel 0 as it came`)
    is((await audio.from([x, z], { sampleRate: SR })[id]().read()).length, 1, `${id}, no choice: its one channel`)
    let err = null
    try { audio.from([x, z], { sampleRate: SR })[id]({ channel: [0, 1] }) } catch (e) { err = e }
    is(err?.message, `${id}: it makes 1 channel, and channel: [0,1] chooses 2; an op on chosen channels reads and writes those alone: choose 1 (channel: [0]) or leave channel out`, `${id}: a choice of 2 refused at the call`)
  }
  // the published osc as the probe
  await audio.use('osc')
  let [sine] = await audio.from([x], { sampleRate: SR }).osc().read(), o = await audio.from([x, z], { sampleRate: SR }).osc({ channel: 0 }).read()
  ok(o.length === 2 && o[0].every((v, i) => v === sine[i]) && o[1].every((v, i) => v === z[i]), 'osc on channel 0: its tone there, channel 1 as it came')
})

// On a choice a generator keeps the sound's width, so a range or a mix is taken at the call as at the render (the call
// refused both as for an op that changes the width, while the same edit through a.run rendered the range)
test('a generator on chosen channels takes a range and a mix: the method as a.run', async () => {
  let x = tone(440, 0.1, 0.3), z = tone(330, 0.1, 0.2), from = () => audio.from([x.slice(), z.slice()], { sampleRate: SR })
  await audio.use('osc')
  let [sine] = await audio.from([x], { sampleRate: SR }).osc().read(), a = Math.round(0.02 * SR), b = Math.round(0.05 * SR)
  for (let o of [{ channel: 0, at: 0.02, duration: 0.03 }, { channel: 0, mix: 0.4 }, { channel: 1, at: 0.02, duration: 0.03, mix: 0.4 }]) {
    let y = await from().osc(o).read(), r = await from().run(['osc', o]).read(), c = o.channel, mine = [x, z][c]
    ok(y.length === 2 && y.every((ch, k) => ch.every((v, i) => v === r[k][i])), `${JSON.stringify(o)}: the method ≡ a.run`)
    ok(y[1 - c].every((v, i) => v === [x, z][1 - c][i]), `${JSON.stringify(o)}: channel ${1 - c} as it came`)
    if (o.at == null) ok(y[c].every((v, i) => Math.abs(v - (0.4 * sine[i] + 0.6 * mine[i])) < 1e-6), `${JSON.stringify(o)}: 0.4 of the tone, 0.6 of the input`)
    else ok(y[c].every((v, i) => i >= a && i < b || v === mine[i]), `${JSON.stringify(o)}: the input outside the range`)
  }
})

// Where a processor cannot write a choice back in place, the choice is refused at the call: isolate and debleed take 2
// channels (on a choice of 1, this morning, isolate rendered the input as it was, debleed the whole sound as if nothing
// was chosen), surround makes 6 of 2 (its choice was ignored). A processor with a `mix` of its own blends inside itself
// at its own width, so on a mono sound it takes one (pingpong, microshift, binaural), rendering as on two channels of it
test('a choice that cannot be written back in place refused at the call; a mix of its own taken on a mono sound', async () => {
  let x = tone(440, 0.05), z = tone(330, 0.05, 0.5)
  for (let [name, channel] of [['isolate', 0], ['debleed', 0], ['surround', 0], ['surround', [0, 1]]]) {
    await audio.use(name)
    let a = audio.from([x, z], { sampleRate: SR }), err = null, k = [channel].flat().length
    try { a[name]({ channel }) } catch (e) { err = e }
    is(err?.message, name === 'surround' ? `surround: it takes 2 channels and makes 6, and channel: ${JSON.stringify(channel)} chooses ${k}; an op on chosen channels reads and writes those alone: leave channel out` : `${name}: it takes 2 channels, and channel: 0 chooses 1; an op on chosen channels reads and writes those alone: choose 2 (channel: [0, 1]) or leave channel out`, `${name}, channel: ${JSON.stringify(channel)}`)
    is(a.edits, [], `${name}: no edit made`)
  }
  for (let name of ['pingpong', 'microshift', 'binaural']) {
    await audio.use(name)
    let mono = await audio.from([x], { sampleRate: SR })[name]({ mix: 0.3 }).read(), two = await audio.from([x, x], { sampleRate: SR })[name]({ mix: 0.3 }).read()
    ok(mono.length === 2 && mono.every((c, k) => c.length === two[k].length && c.every((v, i) => v === two[k][i])), `${name}: its own mix on a mono sound ≡ on two channels of it`)
  }
})

// A registry op called before it loads is recorded as it is and settled at the first read, where it loads: a choice
// of another count is refused there (docs/plugins.md)
test('a registry processor called before it loads: a choice of another count refused at the first read', () => {
  let script = `import audio from './audio.js'; let a = audio.from([new Float32Array(64), new Float32Array(64)], { sampleRate: 44100 }); a.widener({ channel: 0 }); console.log(JSON.stringify(a.edits)); await a.read().then(() => console.log('rendered'), e => console.log(e.message)); process.exit(0)`
  let out = execFileSync(process.execPath, ['--input-type=module', '-e', script], { cwd: new URL('..', import.meta.url), encoding: 'utf8' }).trim().split('\n')
  is(out, ['[["widener",{"channel":0}]]', 'widener: it takes 2 channels, and channel: 0 chooses 1; an op on chosen channels reads and writes those alone: choose 2 (channel: [0, 1]) or leave channel out'], 'recorded at the call, refused at the first read')
})

// A further input bus that declares a count carries it, as bus 0 does: one channel fed is copied to each, another count
// refused, naming both. @audio/dynamics-ducker and @audio/denoise-debleed declare a key of 2 and guard it themselves:
// with none they render as before (the ducker keyed by its main); a key of one is now the same on both channels (the
// ducker's guard keyed its second channel by the main)
test('a further bus of a declared count: one channel copied to each, another refused; ducker and debleed', async () => {
  let seen = [], x = tone(440, 0.05), k = tone(220, 0.05, 0.3), from = chs => audio.from(chs.map(c => c.slice()), { sampleRate: SR })
  let less = () => (inputs, outputs) => { seen.push(inputs[1].length); for (let c = 0; c < 2; c++) for (let i = 0; i < outputs[0][c].length; i++) outputs[0][c][i] = inputs[0][c][i] - inputs[1][c][i] }
  Object.assign(less, { id: 'key-less', params: {}, channels: { inputs: [2, 2], outputs: [2] } })
  audio.use(less)
  let y = await from([x, x])['key-less']({ key: from([k]) }).read()
  ok(y.length === 2 && y.every(c => c.every((v, i) => v === Math.fround(x[i] - k[i]))), 'a key of one: on each channel')
  ok(seen.length && seen.every(n => n === 2), 'bus 1 carried 2 at every call')
  let err = await from([x, x])['key-less']({ key: from([k, k, k]) }).read().then(() => null, e => e)
  ok(err?.message.includes('key-less: input bus 1 takes 2 channels, not the 3 that feed it'), `a key of 3: ${err?.message}`)

  let main = [tone(440, 0.4, 0.4), tone(330, 0.4, 0.3)], burst = Float32Array.from(tone(220, 0.4, 0.8), (v, i) => i > 0.1 * SR && i < 0.25 * SR ? v : 0)
  let duck = o => from(main).ducker({ threshold: -30, ratio: 8, range: -40, attack: 5, release: 50, ...o }).read()
  let same = (p, q) => p.length === q.length && p.every((c, j) => c.every((v, i) => v === q[j][i]))
  ok(same(await duck(), await duck({ key: from(main) })), 'ducker, no key: keyed by its main, as its guard does')
  ok(same(await duck({ key: from([burst]) }), await duck({ key: from([burst, burst]) })), 'ducker, a key of one ≡ that key on both channels')
  await audio.use('debleed')
  let { mic, ref } = bled(), once = await from([mic]).debleed(from([ref])).read()
  ok(once.some(c => c.some((v, i) => v !== mic[i])), 'debleed takes the bleed out here')
  ok(same(once, await from([mic]).debleed(from([ref, ref])).read()), 'debleed, a reference of one ≡ that one on both channels')
  ok(same(await from([mic, mic]).debleed().read(), [mic, mic]), 'debleed, no reference: the mic as it was')
})

// A keyed processor's first argument is its key only where it is a sound, what the key option takes (an audio instance,
// an AudioBuffer, Float32Array[]): a.ducker(voice, -30). Any other is its first param: a.compressor(-30, 8) is threshold
// and ratio on a compressor with a key bus too (it read -30 as the key and threw at the read). The same loaded at the
// call or later (the arguments wait as `args`, a.run's form of them too), under a bus's own name as under `key`
test('a keyed processor\'s first argument: its key where it is a sound, else its first param; loaded at the call or later', async () => {
  let x = tone(440, 0.05, 0.25), n = x.length, loud = new Float32Array(n).fill(0.9), quiet = new Float32Array(n).fill(0.001)
  let from = chs => audio.from(chs.map(c => c.slice()), { sampleRate: SR }), voice = from([loud])
  // automation is a param's value, never a sound: a curve or a function of time first is the level
  let curve = { t: [0, 1], v: [-30, -30] }, fall = t => -30
  for (let bus of ['key', 'ref']) {
    // its output: the input times `gain`, 0 wherever the key is above `level`
    let probe = Object.assign(() => (inputs, outputs, p) => {
      let [s, k] = inputs, y = outputs[0], t = 10 ** (p.level[0] / 20)
      for (let c = 0; c < y.length; c++) for (let i = 0; i < y[c].length; i++) y[c][i] = k.length && Math.abs(k[c % k.length][i]) > t ? 0 : s[c][i] * p.gain[0]
    }, {
      params: { level: { type: 'number', min: -60, max: 0, default: -20, unit: 'dB' }, gain: { type: 'number', min: 0, max: 4, default: 1 } },
      channels: { inputs: [{ channels: 'any' }, { channels: 'any', name: bus }], outputs: 'any' },
    })
    let id = `${bus}-probe`
    audio.op(id, probe)
    let cases = [
      ['(-30, 2)', a => a[id](-30, 2), null, { level: -30, gain: 2 }, 2],
      ['(-30)', a => a[id](-30), null, { level: -30 }, 1],
      ["('-30dB', 2)", a => a[id]('-30dB', 2), null, { level: -30, gain: 2 }, 2],
      ['(a curve, 2)', a => a[id](curve, 2), null, { level: curve, gain: 2 }, 2],
      ['(t => -30, 2)', a => a[id](fall, 2), null, { level: fall, gain: 2 }, 2],
      [`(${bus}, -30, 2)`, a => a[id](voice, -30, 2), voice, { level: -30, gain: 2 }, 0],
      [`(${bus}, { level })`, a => a[id](voice, { level: -30 }), voice, { level: -30 }, 0],
      [`({ ${bus}, level })`, a => a[id]({ [bus]: voice, level: -30 }), voice, { level: -30 }, 0],
      [`(Float32Array[], -30, 2)`, a => a[id]([loud], -30, 2), 'channels', { level: -30, gain: 2 }, 0],
      [`(a quiet ${bus}, -30, 2)`, a => a[id](from([quiet]), -30, 2), 'quiet', { level: -30, gain: 2 }, 2],
    ]
    // what an edit renders, the input times the gain or 0 under a loud key, and records once read, its key aside
    let check = async (a, label, k, opts, g) => {
      let [y] = await a.read(), { [bus]: got, ...rest } = a.edits.at(-1)[1]
      ok(y.length === n && y.every((v, i) => v === x[i] * g), `${id} ${label}: ${g ? `the input${g === 1 ? ', untouched' : ` times ${g}`}` : 'ducked to 0'}`)
      ok(k == null ? got === undefined : k === voice ? got === voice : got != null, `${id} ${label}: ${k == null ? 'no' : 'the'} ${bus}`)
      is(rest, opts, `${id} ${label}: ${JSON.stringify(opts)}`)
    }
    for (let [label, f, k, opts, g] of cases) await check(f(from([x])), label, k, opts, g)
    let fails = f => { try { f(from([x])) } catch (e) { return e.message } }
    is(fails(a => a[id](-30, 2, 3)), `${id}: expected at most 2 arguments (level, gain), got 3`, `${id}: three numbers, of two params`)
    is(fails(a => a[id](voice, -30, 2, 3)), `${id}: expected at most 3 arguments (${bus}, level, gain), got 4`, `${id}: a sound and three numbers`)
    is(fails(a => a[id]({ [bus]: -30 })), `${id}: ${bus} is a sound its input bus reads (an audio instance, an AudioBuffer or Float32Array[]), not -30`, `${id}: a ${bus} that is not a sound, at the call`)

    // loaded after the call: the arguments wait, then map as above at the first read; a.run takes them so too
    let d = audio.op(id)
    delete audio.op()[id]
    let later = cases.map(([, f]) => f(from([x]))), over = from([x])[id](-30, 2, 3)
    is(later[0].edits, [[id, { args: [-30, 2] }]], `${id}: before it loads, the arguments wait`)
    audio.op(id, d)
    for (let [j, [label, , k, opts, g]] of cases.entries()) await check(later[j], label + ', loaded later', k, opts, g)
    is(await over.read().then(() => null, e => e.message), `${id}: expected at most 2 arguments (level, gain), got 3`, `${id}: three numbers, loaded later`)
    await check(from([x]).run([id, { args: [-30, 2] }]), 'a.run, args: [-30, 2]', null, { level: -30, gain: 2 }, 2)
    await check(from([x]).run([id, { args: [voice, -30, 2] }]), `a.run, args: [${bus}, -30, 2]`, voice, { level: -30, gain: 2 }, 0)
  }
})

// @audio/dynamics' compressor, gate and four more declare a key bus in their next release (inputs: [{ channels: 'any' },
// { channels: 'any', name: 'key' }]); the published compressor and gate, declared so, stand in for them here (the sibling
// checkout that has them is not where CI runs). The ducker, published with a key of 2, reads its documented calls as before
test('a compressor or gate with a key bus: (-30, 8) and (-45) are their params, as the options; the ducker as documented', async () => {
  let x = tone(440, 0.5), from = chs => audio.from(chs.map(c => c.slice()), { sampleRate: SR })
  let same = (p, q) => p.length === q.length && p.every((c, j) => c.every((v, i) => v === q[j][i]))
  let keyBus = { inputs: [{ channels: 'any' }, { channels: 'any', name: 'key' }], outputs: 'any' }
  audio.op('compressor-keyed', Object.assign(ctx => compressor(ctx), compressor, { channels: keyBus }))
  audio.op('gate-keyed', Object.assign(ctx => gate(ctx), gate, { channels: keyBus }))
  for (let [label, f, opts] of [
    ['compressor (-30, 8)', a => a['compressor-keyed'](-30, 8), { threshold: -30, ratio: 8 }],
    ['gate (-45)', a => a['gate-keyed'](-45), { threshold: -45 }],
    ["gate ('-45dB')", a => a['gate-keyed']('-45dB'), { threshold: -45 }],
  ]) {
    let a = f(from([x]))
    is(a.edits[0][1], opts, label)
    ok(same(await a.read(), await from([x])[a.edits[0][0]](opts).read()), `${label} ≡ ${JSON.stringify(opts)}`)
  }
  ok((await from([x])['compressor-keyed'](-30, 8).read())[0].some((v, i) => v !== x[i]), 'the compressor compresses there')
  // the ducker: a voice first is its key, numbers its params, alone or after the voice
  let main = [tone(440, 0.4, 0.4), tone(330, 0.4, 0.3)], voice = from([Float32Array.from(tone(220, 0.4, 0.8), (v, i) => i > 0.1 * SR && i < 0.25 * SR ? v : 0)])
  let duck = (...a) => from(main).ducker(...a).read()
  ok(same(await duck(voice, -30, 8), await duck({ key: voice, threshold: -30, ratio: 8 })), 'ducker(voice, -30, 8) ≡ ducker({ key: voice, threshold: -30, ratio: 8 })')
  ok(same(await duck(voice, { threshold: -30 }), await duck({ key: voice, threshold: -30 })), 'ducker(voice, { threshold }) ≡ ducker({ key: voice, threshold })')
  ok(same(await duck(-30, 8), await duck({ threshold: -30, ratio: 8 })), 'ducker(-30, 8) ≡ ducker({ threshold: -30, ratio: 8 }): no key')
  ok(!same(await duck(voice, -30, 8), await duck(-30, 8)), 'the voice keys it')
  is(audio.op('ducker').params, Object.keys(ducker.params), 'its params, the key not among them: what the CLI maps words onto')
})

// The sibling @audio/dynamics checkout's compressor declares that key bus now: where the checkout sits beside this one (as
// plugin-host.js finds its test plugins), its manifest itself is called; elsewhere (CI) the test is skipped
import { existsSync } from 'node:fs'
const siblingCompressor = new URL('../../@audio/dynamics/packages/dynamics-compressor/audio.js', import.meta.url)
test('the sibling checkout\'s compressor, its key bus declared: (-30, 8) and (kick, -30, 8) as their options', existsSync(siblingCompressor) ? {} : { skip: 'no @audio/dynamics checkout beside this one' }, async () => {
  let { compressor: keyed } = await import(siblingCompressor.href)
  ok(keyed.channels?.inputs?.[1]?.name === 'key', 'it declares a bus named key')
  audio.op('compressor-sibling', keyed)
  let x = tone(440, 0.5), kick = new Float32Array(x.length).fill(0.9), from = chs => audio.from(chs.map(c => c.slice()), { sampleRate: SR })
  let same = (p, q) => p.length === q.length && p.every((c, j) => c.every((v, i) => v === q[j][i]))
  let a = from([x])['compressor-sibling'](-30, 8)
  is(a.edits[0][1], { threshold: -30, ratio: 8 }, '(-30, 8): threshold and ratio')
  ok(same(await a.read(), await from([x])['compressor-sibling']({ threshold: -30, ratio: 8 }).read()), '(-30, 8) ≡ { threshold: -30, ratio: 8 }')
  ok(same(await from([x])['compressor-sibling'](from([kick]), -30, 8).read(), await from([x])['compressor-sibling']({ key: from([kick]), threshold: -30, ratio: 8 }).read()), '(kick, -30, 8) ≡ { key: kick, threshold: -30, ratio: 8 }')
})

// Contract § What a host owes, 5: "Calls `process` with 1 to `maxBlockSize` frames of finite samples (a NaN or Infinity
// coming in is made 0)": in a copy, never in the arrays given; a clean input is handed over as the engine holds it
test('audio: a NaN or Infinity coming in reaches the processor as 0, the arrays given unchanged; clean, the engine\'s own', async () => {
  let got = [], handed = []
  let look = () => (inputs, outputs) => { got.push(inputs); for (let c = 0; c < outputs[0].length; c++) outputs[0][c].set(inputs[0][c]) }
  Object.assign(look, { params: {}, channels: { inputs: ['any', 'any'], outputs: 'any' } })
  audio.op('look-probe', look)
  let d = audio.op('look-probe'), process = d.process
  d.process = (input, output, ctx) => { handed.push(input); process(input, output, ctx) }
  let x = tone(440, 0.05), z = x.slice(), k = x.slice()
  x[10] = NaN; x[11] = Infinity; k[30] = -Infinity
  let y = await audio.from([x, z], { sampleRate: SR })['look-probe']({ key: audio.from([k], { sampleRate: SR }) }).read()
  ok(y[0][10] === 0 && y[0][11] === 0 && y[0].every((v, i) => i === 10 || i === 11 || v === x[i]) && y[1].every((v, i) => v === z[i]), 'bus 0: NaN and Infinity as 0, the rest as fed')
  ok(got[0][1][0][30] === 0 && got.flatMap(b => [...b[1][0]]).every(Number.isFinite), 'the key: -Infinity as 0')
  ok(Number.isNaN(x[10]) && x[11] === Infinity && k[30] === -Infinity, 'the arrays given hold them still')
  ok(got[0][0] !== handed[0] && got[0][0][1] === handed[0][1], 'a copy of the channel that held one; the other as the engine holds it')
  got = []; handed = []
  await audio.from([z, z], { sampleRate: SR })['look-probe']().read()
  ok(got.length && got.every((b, j) => b[0] === handed[j]), 'clean: bus 0 the engine\'s own arrays, at every call')
  d.process = process
})

// A processor's id is lowercase-dashed (contract § Identity), which a script cannot write after a dot: an op of such a
// name is the same method under its camelCase too, the edit recorded under the id (its one name in edits, JSON, the CLI
// and errors); not where that name is a method already, an instance's own or another op's
test('an op of a dashed name is also a method under its camelCase: the same edit, render and JSON', async () => {
  let x = tone(440, 0.1)
  is(audio.fn.transientShaper, audio.fn['transient-shaper'], 'a registry processor: one method under both names')
  ok(!audio.op('transientShaper') && !audio.plugins.transientShaper, 'a method only: the id is the op\'s and the registry\'s one name')
  let a = audio.from([x], { sampleRate: SR }).transientShaper({ attack: 6 }), b = audio.from([x], { sampleRate: SR })['transient-shaper']({ attack: 6 })
  is(a.edits, [['transient-shaper', { attack: 6 }]], 'the edit under the id')
  is(a.edits, b.edits, 'as by the id')
  let [ya] = await a.read(), [yb] = await b.read()
  ok(ya.every((v, i) => v === yb[i]), 'the same render')
  let doc = JSON.parse(JSON.stringify(a))
  is(doc.edits, [['transient-shaper', { attack: 6 }]], 'its JSON names the id')
  let [yc] = await audio.from([x], { sampleRate: SR }).run(...doc.edits).read()
  ok(yc.every((v, i) => v === ya[i]), 'and renders the same from it')

  let flip = () => Object.assign(() => (inputs, outputs) => { for (let c = 0; c < outputs[0].length; c++) for (let i = 0; i < outputs[0][c].length; i++) outputs[0][c][i] = -inputs[0][c][i] }, { params: {}, channels: 'any' })
  audio.op('flip-sign', flip())
  is(audio.fn.flipSign, audio.fn['flip-sign'], 'one registered by audio.op under a dashed name: both too')
  let f = audio.from([x], { sampleRate: SR }).flipSign()
  is(f.edits, [['flip-sign', {}]], 'the edit under its name')
  ok((await f.read())[0].every((v, i) => v === -x[i]), 'and it renders')

  let toJSON = audio.fn.toJSON
  audio.op('to-JSON', flip())
  is(audio.fn.toJSON, toJSON, 'a camelCase that is an instance\'s own method keeps it')
  audio.op('turnIt', (input, output) => { for (let c = 0; c < input.length; c++) output[c].set(input[c]) })
  audio.op('turn-it', flip())
  is(audio.fn.turnIt.op, 'turnIt', 'another op\'s keeps it')
  audio.op('spin-it', flip())
  is(audio.fn.spinIt, audio.fn['spin-it'], 'a camelCase set')
  audio.op('spinIt', flip())
  is([audio.fn.spinIt.op, audio.fn['spin-it'].op], ['spinIt', 'spin-it'], 'a processor of that name takes it after, the dashed one keeps its own')
})

// Processors from packages audio depends on, at versions that hold their manifests (@audio/spatial 1.1.0, @audio/stretch
// 2.4.0, @audio/synth 1.5.0, @audio/weighting 1.3.0), in the registry since 2026-11-17: each loads by its name and renders
// as its package's own kernel does, or else as toBatch, another host of it, does
test('registry: ambisonic, stretch-pvsola, tonewheel and the weightings load by their names and render', async () => {
  let x = tone(440, 0.25, 0.5), notes = [{ time: 0.01, midi: 60, duration: 0.2 }]
  let batch = (name, chs, params) => toBatch(audio.op(name).plugin, { sampleRate: SR })(chs, { params, notes })
  let kernel = w => async (name, chs) => { let { default: k } = await audio.import(`@audio/weighting/${w}`); return chs.map(c => k(c.slice(), { fs: SR })) }
  for (let [name, chs, params, want] of [
    ['ambisonic-panner', [x], { az: 30 }, batch],
    ['ambisonic-decoder', [x, x, x, x], {}, batch],
    ['ambisonic-rotate', [x, x, x, x], { yaw: 45 }, batch],
    ['stretch-pvsola', [x], { factor: 2 }, batch],
    ['tonewheel', [new Float32Array(x.length)], {}, batch],
    ['a-weighting', [x], {}, kernel('a')],
    ['b-weighting', [x], {}, kernel('b')],
    ['c-weighting', [x], {}, kernel('c')],
    ['d-weighting', [x], {}, kernel('d')],
    ['k-weighting', [x], {}, kernel('k')],
    ['itu468', [x], {}, kernel('itu468')],
    ['riaa', [x], {}, kernel('riaa')],
  ]) {
    await audio.use(name)
    ok(audio.plugins[name] && audio.op(name)?.plugin, `${name}: in the registry, loaded under its name`)
    let y = await audio.from(chs.map(c => c.slice()), { sampleRate: SR })[name]({ ...params, ...name === 'tonewheel' && { notes } }).read()
    let z = await want(name, chs, params)
    ok(y.length === z.length && y.every((c, k) => c.length === z[k].length && c.every((v, i) => v === z[k][i])), `${name}: ${y.length} channel${y.length === 1 ? '' : 's'} of ${y[0].length} frames, as ${want === batch ? 'toBatch' : 'its kernel'} renders them`)
    ok(y.some(c => c.some(v => v !== 0)), `${name}: not silent`)
  }
})

// An AudioBuffer (what a page's decodeAudioData gives) as a key carries its channels, numberOfChannels: its length is
// its frames, which were counted as its channels, so a key bus of any count carried a mono one as one channel per frame
// and refused a stereo one. It renders as the same key given as planar arrays. Node has no AudioBuffer: a stand-in of
// its shape
test('an AudioBuffer key carries its channels: mono and stereo, on a key bus of any count and on the ducker, as planar arrays', async () => {
  let x = tone(440, 0.25, 0.4), n = x.length, from = chs => audio.from(chs.map(c => c.slice()), { sampleRate: SR })
  let same = (p, q) => p.length === q.length && p.every((c, j) => c.every((v, i) => v === q[j][i]))
  let ab = chs => ({ numberOfChannels: chs.length, length: chs[0].length, sampleRate: SR, duration: chs[0].length / SR, getChannelData: c => chs[c] })
  let k1 = Float32Array.from({ length: n }, (_, i) => i > n / 4 && i < n / 2 ? 0.9 : 0), k2 = Float32Array.from({ length: n }, (_, i) => i > n / 2 ? 0.9 : 0)
  // channel c of its output: the input's, 0 wherever channel c of the key (its last where it has fewer) is above
  // `threshold`; what its key bus carried, at each call
  let carried = []
  let keyed = Object.assign(() => (inputs, outputs, p) => {
    let [s, k] = inputs, y = outputs[0], t = 10 ** (p.threshold[0] / 20)
    carried.push(k.length)
    for (let c = 0; c < y.length; c++) for (let i = 0; i < y[c].length; i++) y[c][i] = k.length && Math.abs(k[Math.min(c, k.length - 1)][i]) > t ? 0 : s[c][i]
  }, { params: { threshold: { type: 'number', min: -60, max: 0, default: -20, unit: 'dB' } }, channels: { inputs: [{ channels: 'any' }, { channels: 'any', name: 'key' }], outputs: 'any' } })
  audio.op('any-key', keyed)
  await audio.use('ducker')
  for (let [op, key] of [['any-key', [k1]], ['any-key', [k1, k2]], ['ducker', [k1]], ['ducker', [k1, k2]]]) {
    let o = { threshold: -30 }, label = `${op}, an AudioBuffer of ${key.length}`
    carried = []
    let y = await from([x, x])[op]({ key: ab(key), ...o }).read()
    if (op === 'any-key') ok(carried.length && carried.every(c => c === key.length), `${label}: its key bus carries ${key.length} channel${key.length === 1 ? '' : 's'}${carried.some(c => c !== key.length) ? `, not ${carried.find(c => c !== key.length)}` : ''}`)
    ok(same(y, await from([x, x])[op]({ key, ...o }).read()), `${label} ≡ the key as Float32Array[]`)
    ok(!same(y, await from([x, x])[op](o).read()), `${label}: it keys it`)
  }
  ok(same(await from([x, x])['any-key'](ab([k1, k2]), -30).read(), await from([x, x])['any-key']([k1, k2], -30).read()), 'any-key(an AudioBuffer, -30) ≡ any-key(Float32Array[], -30): the call\'s first argument, a sound, its key')
})

// A value of another kind than its param's is an error at the call, naming the op, the param and what was passed: each
// of these rendered, silently (a lone Float32Array first was the ducker's threshold, its output not finite; a number set
// the expander's mode; the text 'false' turned the limiter's true peak on). Loaded after the call, the same error at the
// first read. A key that is not a sound says what it is. What each param takes renders as before
test('a value of another kind than its param\'s: refused at the call, naming the op, the param and what was passed', async () => {
  await audio.use('ducker', 'expander', 'limiter')
  let x = tone(440, 0.05), one = new Float32Array(x.length).fill(0.5), from = () => audio.from([x.slice(), x.slice()], { sampleRate: SR })
  let key = 'ducker: key is a sound its input bus reads (an audio instance, an AudioBuffer or Float32Array[]), not'
  let cases = [
    [a => a.ducker(one, -30, 8), 'ducker: threshold takes dB, not a Float32Array'],
    [a => a.ducker([], -30, 8), 'ducker: threshold takes dB, not an array'],
    [a => a.ducker(true), 'ducker: threshold takes dB, not true'],
    [a => a.compressor(audio.from([one], { sampleRate: SR })), 'compressor: threshold takes dB, not an audio instance'],
    [a => a.compressor({ ratio: [8] }), 'compressor: ratio takes a number, not an array'],
    [a => a.compressor({ threshold: { v: -30 } }), 'compressor: threshold takes dB, not an object'],
    [a => a.expander(-30), "expander: mode takes 'downward' or 'upward', not -30"],
    [a => a.expander({ mode: 'sideways' }), "expander: mode takes 'downward' or 'upward', not 'sideways'"],
    [a => a.limiter({ truePeak: 1 }), 'limiter: truePeak takes true or false, not 1'],
    [a => a.limiter({ truePeak: 'false' }), "limiter: truePeak takes true or false, not 'false'"],
    [a => a.ducker({ key: one }), `${key} a Float32Array`],
    [a => a.ducker({ key: [] }), `${key} an array`],
    [a => a.ducker({ key: JSON.parse(JSON.stringify(audio.from([one], { sampleRate: SR }))) }), `${key} an audio instance's JSON`],
    // NaN is a number held as it is, not clamped: the method refuses it at its own call (a loaded op's), and these ways
    // past it, a.run's options and the arguments of an op loaded later, rendered it, NaN out
    [a => a.run(['compressor', { threshold: NaN }]), 'compressor: threshold takes dB, not NaN'],
  ]
  let fails = f => { try { f(from()) } catch (e) { return e.message } }
  for (let [f, msg] of cases) is(fails(f), msg, `at the call: ${msg}`)
  // loaded after the call: its arguments wait as `args`, mapped and checked at the first read
  let names = ['ducker', 'expander', 'limiter', 'compressor'], held = names.map(n => audio.op(n))
  for (let n of names) delete audio.op()[n]
  let later = cases.map(([f]) => f(from()))
  names.forEach((n, j) => audio.op()[n] = held[j])
  for (let [j, a] of later.entries()) is(await a.read().then(() => null, e => e.message), cases[j][1], `loaded later, at the first read: ${cases[j][1]}`)
  // compressor(NaN) loaded later: its arguments wait as `args`, past the method's own check of a NaN
  delete audio.op().compressor
  let nan = from().compressor(NaN)
  audio.op().compressor = held[names.indexOf('compressor')]
  is(await nan.read().then(() => null, e => e.message), 'compressor: threshold takes dB, not NaN', 'compressor(NaN) loaded later, at the first read')
  // a unit declared empty is none: the message says 'a number' (it said "takes , not")
  audio.op('blank-unit', Object.assign(() => (inputs, outputs) => outputs[0][0].set(inputs[0][0]), { id: 'blank-unit', params: { beta: { type: 'number', min: 0, max: 1, default: 0.5, unit: '' } }, channels: 'any' }))
  is(fails(a => a['blank-unit']({ beta: [0.5] })), 'blank-unit: beta takes a number, not an array', "a unit '': 'a number'")
  // what each takes
  for (let [label, f] of [
    ['a number', a => a.ducker(-30, 8)], ["a value with its unit, '-30dB'", a => a.ducker('-30dB')], ['a function of the time', a => a.ducker(t => -30 - t)],
    ['a curve', a => a.ducker({ t: [0, 0.05], v: [-30, -20] })], ["an enum's value", a => a.expander('upward', -30)], ['a boolean', a => a.limiter({ truePeak: true })],
    ['null, a param left to its default', a => a.ducker(null, 8)],
  ]) ok((await f(from()).read()).every(c => c.length === x.length && c.every(Number.isFinite)), `${label}: renders`)
})

// An edit is [name] or [name, options], a call's positional values in its options as `args`: a longer one, or options
// that are not an object, recorded {} and rendered the op's defaults, the values dropped. Refused, showing the form.
// audio's own documents write [name, options] only (toJSON: the edits as normalizeEdit made them)
test('a.run: an edit of positional values, or of options that are not an object, is refused, showing [name, { args }]', async () => {
  let x = tone(440, 0.05), from = () => audio.from([x.slice()], { sampleRate: SR })
  let fails = e => { try { from().run(e) } catch (err) { return err.message } }
  let form = 'audio.run: an edit is [name] or [name, options]'
  is(fails(['compressor', -30, 8]), `${form}, values by position in options.args: ['compressor', { args: [-30, 8] }], not ['compressor', -30, 8]`, 'positional values after the name')
  is(fails(['gain', -6]), `${form}, values by position in options.args: ['gain', { args: [-6] }], not ['gain', -6]`, 'a value in place of the options')
  is(fails(['gain', { t: [0, 1], v: [0, -6] }]), `${form}, values by position in options.args: ['gain', { args: [a curve] }], not ['gain', a curve]`, 'a curve in place of the options')
  is(fails(['gain', { value: -6 }, { at: 0.01 }]), `${form}, not ['gain', { … }, { … }]`, 'two objects of options')
  is(fails([-6]), `${form}, not [-6]`, 'no name')
  // an op that takes no values by position is not shown { args }, which it would leave unread
  is(fails(['reverse', 5]), `${form}, not ['reverse', 5]`, 'an op with no params: no { args } form shown')
  // a trailing undefined is one not passed, as a method's argument is; one before a value is not
  is(from().run(['gain', { value: -6 }, undefined]).edits, [['gain', { value: -6 }]], 'a trailing undefined: the edit without it')
  is(from().run(['gain', undefined, undefined]).edits, [['gain', {}]], 'two: [name]')
  is(fails(['gain', -6, undefined]), `${form}, values by position in options.args: ['gain', { args: [-6] }], not ['gain', -6]`, 'a value, then a trailing undefined: refused as the value alone')
  is(fails(['gain', undefined, { value: -6 }]), `${form}, not ['gain', undefined, { … }]`, 'an undefined before options: refused')
  is(fails([undefined]), `${form}, not [undefined]`, 'no name: refused')
  // the forms it takes
  let a = from().run(['compressor', { args: [-30, 8] }], ['gain'], ['gain', { value: -6 }], ['gain', null])
  is(a.edits.slice(1), [['gain', {}], ['gain', { value: -6 }], ['gain', {}]], '[name], [name, options], [name, null]')
  await a.read()
  is(a.edits[0], ['compressor', { threshold: -30, ratio: 8 }], "['compressor', { args: [-30, 8] }]: mapped at the first read")
  let doc = JSON.parse(JSON.stringify(from().gain(-6).compressor(-30, 8)))
  ok(doc.edits.every(e => e.length === 2), 'a document\'s edits are [name, options]')
  is(from().run(...doc.edits).edits, doc.edits, 'and run again as they are')
})

// CONTRACT.md § Latency, tail, whole signals, as amended: a latency, tail or frames function is handed `transport`, as
// ctx.transport is where the host asks (a tail's where the input ends, the others' as the instance is built), of the
// edit's bpm and timeSignature (none: 120 bpm, 4/4, standing still). A tail of one beat renders 0.5 s past the input at
// 120 bpm and 0.667 s at 90, streaming or whole; a tail of the values alone as before
test('a latency, a tail and frames are handed the transport: one beat of tail at 120 and at 90 bpm, streaming and whole', async () => {
  let x = tone(440, 2, 0.25), n = x.length, seen = []
  let pass = () => (inputs, outputs) => { for (let c = 0; c < outputs[0].length; c++) outputs[0][c].set(inputs[0][c]) }
  let beat = at => (seen.push(['tail', at.transport]), 60 / at.transport.bpm)
  audio.op('beat-tail', Object.assign((...a) => pass(...a), { params: {}, channels: 'any', tail: beat, latency: at => (seen.push(['latency', at.transport]), 0) }))
  audio.op('beat-whole', Object.assign((...a) => pass(...a), { params: {}, channels: 'any', streaming: false, tail: beat }))
  audio.op('beat-frames', Object.assign(() => (inputs, outputs) => outputs[0][0].set(inputs[0][0]), { params: {}, channels: 'any', streaming: false, frames: (k, at) => (seen.push(['frames', at.transport]), k + Math.round(60 / at.transport.bpm * SR)) }))
  audio.op('values-tail', Object.assign((...a) => pass(...a), { params: { len: { type: 'number', min: 0, max: 2, default: 0.25 } }, channels: 'any', tail: ({ params }) => params.len[0] }))
  for (let [bpm, timeSignature] of [[120, [3, 4]], [90, [6, 8]], []]) {
    // the transport at frame f: where the input ends, 2 s, 4 beats at 120 bpm, past the first bar of 3/4 (3 quarters),
    // and 3 beats at 90, the first bar of 6/8 (3 quarters) ended: barStart 3 in both
    let bar = bpm && timeSignature[0] * 4 / timeSignature[1], beats = f => f * bpm / (60 * SR)
    let at = f => bpm ? { playing: true, bpm, beat: beats(f), barStart: Math.floor(beats(f) / bar) * bar, timeSig: timeSignature } : { playing: false, bpm: 120, beat: 0, barStart: 0, timeSig: [4, 4] }
    let want = Math.round(60 / (bpm ?? 120) * SR), label = bpm ? `${bpm} bpm, ${timeSignature.join('/')}` : 'no tempo'
    if (bpm) is(at(n).barStart, 3, `${label}: the input ends past a bar line`)
    for (let op of ['beat-tail', 'beat-whole', 'beat-frames']) {
      seen = []
      let y = await audio.from([x, x].map(c => c.slice()), { sampleRate: SR })[op](bpm ? { bpm, timeSignature } : {}).read()
      is(y[0].length - n, want, `${op}, ${label}: ${want} frames past the input, one beat`)
      for (let [k, t] of seen) is(t, at(k === 'tail' ? n : 0), `${op}, ${label}: its ${k} handed the transport ${k === 'tail' ? 'where the input ends' : 'as it is built'}`)
      ok(seen.length, `${op}, ${label}: handed it`)
    }
    let y = await audio.from([x.slice()], { sampleRate: SR })['values-tail']({ len: 0.5, ...bpm && { bpm } }).read()
    is(y[0].length - n, SR / 2, `values-tail, ${label}: its 0.5 s, as before`)
  }
})

// The sibling @audio/effect checkout's delay follows the tempo (sync: '1/8' reads ctx.transport.bpm) and its tail reads
// the transport it is handed: where the checkout sits beside this one it pads the render by its echoes at that tempo (an
// eighth: 0.25 s at 120 bpm, a third of a second at 90; how many of them it counts is the delay's own rule, asked of its
// manifest here), not the bound of its whole line it declares without a tempo; elsewhere (CI) the test is skipped
const siblingDelay = new URL('../../@audio/effect/packages/effect-delay/audio.js', import.meta.url)
test('the sibling checkout\'s delay synced to the tempo pads the render by its tail at that tempo, not the bound of its line', existsSync(siblingDelay) ? {} : { skip: 'no @audio/effect checkout beside this one' }, async () => {
  let { delay } = await import(siblingDelay.href)
  ok(delay.params.sync?.values.includes('1/8'), 'it declares sync')
  audio.op('delay-sibling', delay)
  let x = tone(440, 0.25), d = x.length / SR, params = { time: [0.25], feedback: [0.3], mix: [0.5], sync: '1/8' }
  let bound = delay.tail({ sampleRate: SR, params }), tails = []
  for (let bpm of [120, 90]) {
    let tail = delay.tail({ sampleRate: SR, params, transport: { playing: true, bpm, beat: 0, barStart: 0, timeSig: [4, 4] } })
    almost(audio.from([x.slice()], { sampleRate: SR })['delay-sibling']({ sync: '1/8', bpm }).duration - d, tail, 1e-4, `at ${bpm} bpm: ${tail.toFixed(3)} s past the input, its tail at that tempo`)
    ok(tail < bound, `at ${bpm} bpm, less than the ${bound} s it declares with no tempo given`)
    tails.push(tail)
  }
  ok(tails[1] > tails[0], `the slower tempo's echoes last longer: ${tails[1].toFixed(3)} s at 90 bpm, ${tails[0].toFixed(3)} s at 120`)
})

// An error an edit raises as it loads, prepares or renders says which edit: `edit`, its index in a.edits, and `op`, its
// name, its message and class as they were. A caller that holds a chain (the editor) drops that edit and renders the
// rest; the error raised at a call needs neither, the caller knows the call. The innermost edit of the instance read is
// the one: an edit failing as a later one reads its input (a preparation) is the earlier; a failure inside a sound an
// edit takes (a mix's source, an insert's, a key with edits of its own) is that edit's, whatever edit of the sound
// failed, since the caller holds the instance it reads, not the sound
import { prepared, playback } from '../plan.js'
const failed = p => p.then(() => null, e => e)
const drain = async a => { for await (let b of a.stream()); }
// a processor that passes its input on and throws at its n-th call, in each instance (a render builds one)
const failing = (n, thrown = () => new RangeError(`failing: call ${n}`)) => Object.assign(() => {
  let k = 0
  return (inputs, outputs) => { if (++k === n) throw thrown(); for (let c = 0; c < outputs[0].length; c++) outputs[0][c].set(inputs[0][c]) }
}, { params: {}, channels: 'any' })
audio.op('fails-fifth', failing(5))
audio.op('fails-tailed', Object.assign(failing(1), { tail: 0.1 }))
const voiced = () => audio.from([tone(440, 0.25, 0.25)], { sampleRate: SR })

test('an edit that fails as it loads or prepares: the error says which, its index and name, its message as it was', async () => {
  // positional values recorded before the op loaded, mapped onto its params as the edits load
  let e = await failed(voiced().gain(-1).run(['deepfilter', { args: [18, 'pass', 40] }]).gain(-2).read())
  ok(e instanceof TypeError && e.message === 'deepfilter: expected at most 1 arguments (limit), got 3', e?.message)
  is([e?.edit, e?.op], [1, 'deepfilter'], 'args mapped as it loads: the second edit')
  // the op's own check, as it prepares
  e = await failed(voiced().gain(-1).deepfilter(18, { floor: '40' }).gain(-2).read())
  ok(e instanceof TypeError && e.message === 'deepfilter: floor is dB under the voice, 0 or more (0: none), not 40', e?.message)
  is([e?.edit, e?.op], [1, 'deepfilter'], 'its check as it prepares: the second edit')
  // a registry op whose package is not there
  audio.plugins['missing-op'] = '@audio/missing-op/audio'
  e = await failed(voiced().gain(-1).run(['missing-op']).gain(-2).read())
  delete audio.plugins['missing-op']
  ok(/^audio\.use\('missing-op'\): install @audio\/missing-op/.test(e?.message), e?.message)
  is([e?.edit, e?.op], [1, 'missing-op'], 'its module not found as it loads: the second edit')
})

test('an edit that fails as it renders: its index in a.edits, through read(), stream() and encode(), its tail expanded or not', async () => {
  let a = voiced().gain(-1).gain(-2)['fails-fifth']().gain(-3)
  for (let [how, go] of [['read()', a => a.read()], ['stream()', drain], ["encode('wav')", a => a.encode('wav')]]) {
    let e = await failed(go(a))
    ok(e instanceof RangeError && e.message === 'failing: call 5', `${how}: as thrown (${e?.message})`)
    is([e?.edit, e?.op], [2, 'fails-fifth'], `${how}: a processor throwing at its 5th call, the third edit of four`)
  }
  // a whole-signal one, rendered as the plan compiles
  audio.op('fails-whole', Object.assign(() => () => { throw new TypeError('fails-whole: no') }, { params: {}, channels: 'any', streaming: false }))
  let e = await failed(voiced().gain(-1)['fails-whole']().gain(-2).read())
  is([e?.message, e?.edit, e?.op], ['fails-whole: no', 1, 'fails-whole'], 'a whole-signal processor: the second edit')
  // a tail: a pad and a hidden op of its own in the plan, after a stage of the edit before; the edit is still the caller's
  a = voiced().gain(-1)['fails-tailed']().gain(-2)
  for (let [how, go] of [['read()', a => a.read()], ['stream()', drain]]) {
    e = await failed(go(a))
    is([e?.message, e?.edit, e?.op], ['failing: call 1', 1, 'fails-tailed'], `${how}: a processor with a tail, by its own name, the second edit`)
  }
})

test('a sound inside an edit that fails: the edit of the instance read that holds it; an edit before one prepared ahead: the earlier', async () => {
  audio.op('keyed-pass', Object.assign(() => (inputs, outputs) => { for (let c = 0; c < outputs[0].length; c++) outputs[0][c].set(inputs[0][c]) }, {
    params: {}, channels: { inputs: [{ channels: 'any' }, { channels: 'any', name: 'key' }], outputs: 'any' },
  }))
  // a sound that fails in its own third edit
  let inner = () => voiced().gain(-1).gain(-2)['fails-fifth']()
  let e = await failed(inner().read())
  is([e?.edit, e?.op], [2, 'fails-fifth'], 'the sound read alone: its own third edit')
  for (let [how, make, op] of [
    ["a mix's source", s => voiced().mix(s).gain(-3), 'mix'],
    ["an insert's source", s => voiced().insert(s, 0.1).gain(-3), 'insert'],
    ['a key', s => voiced()['keyed-pass']({ key: s }).gain(-3), 'keyed-pass'],
  ]) {
    e = await failed(make(inner()).read())
    ok(e?.message === 'failing: call 5', `${how}: as thrown (${e?.message})`)
    is([e?.edit, e?.op], [0, op], `${how}: the first edit, which holds it, not the 2 the sound's own edits gave it`)
  }
  // an edit made ahead of rendering reads its input, the edits before it: one of those failing is the one
  let PASSED = Symbol('passed')
  audio.op('prepared-pass', { prepare: prepared(PASSED, () => '', pcm => pcm), process: playback('prepared-pass', PASSED) })
  e = await failed(voiced().gain(-1)['fails-fifth']()['prepared-pass']().read())
  is([e?.edit, e?.op], [1, 'fails-fifth'], 'failing as the third edit prepares: the second, which failed')
})

test('a value thrown that is not an object, or one that takes no property, passes as it is; an Error is said so', async () => {
  for (let [label, v] of [['a string', 'failing: a string'], ['a number', 5], ['a frozen object', Object.freeze({ message: 'frozen' })]]) {
    audio.op('throws-value', failing(1, () => v))
    let e = await failed(voiced().gain(-1)['throws-value']().read())
    ok(e === v, `${label}: the value thrown`)
    if (typeof v === 'object') ok(!('edit' in v) && !('op' in v), `${label}: nothing set on it`)
  }
  audio.op('throws-value', failing(1))
  let e = await failed(voiced().gain(-1)['throws-value']().read())
  is([e?.edit, e?.op], [1, 'throws-value'], 'an Error: said so')
  // one whose class holds `op` as a getter: assigned, it would throw in the error's place
  class Held extends Error { get op() { return 'held' } }
  let held = new Held('failing: held')
  audio.op('throws-value', failing(1, () => held))
  e = await failed(voiced().gain(-1)['throws-value']().read())
  ok(e === held, `an Error whose class holds op as a getter: the error thrown (${e?.message})`)
  is([e?.edit, e?.op], [1, 'held'], 'its index said, its op its own')
})

test('the edit an error names dropped from a.edits, the rest renders', async () => {
  let same = (p, q) => p.length === q.length && p.every((c, j) => c.length === q[j].length && c.every((v, i) => v === q[j][i]))
  let want = await voiced().gain(-1).gain(-2).read()
  for (let op of ['fails-fifth', 'fails-tailed']) {
    let a = voiced().gain(-1)[op]().gain(-2), e = await failed(a.read())
    // as undo drops one: the edit out, the version on (what is kept by it, a plan, is made again)
    a.edits.splice(e?.edit, 1); a.version++
    ok(same(await a.read(), want), `${op} dropped: the rest renders, as the chain without it`)
  }
})

// audio.js's list of the registry ops that can change the width, known before any load, against the registry's
// manifests as installed: each op whose processor, as audio hosts it, makes another width of some input width (a count
// on its output, layouts of its own) is in the list, and no other; each makes of every width the width the list says, 0
// (not known) where its output declares layouts of its own (a `layouts` option picks them). The widths asked go to one past the widest any
// manifest declares (a count, or a layout's channels), each hook with no options and with each value its params declare
// (default, min, max, the values listed): a width that moves with them is one the list cannot say. A hook throws only
// for an op with layouts of its own, for a width none of its layouts has
test("the registry ops that can change the width: audio.js's list, the manifests'", async () => {
  let ops = new Set(Object.keys(audio.op())), methods = new Set(Object.keys(audio.fn)), hosted = [], found = {}, odd = [], N
  try {
    for (let name of Object.keys(audio.plugins)) { await audio.use(name); let d = audio.op(name); if (d?.plugin) hosted.push([name, d]) }
    let counts = hosted.flatMap(([, d]) => [d.plugin.channels, d.plugin.channels?.inputs, d.plugin.channels?.outputs].flat())
      .map(c => typeof c === 'string' && c !== 'any' ? layoutChannels(c) : c).filter(Number.isInteger)
    N = Array.from({ length: Math.max(8, ...counts) + 1 }, (_, i) => i + 1)
    for (let [name, d] of hosted) {
      let out = d.plugin.channels?.outputs, own = Array.isArray(out) && typeof out[0] === 'string'
      let width = (n, o) => { try { return d.ch?.(n, o) || n } catch { if (!own) odd.push(`${name}: throws for ${n}`); return n } }
      let each = Object.entries(d.plugin.params || {}).flatMap(([k, p]) => [p.default, p.min, p.max, ...(p.values ?? [])].filter(v => v !== undefined).map(v => ({ [k]: v })))
      let none = N.map(n => width(n, {}))
      for (let o of each) if (N.some((n, i) => width(n, o) !== none[i])) odd.push(`${name}: ${JSON.stringify(o)} moves a width`)
      if (N.some((n, i) => none[i] !== n)) found[name] = own ? N.map(() => 0) : none
    }
  } finally {
    for (let n in audio.op()) if (!ops.has(n)) delete audio.op()[n]
    for (let n in audio.fn) if (!methods.has(n)) delete audio.fn[n]
  }
  is(odd, [], `widths 1 to ${N.length}: none moved by a declared value, none thrown for but where the layouts are its own`)
  is([...widening.keys()].sort(), Object.keys(found).sort(), `the list as the manifests make it: ${Object.keys(found).join(', ')}`)
  for (let [name, made] of Object.entries(found)) if (widening.has(name)) { let w = widening.get(name); is(N.map(n => typeof w === 'function' ? w(n) : w), made, `${name}: the width it makes of each`) }
})
