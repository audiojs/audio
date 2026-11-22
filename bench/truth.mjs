// Every stretcher and pitch shifter against the true stretched or shifted sound: a score rendered at the tempo or the
// pitch asked (test/eval/score.js), which no recording has, read by the 2f-model's score (@audio/quality's twof: an
// estimate of what listeners give in a MUSHRA test, 100 for a sound they cannot tell from the reference).
//
//   node bench/truth.mjs [stretch|pitch|formants] [--json=file]
//
// Reading the table:
// - "true, other phases": the true sound again with every partial started elsewhere, as any stretcher leaves them. The
//   score cannot tell a take from the truth above this line: a chord's is under 70, so the chord tells little.
// - "left as it was": the input, unstretched or unshifted. A method near this line did not do what was asked.
// - ~ after a score: the take sat more than 9 ms from the truth before it was aligned.
// The takes are aligned by their levels over time and brought to the truth's level first: the score reads the sound,
// not a delay or a gain. The eval holds each method at its score on the tune and the plucked notes (test/eval/cases.js).
import { writeFileSync } from 'node:fs'
import audio from '../audio.js'
import { METHODS } from '../fn/stretch.js'
import { twof } from '@audio/quality'
import { render, SCORES, aligned } from '../test/eval/score.js'

const fs = 48000, which = process.argv.slice(2).find(a => !a.startsWith('--')), json = process.argv.find(a => a.startsWith('--json='))?.slice(7)
const STRETCH = ['phase-lock', ...Object.keys(METHODS)], STRETCHES = [0.75, 1.5]
const PITCH = ['phase-lock', 'vocoder', 'formant', 'paulstretch', 'auto', 'ola', 'transient', 'psola', 'wsola', 'granular', 'sms', 'hpss', 'sample', 'hybrid', 'delay', 'lpc'], SHIFTS = [-5, 5]
const read = (ref, take) => { let a = aligned(ref, take, fs); return { score: twof(a.ref, a.out, fs), lag: a.lag, level: a.level } }
const results = { ceiling: {}, floor: {}, stretch: {}, pitch: {}, formants: {} }
const f1 = v => v == null || Number.isNaN(v) ? '  n/a' : v.toFixed(1).padStart(5)
const take = async (x, kind, amount, method) => {
  let s = audio.from([x.slice()], { sampleRate: fs }), opts = method === 'voice: true' ? { voice: true } : method === 'phase-lock' ? undefined : { method }
  return (await (kind === 'stretch' ? s.stretch(amount, opts) : s.pitch(amount, opts)).read())[0]
}

for (let kind of ['stretch', 'pitch']) {
  if (which && which !== kind) continue
  let methods = kind === 'stretch' ? STRETCH : PITCH, amounts = kind === 'stretch' ? STRETCHES : SHIFTS, names = Object.keys(SCORES)
  let cols = names.flatMap(n => amounts.map(a => [n, a])), to = a => kind === 'stretch' ? { stretch: a } : { shift: a }
  console.log(`\n${kind}: the 2f score against the true sound`)
  console.log(''.padEnd(19) + cols.map(([n, a]) => `${n.slice(0, 6)} ${kind === 'stretch' ? '×' + a : (a > 0 ? '+' : '') + a}`.padStart(13)).join(''))
  let x = Object.fromEntries(names.map(n => [n, render(SCORES[n], fs)])), ref = Object.fromEntries(cols.map(([n, a]) => [n + a, render(SCORES[n], fs, to(a))]))
  let ceil = cols.map(([n, a]) => twof(ref[n + a], render(SCORES[n], fs, { ...to(a), phases: 2 }), fs)), floor = cols.map(([n, a]) => read(ref[n + a], x[n]).score)
  console.log('true, other phases'.padEnd(19) + ceil.map(v => f1(v).padStart(12) + ' ').join(''))
  console.log('left as it was'.padEnd(19) + floor.map(v => f1(v).padStart(12) + ' ').join(''))
  cols.forEach(([n, a], i) => { results.ceiling[`${kind} ${n} ${a}`] = ceil[i]; results.floor[`${kind} ${n} ${a}`] = floor[i] })
  for (let method of methods) {
    let row = []
    for (let [n, a] of cols) {
      let r
      try { r = read(ref[n + a], await take(x[n], kind, a, method)) } catch (e) { r = { err: e.message } }
      row.push(r); (results[kind][method] ??= {})[`${n} ${a}`] = r
    }
    let got = row.filter(r => r.score != null && !Number.isNaN(r.score))
    console.log(method.padEnd(19) + row.map(r => (r.err ? 'err' : f1(r.score)).padStart(12) + (Math.abs(r.lag) > 9 ? '~' : ' ')).join('') + `  mean ${f1(got.reduce((s, r) => s + r.score / got.length, 0))}`)
  }
}

// a sung voice shifted, against both truths: its formants moved with the pitch, and kept where they were
if (!which || which === 'formants') {
  let x = render(SCORES.voice, fs), cols = SHIFTS.flatMap(s => ['move', 'keep'].map(formants => ({ shift: s, formants }))), refs = cols.map(c => render(SCORES.voice, fs, c))
  console.log('\npitch, the sung voice: the 2f score against the truth with its formants moved, and kept')
  console.log(''.padEnd(19) + cols.map(c => `${c.shift > 0 ? '+' : ''}${c.shift} ${c.formants === 'move' ? 'moved' : 'kept'}`.padStart(13)).join(''))
  console.log('true, other phases'.padEnd(19) + cols.map((c, i) => f1(twof(refs[i], render(SCORES.voice, fs, { ...c, phases: 2 }), fs)).padStart(12) + ' ').join(''))
  console.log('the other truth'.padEnd(19) + cols.map((c, i) => f1(twof(refs[i], refs[i ^ 1], fs)).padStart(12) + ' ').join(''))
  for (let method of ['phase-lock', 'auto', 'hybrid', 'psola', 'wsola', 'formant', 'lpc', 'voice: true']) {
    let ys = {}, row = []
    for (let [i, c] of cols.entries()) { let y = ys[c.shift] ??= await take(x, 'pitch', c.shift, method); row.push(read(refs[i], y)) }
    results.formants[method] = Object.fromEntries(cols.map((c, i) => [`${c.shift} ${c.formants}`, row[i]]))
    console.log(method.padEnd(19) + row.map(r => f1(r.score).padStart(12) + ' ').join(''))
  }
}
if (json) writeFileSync(json, JSON.stringify(results, null, 1))
process.exit(0)
