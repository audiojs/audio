// What a host owes a processor (contract 1.0, "What a host owes"), as checks one host function can be run against.
// It imports nothing: the adapters in @audio/compile run an unchanged copy of it, as they ship CONTRACT.d.ts.
//
//   import { duties } from './conformance.js'
//   for (let { name, cite, run } of duties) await run(host)
//
// `run` resolves when the host kept the duty and throws an Error saying what the host did when it did not. `host` is
// one function a host's test file supplies: host(processor, opts) builds one instance of `processor`, renders
// `opts.frames` frames of input through it and on through its tail, and resolves to { output, emitted }. A host that
// renders no tail (one that stops with its input, as an engine-free batch host may) says so once, as `host.tails =
// false`; the tail duty then asks nothing of it. Its options:
//
//   sampleRate  Hz
//   channels    the channels feeding input bus 0, each holding its frame's index (0, 1, 2, …); 0: nothing feeds it (a
//               host whose every render has an input renders over one silent channel)
//   input       Float32Array[] (as many as `channels`, `frames` long) feeding input bus 0 in place of that ramp; it
//               may hold NaN and Infinity, which the host makes 0 on their way to the processor, writing nothing into
//               these arrays (a copy where it must change one)
//   frames      the frames to render
//   blocks      the most frames a call may carry, for a host that lets its caller say (toBatch's and toStream's
//               maxBlockSize); one that does not (audio's 1024, an AudioWorklet's 128) leaves it
//   params      { name: value } the instance starts with: a number, an enum's string, a number written with a unit; a
//               number the host clamps to its range (Infinity and -Infinity to its ends), and puts on its `step` where
//               it declares one (the nearest step from `min`, a tie upward), as it does with what `moves` and a
//               smoothing ramp reach
//   moves       { name: { t: [seconds], v: [values] } } a param's automation as a curve: straight between points, a step
//               where two share a time (the later from its frame on), flat past the ends (an AudioWorklet's
//               setValueAtTime and linearRampToValueAtTime)
//   notes       [{ time, midi, duration?, velocity? }] (seconds) the notes to deliver, in any order; a velocity outside
//               0..1 the host holds to it (the notes duty gives one of 1.7)
//   buffers     { name: Float32Array[] } planar, at the render's rate
//   transport   { bpm, timeSig: [numerator, denominator] } a tempo; none: no tempo
//   key         Float32Array[] feeding input bus 1 (its option `key`); NaN and Infinity in it as in `input`
//
// `output` is output bus 0, `frames` frames a channel lined up with the input (the processor's latency compensated),
// then the tail the host renders; `emitted` is what the processor reported through ctx.emit, [{ name, value }] in
// order. A host that refuses a processor or an option (a real-time host, a whole-signal processor; automation of a
// restart param; a bus fed channels it cannot carry) rejects.
//
// Each check reads the host's behaviour from what the host gives back: a probe processor writes what it saw into its
// output (a value at each frame, the frame count of each call, the channels of each bus, its samples, the notes,
// ctx.transport.beat, its input delayed by its latency) or reports it through ctx.emit (a call of 0 frames, which has no
// frame to write at); the arrays given as `input` and `key` are read again after the render. So a host may evaluate
// `latency` and `tail` in another realm than the processor (an AudioWorklet's). Not shown this way, so not here: an
// instance replaced and handed over when its configuration changes (one render has one configuration), saved state,
// allocation per block, a plugin adapter's additions (duties 1, 9-11).

const fail = msg => { throw new Error(msg) }
const near = (a, b, tol = 1e-4) => Math.abs(a - b) <= tol * Math.max(1, Math.abs(b))
const MODES = ['a', 'b', 'c']

// The tape: a probe that writes what each call saw into output bus 0, at the call's first frame (head) or at each of its
// frames (each). Channels: 0 head, its frame count; 1 head, ctx.maxBlockSize; 2 head, the calls of 0 frames before it;
// 3 head, ctx.maxChannels; 4 each, `level`; 5 each, `size` (restart); 6 head, the index of `mode` among its values;
// 7 each, input bus 0's channels (-1 none); 8 each, input bus 1's channels (-1 undefined, -2 not an array); 9 each, bus
// 0's first channel; 10 each, bus 1's first channel (0 none); 11-15 head, transport beat, barStart, bpm, playing (1, 0),
// timeSig as numerator × 100 + denominator; 16 head, `time` (in s); 17 each, bus 0's last channel. A call of 0 frames
// is also reported as `zero` (ctx.emit), so one after the last call shows too
const TAPE = 18
function tape (props = {}, specs = {}) {
  let zero = 0
  let p = ctx => (inputs, outputs, params) => {
    let y = outputs[0], n = y[0].length, x = inputs[0], k = inputs[1], tr = ctx.transport
    if (!n) { ctx.emit('zero', ++zero); return }
    y[0][0] = n; y[1][0] = ctx.maxBlockSize; y[2][0] = zero; y[3][0] = ctx.maxChannels
    y[6][0] = MODES.indexOf(params.mode)
    y[11][0] = tr?.beat ?? NaN; y[12][0] = tr?.barStart ?? NaN; y[13][0] = tr?.bpm ?? NaN
    y[14][0] = tr ? +tr.playing : NaN; y[15][0] = tr ? tr.timeSig[0] * 100 + tr.timeSig[1] : NaN
    y[16][0] = params.time[0]
    for (let i = 0; i < n; i++) {
      if (i) for (let c of [0, 1, 2, 3, 6, 11, 12, 13, 14, 15, 16]) y[c][i] = 0
      y[4][i] = params.level[0]; y[5][i] = params.size[0]
      y[7][i] = x ? x.length : -1
      y[8][i] = k === undefined ? -1 : Array.isArray(k) ? k.length : -2
      y[9][i] = x?.[0]?.[i] ?? NaN
      y[10][i] = k?.[0]?.[i] ?? 0
      y[17][i] = x?.at(-1)?.[i] ?? NaN
    }
  }
  p.params = {
    level: { type: 'number', min: 0, max: 1000, default: 0 },
    size: { type: 'number', min: 1, max: 64, default: 8, restart: true },
    mode: { type: 'enum', values: MODES, default: 'a' },
    time: { type: 'number', min: 0, max: 10, default: 1, unit: 's' },
    ...specs,
  }
  p.channels = { inputs: ['any', 'any'], outputs: TAPE }
  p.events = { out: { zero: { min: 0, max: 1e9 } } }
  return Object.assign(p, props)
}

// The calls a tape shows, each { at, n, head(c) }: one starting where the last ended, from frame 0 to the end
function calls (output, frames, width = TAPE) {
  if (!(output?.length >= width)) fail(`output bus 0 has ${output?.length} channels, the probe writes ${width}`)
  if (output[0].length < frames) fail(`output has ${output[0].length} frames of the ${frames} rendered`)
  let list = []
  for (let i = 0; i < frames;) {
    let n = output[0][i], at = i
    if (!(n >= 1) || n !== Math.round(n)) fail(`no call starts at frame ${i}, where the last one ended (the probe read ${n} there)`)
    list.push({ at, n, head: c => output[c][at] })
    i += n
  }
  return list
}
const startsAt = (list, f) => list.some(c => c.at === f) || fail(`no call starts at frame ${f}: the one there runs from ${list.findLast(c => c.at < f)?.at}`)
const every = (output, c, frames, ok, what) => { for (let i = 0; i < frames; i++) if (!ok(output[c][i], i)) fail(`${what} at frame ${i}: ${output[c][i]}`) }
const ramp = (n, frames) => Array.from({ length: n }, () => Float32Array.from({ length: frames }, (_, i) => i))

// A curve { t, v } at frame f, as `moves` reads one
function curveAt ({ t, v }, f, sr) {
  let b = t.map(x => Math.round(x * sr)), i = b.length - 1
  if (f < b[0]) return v[0]
  while (i > 0 && b[i] > f) i--
  return i === b.length - 1 ? v[i] : v[i] + (v[i + 1] - v[i]) * (f - b[i]) / (b[i + 1] - b[i])
}

// A value a call holds where its param moves: from where the movement is at the call's first frame to where it is at
// its last, either end, as a host may read either
const within = (got, a, b) => got >= Math.min(a, b) - 1e-3 && got <= Math.max(a, b) + 1e-3

export const duties = [
  {
    name: 'calls carry 1 to maxBlockSize frames',
    cite: 'The frame count of a call is the length of any channel; it varies from call to call, is never 0 and never above `maxBlockSize`.',
    async run (host) {
      let frames = 5000, { output, emitted } = await host(tape(), { sampleRate: 48000, channels: 2, frames, blocks: 1000, moves: { level: { t: [0.03, 0.06], v: [0, 1000] } } })
      for (let c of calls(output, frames)) {
        if (c.head(2)) fail(`process was called with 0 frames (${c.head(2)} such calls before frame ${c.at})`)
        if (!(c.n <= c.head(1))) fail(`the call at frame ${c.at} carried ${c.n} frames, its ctx.maxBlockSize ${c.head(1)}`)
      }
      let zero = emitted?.filter(e => e.name === 'zero').length
      if (zero) fail(`process was called with 0 frames after the render's last call (${zero} time${zero === 1 ? '' : 's'})`)
    },
  },
  {
    name: 'ctx.maxChannels is the widest bus of the instance',
    cite: '`maxChannels`: The channels of the widest bus of this instance. Allocate per-channel state by it.',
    async run (host) {
      let probe = () => {
        let p = ctx => (inputs, outputs) => {
          let w = outputs[0].length
          for (let b of inputs) if (b.length > w) w = b.length
          outputs[0][0].fill(ctx.maxChannels); outputs[0][1].fill(w)
        }
        p.params = {}
        p.channels = { inputs: ['any', 'any'], outputs: 2 }
        return p
      }
      let frames = 256, key = ramp(3, frames)
      for (let [opts, want, what] of [[{ channels: 5 }, 5, 'input bus 0 of 5'], [{ channels: 1, key }, 3, 'a key of 3'], [{ channels: 1 }, 2, 'output bus 0 of 2']]) {
        let { output } = await host(probe(), { sampleRate: 44100, frames, ...opts })
        every(output, 0, frames, v => v === want, `ctx.maxChannels with ${what} the widest bus is not ${want}`)
        every(output, 1, frames, (v, i) => v <= output[0][i], `a call had a bus wider than ctx.maxChannels`)
      }
    },
  },
  {
    name: 'input bus 0 always carries its channels; a further bus nothing feeds has none',
    cite: 'Input bus 0 always carries its channels, silent when nothing feeds it. A further input bus that nothing feeds has no channels.',
    async run (host) {
      let frames = 600, sampleRate = 44100
      let { output } = await host(tape(), { sampleRate, channels: 2, frames })
      every(output, 7, frames, v => v === 2, 'input bus 0 fed with 2 channels had another count')
      every(output, 8, frames, v => v === 0, 'input bus 1, fed by nothing, was not an empty array (-1: undefined, -2: not an array)')
      every(output, 9, frames, (v, i) => v === i, 'input bus 0 did not carry what fed it')
      ;({ output } = await host(tape(), { sampleRate, channels: 0, frames }))
      every(output, 7, frames, v => v >= 1, 'input bus 0, fed by nothing, had no channels (-1: no bus)')
      every(output, 9, frames, v => v === 0, 'input bus 0, fed by nothing, was not silent')
      every(output, 8, frames, v => v === 0, 'input bus 1, fed by nothing, was not an empty array (-1: undefined, -2: not an array)')
      let key = [Float32Array.from({ length: frames }, (_, i) => -i)]
      ;({ output } = await host(tape(), { sampleRate, channels: 2, frames, key }))
      every(output, 8, frames, v => v === 1, 'input bus 1, fed by a key of 1 channel, had another count')
      every(output, 10, frames, (v, i) => v === -i, 'input bus 1 did not carry its key')
      // a bus 0 that declares its count carries it: one channel fed copied to each, as plugin hosts feed a mono track to
      // a stereo plugin; another count it cannot carry is refused, naming both, or carried as declared
      let two = () => tape({ channels: { inputs: [2, 'any'], outputs: TAPE } })
      ;({ output } = await host(two(), { sampleRate, channels: 1, frames }))
      every(output, 7, frames, v => v === 2, 'input bus 0, declared of 2 channels and fed 1, had another count')
      every(output, 9, frames, (v, i) => v === i, 'input bus 0, declared of 2 channels and fed 1, did not carry it on its first')
      every(output, 17, frames, (v, i) => v === i, 'input bus 0, declared of 2 channels and fed 1, did not carry it on its second')
      let res = null
      try { res = await host(two(), { sampleRate, channels: 3, frames }) }
      catch (e) { if (!(e instanceof Error)) throw e; if (!/\b2\b/.test(e.message) || !/\b3\b/.test(e.message)) fail(`input bus 0, declared of 2 channels and fed 3, was refused without naming both counts: ${e.message}`) }
      if (res) every(res.output, 7, frames, v => v === 2, 'input bus 0, declared of 2 channels and fed 3, had another count')
    },
  },
  {
    name: 'a NaN or Infinity coming in reaches the processor as 0, the arrays given unchanged',
    cite: 'Calls `process` with 1 to `maxBlockSize` frames of finite samples (a NaN or Infinity coming in is made 0) … Never write NaN or Infinity: the input holds none (the host sees to that).',
    async run (host) {
      // NaN, Infinity and -Infinity on each channel of bus 0 and on the key, each at a frame of its own (the key's first
      // frame among them); every other sample the ramp, which reaches the processor as it is
      let frames = 600, input = ramp(2, frames), key = ramp(1, frames)
      ;[NaN, Infinity, -Infinity].forEach((v, j) => { input[0][100 + j] = v; input[1][200 + j] = v; key[0][250 * j] = v })
      let given = [...input, ...key], was = given.map(c => c.slice())
      let { output } = await host(tape(), { sampleRate: 44100, channels: 2, frames, input, key })
      for (let [c, k, what] of [[9, 0, 'input bus 0\'s first channel'], [17, 1, 'input bus 0\'s second channel'], [10, 2, 'input bus 1']])
        for (let i = 0; i < frames; i++) {
          let x = was[k][i], got = output[c][i]
          if (got !== (Number.isFinite(x) ? x : 0)) fail(`${what}, fed ${x} at frame ${i}, reached the processor as ${got}${Number.isFinite(x) ? '' : ', not 0'}`)
        }
      given.forEach((c, k) => { for (let i = 0; i < frames; i++) if (!Object.is(c[i], was[k][i])) fail(`the host wrote into the arrays it was given: ${k < 2 ? `input channel ${k}` : 'the key'} holds ${c[i]} at frame ${i}, where it held ${was[k][i]}`) })
    },
  },
  {
    name: 'a jump falls on a call boundary at its own frame',
    cite: 'A value changes only between calls. A host that must change one inside a block splits the block there',
    async run (host) {
      let sampleRate = 48000, frames = 4000, J = [1001, 2513], t = J.map(f => f / sampleRate)
      let { output } = await host(tape(), { sampleRate, channels: 1, frames, blocks: 1000, moves: { level: { t: [t[0], t[0], t[1], t[1]], v: [0, 300, 300, 700] } } })
      let list = calls(output, frames)
      for (let f of J) startsAt(list, f)
      every(output, 4, frames, (v, i) => v === (i < J[0] ? 0 : i < J[1] ? 300 : 700), 'the value was not the one in force from its jump on')
    },
  },
  {
    name: 'while a value moves, no call is longer than 32 frames',
    cite: 'while a value is moving (a smoothing ramp, an automation curve) no call is longer than 32 frames',
    async run (host) {
      let sampleRate = 48000, frames = 4000, curve = { t: [1000 / sampleRate, 3000 / sampleRate], v: [0, 1000] }
      let { output } = await host(tape(), { sampleRate, channels: 1, frames, blocks: 1000, moves: { level: curve } })
      let list = calls(output, frames)
      startsAt(list, 1000); startsAt(list, 3000)
      for (let c of list) if (c.at >= 1000 && c.at < 3000) {
        if (c.n > 32) fail(`a call of ${c.n} frames at frame ${c.at}, where the curve moves`)
        let v = output[4][c.at], a = curveAt(curve, c.at, sampleRate), b = curveAt(curve, c.at + c.n, sampleRate)
        if (!within(v, a, b)) fail(`the call at frame ${c.at} held ${v}; the curve goes from ${a} to ${b} over it`)
      }
    },
  },
  {
    name: 'smoothing ramps a jump linearly over its seconds from the value in force; a slope is not smoothed again',
    cite: '`smoothing` | number | Seconds. A jump of the value (a new setting, a step in a curve) is reached by a linear ramp of this length. A value that moves by itself (a sloped curve, an automation function) is not smoothed again.',
    async run (host) {
      let sampleRate = 48000, frames = 3500, J = 1001, L = 480   // 0.01 s
      let smooth = () => tape({}, { level: { type: 'number', min: 0, max: 1000, default: 0, smoothing: 0.01 } })
      // a slope (0 to 1000 over frames 1000 to 3000) is the curve's own value at every call
      let slope = { t: [1000 / sampleRate, 3000 / sampleRate], v: [0, 1000] }
      let { output } = await host(smooth(), { sampleRate, channels: 1, frames, blocks: 1000, moves: { level: slope } })
      for (let c of calls(output, frames)) {
        let v = output[4][c.at], a = curveAt(slope, c.at, sampleRate), b = curveAt(slope, c.at + c.n, sampleRate)
        if (!within(v, a, b)) fail(`a slope: the call at frame ${c.at} held ${v}; the curve goes from ${a} to ${b} over it`)
      }
      // a step (0 to 1000 at J) ramps linearly over the smoothing from the value in force
      ;({ output } = await host(smooth(), { sampleRate, channels: 1, frames, blocks: 1000, moves: { level: { t: [J / sampleRate, J / sampleRate], v: [0, 1000] } } }))
      let list = calls(output, frames), r = f => 1000 * Math.min(1, Math.max(0, (f - J) / L))
      startsAt(list, J)
      for (let c of list) {
        let v = output[4][c.at]
        if (c.at + c.n <= J && v !== 0) fail(`the call at frame ${c.at}, before the jump, held ${v}`)
        if (c.at >= J + L + 32 && v !== 1000) fail(`the call at frame ${c.at}, past the ramp, held ${v}`)
        if (c.at >= J && c.at < J + L) {
          if (c.n > 32) fail(`a call of ${c.n} frames at frame ${c.at}, inside the ramp`)
          if (!within(v, r(c.at), r(c.at + c.n))) fail(`the call at frame ${c.at} held ${v}; a linear ramp over ${L} frames goes from ${r(c.at)} to ${r(c.at + c.n)} over it`)
        }
      }
      // a step into a slope (0 to 500 at J, then up to 1000 at 3000) ramps its difference away over the smoothing while
      // the slope goes on, and is on the slope from then on
      let into = { t: [J / sampleRate, J / sampleRate, 3000 / sampleRate], v: [0, 500, 1000] }, e = f => curveAt(into, f, sampleRate) - 500 * Math.max(0, 1 - (f - J) / L)
      ;({ output } = await host(smooth(), { sampleRate, channels: 1, frames, blocks: 1000, moves: { level: into } }))
      for (let c of calls(output, frames)) {
        let v = output[4][c.at]
        if (c.at >= J && !within(v, e(c.at), e(c.at + c.n))) fail(`a step into a slope: the call at frame ${c.at} held ${v}; ${c.at < J + L ? 'the step\'s ramp on the slope' : 'the slope'} goes from ${e(c.at)} to ${e(c.at + c.n)} over it`)
      }
    },
  },
  {
    name: 'no automation reaches a restart parameter',
    cite: 'Lets no automation reach a `restart` parameter.',
    async run (host) {
      // as 1.0 marks it, and as manifests published before it do
      for (let size of [{ type: 'number', min: 1, max: 64, default: 8, restart: true }, { type: 'number', min: 1, max: 64, default: 8, flags: ['restart'] }]) {
        let frames = 3000, res
        try { res = await host(tape({}, { size }), { sampleRate: 48000, channels: 1, frames, moves: { size: { t: [0.01, 0.04], v: [8, 32] } } }) }
        catch (e) { if (!(e instanceof Error)) throw e; continue }   // refused: none reached it
        every(res.output, 5, frames, v => v === res.output[5][0], `automation reached size (${size.restart ? 'restart: true' : "flags: ['restart']"}), which changed from ${res.output[5][0]}`)
      }
    },
  },
  {
    name: 'numbers are clamped, undeclared enum values refused, text converted to the unit',
    cite: 'Clamps numbers, … refuses enum values that are not declared, converts suffixed text to the declared unit.',
    async run (host) {
      let frames = 300, sampleRate = 44100
      let { output } = await host(tape(), { sampleRate, channels: 1, frames, params: { level: 5000, time: '250ms', mode: 'c' } })
      every(output, 4, frames, v => v === 1000, 'level 5000, its max 1000, reached it as')
      for (let c of calls(output, frames)) {
        if (c.head(16) !== 0.25) fail(`time '250ms', declared in s, reached it as ${c.head(16)}`)
        if (c.head(6) !== 2) fail(`mode 'c', declared among ${MODES.join(', ')}, reached it as the index ${c.head(6)}`)
      }
      // a number past its range by any amount is held to the range's end, Infinity and -Infinity too (neither end the
      // default, so a value dropped for the default shows)
      let ends
      try { ends = await host(tape(), { sampleRate, channels: 1, frames, params: { level: Infinity, time: -Infinity } }) }
      catch (e) {
        if (!(e instanceof Error)) throw e
        fail(`level Infinity and time -Infinity, numbers past their ranges, were refused, not clamped to their ends: ${e.message}`)
      }
      every(ends.output, 4, frames, v => v === 1000, 'level Infinity, its max 1000, reached it as')
      for (let c of calls(ends.output, frames)) if (c.head(16) !== 0) fail(`time -Infinity, its min 0, reached it as ${c.head(16)}`)
      // a value it does not declare is refused, naming the param and the value: one held to the default renders what was
      // not asked, and a typo goes unseen
      let res
      try { res = await host(tape(), { sampleRate, channels: 1, frames, params: { mode: 'z' } }) }
      catch (e) {
        if (!(e instanceof Error)) throw e
        if (!/\bmode\b/.test(e.message) || !/\bz\b/.test(e.message)) fail(`mode 'z', not among ${MODES.join(', ')}, was refused without naming the param and the value: ${e.message}`)
        return
      }
      let got = calls(res.output, frames)[0].head(6)
      fail(`mode 'z', not among ${MODES.join(', ')}, was taken: it reached the processor as ${got === 0 ? 'the default, a' : got < 0 ? 'it was' : MODES[got]}`)
    },
  },
  {
    name: 'a stepped number is put on its step: a value, automation and a smoothing ramp',
    cite: '`step` | number | The value moves in steps of this size from `min` … Clamps numbers, puts a stepped one on its step',
    async run (host) {
      // level moves in steps of 2 from 1 to 9 (1, 3, 5, 7, 9): a value goes to the nearest step, a tie upward, and into
      // the range
      let q = v => Math.min(9, Math.max(1, 1 + 2 * Math.round((v - 1) / 2)))
      let stepped = (smoothing = 0) => tape({}, { level: { type: 'number', min: 1, max: 9, default: 1, step: 2, smoothing } })
      let sampleRate = 48000, frames = 3000
      let { output } = await host(stepped(), { sampleRate, channels: 1, frames, params: { level: 4 } })
      every(output, 4, frames, v => v === 5, 'level 4, between the steps 3 and 5 (a tie, so 5), reached it as')
      // values set at jumps: 3.2, 6.9, 12 (past max), 0.4 (under min)
      let J = [600, 1200, 1800, 2400], v = [1, 3.2, 6.9, 12, 0.4]
      let moves = { level: { t: J.flatMap(f => [f / sampleRate, f / sampleRate]), v: J.flatMap((_, k) => [v[k], v[k + 1]]) } }
      ;({ output } = await host(stepped(), { sampleRate, channels: 1, frames, moves }))
      every(output, 4, frames, (x, i) => x === q(v[J.filter(f => f <= i).length]), `level set to ${v.join(', ')} (on the steps ${v.map(q).join(', ')}) reached it as`)
      // a slope from 1 to 9: each call on a step, between the steps of where the slope is over it
      let slope = { t: [1000 / sampleRate, 2600 / sampleRate], v: [1, 9] }
      ;({ output } = await host(stepped(), { sampleRate, channels: 1, frames, blocks: 1000, moves: { level: slope } }))
      for (let c of calls(output, frames)) {
        let x = output[4][c.at], a = q(curveAt(slope, c.at, sampleRate)), b = q(curveAt(slope, c.at + c.n, sampleRate))
        if (x !== q(x) || !within(x, a, b)) fail(`a slope: the call at frame ${c.at} held ${x}; on the steps it goes from ${a} to ${b} over it`)
      }
      // a smoothing ramp of a stepped value steps too: a jump from 1 to 9 at frame 1001, ramped over 480 frames (0.01 s)
      let at = 1001, L = 480, r = f => q(1 + 8 * Math.min(1, Math.max(0, (f - at) / L)))
      ;({ output } = await host(stepped(0.01), { sampleRate, channels: 1, frames, blocks: 1000, moves: { level: { t: [at / sampleRate, at / sampleRate], v: [1, 9] } } }))
      for (let c of calls(output, frames)) {
        let x = output[4][c.at]
        if (x !== q(x) || !within(x, r(c.at), r(c.at + c.n))) fail(`a smoothing ramp: the call at frame ${c.at} held ${x}; on the steps the ramp goes from ${r(c.at)} to ${r(c.at + c.n)} over it`)
      }
    },
  },
  {
    name: 'notes arrive sorted, ids assigned, offs paired',
    cite: 'Each block, `ctx.events` holds that block\'s note events sorted by time … `time`: the frame within the block. `midi`: the note number … `velocity`: 0..1. … `id`: an integer from 0, unique among sounding notes. An `off` carries the id of its `on`.',
    async run (host) {
      // two slots of four channels a frame (kind 1 on, -1 off; midi; id; velocity), 8: what was wrong in a call
      // (1 unsorted, 2 a time outside it, 4 three at a frame, 8 ctx.events not an array, 16 an event with no number for
      // midi), 9: the call's frame count
      let p = ctx => (inputs, outputs) => {
        let y = outputs[0], n = y[0].length, evs = ctx.events, bad = 0
        for (let c of y) c.fill(0)
        if (!Array.isArray(evs)) bad |= 8
        else for (let j = 0, prev = -1, slot = 0; j < evs.length; j++) {
          let e = evs[j]
          if (e.time < prev) bad |= 1
          if (!(e.time >= 0 && e.time < n)) { bad |= 2; continue }
          if (typeof e.midi !== 'number') { bad |= 16; continue }
          slot = e.time === prev ? slot + 1 : 0
          prev = e.time
          if (slot > 1) { bad |= 4; continue }
          let o = slot * 4
          y[o][e.time] = e.kind === 'on' ? 1 : e.kind === 'off' ? -1 : NaN
          y[o + 1][e.time] = e.midi; y[o + 2][e.time] = e.id; y[o + 3][e.time] = e.velocity
        }
        y[8][0] = bad; y[9][0] = n
      }
      p.params = {}
      p.events = { in: ['note'] }
      p.channels = { inputs: 'any', outputs: 10 }
      let sampleRate = 48000, frames = 6000
      // out of order; C begins where A, the same key, ends; D sounds to the end, its key between two, too hard
      let notes = [
        { time: 0.03, midi: 60, duration: 0.02, velocity: 0.5 },
        { time: 0.01, midi: 64, duration: 0.05, velocity: 1 },
        { time: 0.05, midi: 60, duration: 0.01, velocity: 0.25 },
        { time: 0.0213, midi: 67.5, velocity: 1.7 },
      ]
      let { output: y } = await host(p, { sampleRate, channels: 1, frames, blocks: 2048, notes })
      if (!(y?.length >= 10) || y[0].length < frames) fail(`output bus 0 has ${y?.length} channels of ${y?.[0]?.length} frames, the probe writes 10 of ${frames}`)
      let got = [], sounding = new Map()
      for (let i = 0; i < frames; i++) {
        if (y[8][i]) fail(`a call at frame ${i} had its notes ${['unsorted', 'outside it', 'three at a frame', 'not an array', 'with no number for midi'].filter((_, b) => y[8][i] & 1 << b).join(', ')}`)
        for (let s = 0; s < 2; s++) if (y[4 * s][i]) got.push({ f: i, kind: y[4 * s][i], midi: y[4 * s + 1][i], id: y[4 * s + 2][i], vel: y[4 * s + 3][i] })
      }
      for (let e of got) {
        if (e.kind === 1) {
          if (!Number.isInteger(e.id) || e.id < 0) fail(`an on at frame ${e.f} has id ${e.id}, not an integer from 0`)
          if (sounding.has(e.id)) fail(`an on at frame ${e.f} has id ${e.id}, the id of a note still sounding`)
          if (!(e.vel >= 0 && e.vel <= 1)) fail(`an on at frame ${e.f} has velocity ${e.vel}, outside 0..1`)
          sounding.set(e.id, e.midi)
        } else if (e.kind === -1) {
          if (!sounding.has(e.id)) fail(`an off at frame ${e.f} has id ${e.id}, no sounding note's`)
          if (sounding.get(e.id) !== e.midi) fail(`an off at frame ${e.f} (midi ${e.midi}) carries the id of a note of midi ${sounding.get(e.id)}`)
          sounding.delete(e.id)
        } else fail(`an event at frame ${e.f} of kind ${e.kind}, neither on nor off`)
      }
      let want = notes.flatMap(n => [[Math.round(n.time * sampleRate), 1, n.midi, Math.fround(Math.min(1, n.velocity))], ...n.duration != null ? [[Math.round((n.time + n.duration) * sampleRate), -1, n.midi]] : []])
        .sort((a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2])
      let have = got.map(e => [e.f, e.kind, e.midi, e.vel]).sort((a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2])
      if (have.length !== want.length) fail(`${have.length} note events arrived, ${want.length} were given`)
      want.forEach((w, i) => {
        let h = have[i]
        if (h[0] !== w[0] || h[1] !== w[1] || h[2] !== w[2] || w[1] === 1 && h[3] !== w[3]) fail(`a note's ${w[1] === 1 ? 'on' : 'off'} (midi ${w[2]}${w[1] === 1 ? `, velocity ${w[3]}` : ''}) at frame ${w[0]} arrived as ${h[1] === 1 ? 'an on' : 'an off'} of midi ${h[2]} at frame ${h[0]}${h[1] === 1 ? `, velocity ${h[3]}` : ''}`)
      })
    },
  },
  {
    name: 'ctx.transport is set before each block',
    cite: '`transport`: `{ playing, bpm, beat, barStart, timeSig }`, set by the host before each block. … A host with no tempo gives `{ playing: false, bpm: 120, beat: 0, barStart: 0, timeSig: [4, 4] }`.',
    async run (host) {
      let frames = 6000, sampleRate = 8000
      let { output } = await host(tape(), { sampleRate, channels: 1, frames, blocks: 512 })
      for (let c of calls(output, frames)) {
        let got = [11, 12, 13, 14, 15].map(c.head)
        if (got.join() !== '0,0,120,0,404') fail(`with no tempo, the call at frame ${c.at} had beat, barStart, bpm, playing, timeSig ${got.join(', ')} (timeSig as numerator × 100 + denominator)`)
      }
      // 600 quarter notes a minute at 8 kHz: a quarter note every 800 frames; a bar of 6/8, three of them
      ;({ output } = await host(tape(), { sampleRate, channels: 1, frames, blocks: 512, transport: { bpm: 600, timeSig: [6, 8] } }))
      let list = calls(output, frames)
      if (list.length < 2) fail('the render was one call: no block after the first to set the transport before')
      for (let c of list) {
        let beat = c.at / 800, bar = Math.floor(beat / 3) * 3
        if (!near(c.head(11), beat)) fail(`the call at frame ${c.at} had beat ${c.head(11)}, its position from the timeline's start ${beat}`)
        if (!near(c.head(12), bar)) fail(`the call at frame ${c.at} (beat ${beat}) had barStart ${c.head(12)}, the bar line before it ${bar}`)
        if (c.head(13) !== 600 || c.head(14) !== 1 || c.head(15) !== 608) fail(`the call at frame ${c.at} had bpm ${c.head(13)}, playing ${c.head(14)}, timeSig ${c.head(15)}: 600, 1, 608 asked`)
      }
    },
  },
  {
    name: 'emissions are passed on',
    cite: 'declares a value the processor reports with `ctx.emit(\'pitch\', value)` … Delivers declared notes sorted, with ids assigned and offs paired; passes emissions on.',
    async run (host) {
      // at each call: `at`, the frame it starts at, read off its input; `frames`, its length, declared as before 1.0
      let p = ctx => (inputs, outputs) => {
        let y = outputs[0][0], n = y.length
        y.fill(0); y[0] = n
        ctx.emit('at', inputs[0][0][0]); ctx.emit('frames', n)
      }
      p.params = {}
      p.channels = { inputs: 'any', outputs: 1 }
      p.events = { out: { at: { min: 0, max: 1e9 }, frames: 'number' } }
      let frames = 3000, { output, emitted } = await host(p, { sampleRate: 44100, channels: 1, frames, blocks: 1024 })
      let list = calls(output, frames, 1), at = emitted?.filter(e => e.name === 'at').map(e => e.value), n = emitted?.filter(e => e.name === 'frames').map(e => e.value)
      if (at?.join() !== list.map(c => c.at).join()) fail(`'at' was passed on as [${at}], the calls start at [${list.map(c => c.at)}]`)
      if (n?.join() !== list.map(c => c.n).join()) fail(`'frames', declared 'number', was passed on as [${n}], the calls are [${list.map(c => c.n)}] long`)
    },
  },
  {
    name: 'latency is taken as the instance is built, and the output lined up by it',
    cite: '`latency`: samples by which the output lags the input. Default 0. Hosts compensate for it. … Each is a number or a pure function of the setting, `{ sampleRate, params, buffers, transport }`: the values and the transport at the moment the host asks about, which for a live host is now. A host takes `latency` when it builds the instance',
    async run (host) {
      // a delay of `size` ms (a restart param) and as many frames as its buffer `pad` is long, declared as its latency: a
      // host that took it as the instance was built, of its rate, values and buffers, returns the input in place
      let delay = ({ sampleRate, params, buffers }) => Math.round(params.size[0] * sampleRate / 1000) + (buffers?.pad?.[0]?.length ?? 0)
      let p = ctx => {
        let d = delay(ctx), line = new Float32Array(d + 1), w = 0
        return (inputs, outputs) => {
          let x = inputs[0][0], y = outputs[0][0]
          for (let i = 0; i < y.length; i++, w = (w + 1) % line.length) { line[w] = x[i]; y[i] = line[(w + 1) % line.length] }
        }
      }
      p.params = { size: { type: 'number', min: 0, max: 64, default: 1, unit: 'ms', restart: true } }
      p.buffers = { pad: {} }
      p.channels = { inputs: 'any', outputs: 1 }
      p.latency = delay
      let sampleRate = 22050, frames = 1000, pad = [new Float32Array(37)], last = frames - 1
      let { output } = await host(p, { sampleRate, channels: 1, frames, params: { size: 7 }, buffers: { pad } })
      let d = delay({ sampleRate, params: { size: [7] }, buffers: { pad } }), lag = last - output?.[0]?.[last]
      if (lag) fail(`the output lags the input by ${lag} frames (frame ${last} holds the input's ${output?.[0]?.[last]}); its latency, ${d} frames (size 7 ms at ${sampleRate} Hz, and pad's ${pad[0].length}), ${lag === d ? 'was not compensated' : `was taken as ${d - lag}`}`)
      every(output, 0, frames, (v, i) => v === i, 'the output, lined up, did not hold the input')
    },
  },
  {
    name: 'a tail is rendered as long as it is declared, by the instance that heard the input',
    cite: '`tail`: seconds after the input stops until the output stays 60 dB under the input\'s RMS level … Hosts keep calling `process` for that long. … Each is a number or a pure function of the setting, `{ sampleRate, params, buffers, transport }`: the values and the transport at the moment the host asks about, which for a live host is now. … A host may take `tail` whenever it needs it.',
    async run (host) {
      // rings `ring` seconds after its input stops: each frame of the ring holds the frames since the input's last
      let p = ctx => {
        let R = Math.round(ctx.params.ring[0] * ctx.sampleRate), since = -1
        return (inputs, outputs) => {
          let x = inputs[0][0], y = outputs[0][0]
          for (let i = 0; i < y.length; i++) {
            since = x[i] ? 0 : since < 0 ? -1 : since + 1
            y[i] = since > 0 && since <= R ? since : 0
          }
        }
      }
      p.params = { ring: { type: 'number', min: 0, max: 1, default: 0.001, unit: 's' } }
      p.channels = { inputs: 'any', outputs: 1 }
      p.tail = ({ params }) => params.ring[0]
      let sampleRate = 48000, frames = 1000, R = 480   // 0.01 s
      let { output } = await host(p, { sampleRate, channels: 1, frames, params: { ring: 0.01 } })
      if (host.tails === false) return
      let y = output?.[0]
      if (!(y?.length >= frames + R)) fail(`the output ends ${y?.length - frames} frames after the input; its tail is ${R} (ring 0.01 s at ${sampleRate} Hz)`)
      for (let j = 0; j < R; j++) if (y[frames + j] !== j + 1) fail(`frame ${j} of the tail held ${y[frames + j]}, not the ring of the instance that heard the input (${j + 1})`)
    },
  },
  {
    name: 'a tail is handed the transport in force, a latency the one the instance is built with',
    cite: 'Each is a number or a pure function of the setting, `{ sampleRate, params, buffers, transport }`: the values and the transport at the moment the host asks about, which for a live host is now. A host takes `latency` when it builds the instance … it must not depend on `transport`, since a tempo moves while an instance lives. … Takes `latency` at construction and `tail` when it needs it, outside the block loop, with the transport in force',
    async run (host) {
      // a delay of 64 frames whose latency says 64 when it is handed a transport as an instance is built with it (the
      // contract's shape, at beat 0), and less by what it lacks: 61 none, 62 not of that shape, 63 past the start. With no
      // tempo, then with one that moves the beat 1.25 quarter notes over the render (600 bpm at 8 kHz)
      let lagged = () => {
        let p = ctx => {
          let line = new Float32Array(65), w = 0
          return (inputs, outputs) => {
            let x = inputs[0][0], y = outputs[0][0]
            for (let i = 0; i < y.length; i++, w = (w + 1) % 65) { line[w] = x[i]; y[i] = line[(w + 1) % 65] }
          }
        }
        p.params = {}
        p.channels = { inputs: 'any', outputs: 1 }
        p.latency = ({ transport: t }) => !t ? 61 : !(typeof t.playing === 'boolean' && t.bpm > 0 && t.timeSig?.length === 2) ? 62 : t.beat !== 0 || t.barStart !== 0 ? 63 : 64
        return p
      }
      let sampleRate = 8000, frames = 1000, last = frames - 1
      for (let transport of [undefined, { bpm: 600, timeSig: [4, 4] }]) {
        let { output } = await host(lagged(), { sampleRate, channels: 1, frames, transport })
        let lag = last - output?.[0]?.[last], why = { 3: 'handed no transport', 2: 'handed a transport not of the contract\'s shape ({ playing, bpm, beat, barStart, timeSig })', 1: 'handed a transport past the instance\'s start (beat or barStart not 0)' }[lag]
        if (lag) fail(`${transport ? 'at 600 bpm' : 'with no tempo'}, the output lags the input by ${lag} frames: its latency function ${why ?? `returned 64 frames, ${lag === 64 ? 'not compensated' : `taken as ${64 - lag}`}`}`)
      }
      if (host.tails === false) return
      // rings one beat at the tempo in force (ctx.transport.bpm where it rings) after its input stops, each frame of the
      // ring the frames since the input's last; its tail one beat of the transport it is handed, playing, else 1 ms. At
      // two tempos, neither the 120 of a host with none
      let ring = () => {
        let p = ctx => {
          let since = -1
          return (inputs, outputs) => {
            let x = inputs[0][0], y = outputs[0][0], R = Math.round(60 / (ctx.transport?.bpm || 120) * ctx.sampleRate)
            for (let i = 0; i < y.length; i++) {
              since = x[i] ? 0 : since < 0 ? -1 : since + 1
              y[i] = since > 0 && since <= R ? since : 0
            }
          }
        }
        p.params = {}
        p.channels = { inputs: 'any', outputs: 1 }
        p.tail = ({ transport: t }) => t && t.playing === true && t.bpm > 0 ? 60 / t.bpm : 0.001
        return p
      }
      for (let bpm of [100, 150]) {
        let R = Math.round(60 / bpm * sampleRate)
        let { output } = await host(ring(), { sampleRate, channels: 1, frames, transport: { bpm, timeSig: [3, 4] } })
        let y = output?.[0]
        if (!(y?.length >= frames + R)) fail(`at ${bpm} bpm the output ends ${y?.length - frames} frames after the input; its tail is one beat of the transport it is handed, ${R} frames (8, 1 ms, when it is handed none, or one not playing)`)
        for (let j = 0; j < R; j++) if (y[frames + j] !== j + 1) fail(`at ${bpm} bpm frame ${j} of the tail held ${y[frames + j]}, not the ring of one beat (${j + 1})`)
      }
    },
  },
  {
    name: 'buffers are there at construction, undefined when none is given',
    cite: 'It is there at construction only, in `ctx.buffers`, and is `undefined` when the host has none',
    async run (host) {
      // at the first frame: the channels of ir (-1 undefined, -2 no ctx.buffers), and its first three samples
      let p = ctx => {
        let ir = ctx.buffers ? ctx.buffers.ir : null, n = ir === undefined ? -1 : ir === null ? -2 : ir.length
        return (inputs, outputs) => { let y = outputs[0]; y[0][0] = n; for (let i = 0; i < 3; i++) y[1 + i][0] = ir?.[0]?.[i] ?? NaN }
      }
      p.params = {}
      p.buffers = { ir: { channels: [1, 2] } }
      p.channels = { inputs: 'any', outputs: 4 }
      let opts = { sampleRate: 44100, channels: 1, frames: 64 }, ir = Float32Array.of(0.5, -0.25, 0.125)
      let { output } = await host(p, { ...opts, buffers: { ir: [ir] } })
      if (output[0][0] !== 1 || [1, 2, 3].some(c => output[c][0] !== ir[c - 1])) fail(`ir given as 1 channel of 0.5, -0.25, 0.125 was ${output[0][0]} channels of ${[1, 2, 3].map(c => output[c][0])}`)
      ;({ output } = await host(p, { ...opts, buffers: { ir: [ir, ir] } }))
      if (output[0][0] !== 2) fail(`ir given as 2 channels was ${output[0][0]}`)
      ;({ output } = await host(p, opts))
      if (output[0][0] !== -1) fail(`ir, not given, was ${output[0][0] === -2 ? 'there with no ctx.buffers' : `${output[0][0]} channels`}, not undefined`)
      let err = null
      try { await host(p, { ...opts, buffers: { ir: [ir, ir, ir] } }) } catch (e) { err = e }
      if (!/\bir\b/.test(err?.message)) fail(`ir of 3 channels, its declaration taking 1 or 2, ${err ? `failed without naming it: ${err.message}` : 'was taken'}`)
    },
  },
  {
    name: 'a whole-signal processor gets it in one call, its values fixed',
    cite: '`streaming: false`: the processor needs the whole signal … It gets it in one call of any length, with its parameters fixed. Real-time targets refuse it.',
    async run (host) {
      let frames = 5000, res
      try { res = await host(tape({ streaming: false }), { sampleRate: 48000, channels: 1, frames, blocks: 1000, moves: { level: { t: [0.03, 0.06], v: [0, 1000] } } }) }
      catch (e) { if (!(e instanceof Error)) throw e; return }   // refused
      let list = calls(res.output, frames)
      if (list.length !== 1) fail(`it was called ${list.length} times, at frames ${list.slice(0, 5).map(c => c.at)}${list.length > 5 ? '…' : ''}`)
      if (!(list[0].head(1) >= frames)) fail(`its ctx.maxBlockSize was ${list[0].head(1)}, its one call ${frames} frames`)
    },
  },
]
