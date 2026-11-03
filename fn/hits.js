/**
 * Hits — where the level jumps, each at the sample a cut there keeps all of: up where an attack starts, down where a
 * sound stops.
 *
 * a.stat('hits', { at?, duration? }) → Float64Array of times (seconds)
 * hits(channels, rate)                → the same, from samples
 * rises(channels, rate)               → the ups alone, [{ t, db }]: where each attack starts, and how far it jumps
 * attacks(times, channels, rate)      → where the attack near each time starts (a slice point)
 * stops(times, channels, rate)        → where the sound near each time stops
 * plainness(times, channels, rate)    → how plain each time is as a cue, [{ rank, peak }]: how far the level steps
 *                                       across it, dB, and the sound it starts or ends' largest sample
 *
 * stat('onsets') reads energy in blocks (23 ms at 44.1 kHz) and finds where a sound gets louder; hits are found every
 * 5 ms both ways, and each lands on its attack's zero crossing: what an editor cuts at.
 */

import audio, { parseTime, named } from '../core.js'

// Where each hit's attack starts, for a cut there to keep all of it. The onset stat reads energy in blocks
// (fn/beat.js, 1024 samples, 23 ms at 44.1 kHz), so a hit it finds can start up to a block before or after the time it
// gives. Around that time, on an envelope 5 ms wide every millisecond (wide enough that a tone's own cycles don't read
// as rises): the loudest window, the quietest before it, and the last window before the loudest still within 5% of the
// way up from one to the other (13 dB under the rise). The attack starts about halfway into that window, as a sharp
// strike comes into a window only at its end; then back to the zero crossing before it, within a millisecond, so a cut
// there starts from silence. On the built-in chime and handpan, whose strikes are known, this lands from 3.5 ms before
// each strike to half a millisecond into one that rises over 2.5 ms (test/hits.js), where the blocks put hits
// 14 ms either side. A slice point, as librosa's onset_backtrack makes one (McFee et al. 2015), found from the rise
// rather than from the local minimum before it, which the ring of a struck bar puts inside its own attack. `channels`
// are the output's; each time comes back after the one before. `back` reads the channels from their end: the same
// search, for where a sound stops.
const WIDE = .005, HOP = .001, UP = .05
export function attacks(times, channels, rate, block = 1024, back = false) {
  const n = channels[0]?.length ?? 0, hop = Math.max(1, Math.round(rate * HOP)), wide = Math.max(hop, Math.round(rate * WIDE))
  const at = back ? (x, i) => x[n - 1 - i] ?? 0 : (x, i) => x[i] ?? 0
  const mix = i => { let s = 0; for (const x of channels) s += at(x, i); return s }
  const out = []
  for (const t of times) {
    const near = Math.round(t * rate), floor = out.length ? Math.round(out.at(-1) * rate) + hop : 0
    const lo = Math.min(Math.max(floor, near - Math.round(block * 1.5)), n), hi = Math.max(lo, Math.min(n - wide, near + block))
    // energy of each window [lo + k·hop, … + wide), from the running sum of every channel's squares
    const sum = new Float64Array(hi + wide - lo + 1)
    for (let i = lo; i < hi + wide; i++) { let e = 0; for (const x of channels) e += at(x, i) ** 2; sum[i - lo + 1] = sum[i - lo] + e }
    const energy = Array.from({ length: Math.floor((hi - lo) / hop) + 1 }, (_, k) => sum[k * hop + wide] - sum[k * hop])
    let peak = 0
    energy.forEach((e, k) => { if (e > energy[peak]) peak = k })
    const base = Math.min(...energy.slice(0, peak + 1)), up = base + UP * (energy[peak] - base)
    let k = peak
    while (k >= 0 && energy[k] > up) k--
    // nothing quieter where it looked: the attack starts no later than where it began looking (the start of the sound)
    let start = k < 0 ? lo : Math.min(lo + k * hop + (wide >> 1), lo + peak * hop)
    for (let i = start, end = Math.max(floor, start - hop); i > end; i--) if (mix(i - 1) * mix(i) <= 0) { start = i; break }
    out.push(Math.max(floor, start) / rate)
  }
  return out
}

// Where a sound stops sharply, as attacks() finds where one starts: its attack read from the end, the cut after its last
// sound, at the zero crossing after it. A reversed hit's stop is its strike, mirrored.
export function stops(times, channels, rate, block = 1024) {
  const end = (channels[0]?.length ?? 0) / rate
  return attacks(times.map(t => end - t).reverse(), channels, rate, block, true).map(t => end - t).reverse()
}

// The hits: where the level jumps, up (a strike, a note, a word struck) or down (a gate, a stop, a reversed strike), not
// where it swells or dies away, nor where the background flickers. The level is every 5 ms, of the 10 ms there, in dB
// down to 40 under the loudest (quieter is the background, its flicker no change). A jump is the 10 ms after a moment
// over the 10 ms before: 6 dB or more (twice the amplitude), the largest its way within 50 ms, at least twice the median
// change within 100 ms, so a ring that beats or a fast decay, changing as much from moment to moment, makes none, and
// its louder side 12 dB or more over the quietest tenth of the sound (the background, as trim.js reads it), so noise
// alone makes none. Measured on voice-overs (room noise 45 to 53 dB under the voice) and a fan's rumble: the noise's own
// 10 ms flicker reaches 6 to 15 dB, its hits 0 to 15 dB over the quietest tenth, a word's 25 to 60; 463 hits in a 49 s
// voice-over became 106, a rumble alone's 111 none, a sung take's 72 kept 67. In dB a decay or a swell is a steady slope,
// where a strike is a step: the onset as a relative change, Klapuri (ICASSP 1999), read both ways, so the cues of a
// reversed sound are its own, mirrored. Read again over 50 ms (SOUND steps) either side, so a sound that grows out of a
// ground flickering as much as it grows in 10 ms, a swell into a note or a phrase, steps as a strike does: a jump there
// with none its way at 10 ms within 50 ms is one too, its own scale's 50 ms apart and 100 ms around scaled with it. A
// blackbird's song (xeno-canto 1059970), a phrase swelling 23 dB in 120 ms out of a ground that flickers 4 to 8 dB each
// 10 ms, had no cue at its start; now one, where the ground ends. Each up lands where its attack starts (attacks()), each
// down where its sound stops (stops()), looked for from 1.5 × 12.5 ms before the jump to 12.5 ms after: the 10 ms either
// side of it that the finer scale compares, and half the 5 ms window attacks() reads; the coarser scale's jump is where
// its rise is steepest, which that finds the start of.
const STEP = .005, JUMP = 6, APART = .05, AROUND = .1, NEAR = .0125, RANGE = 40, OVER = 12, SOUND = 10
export function hits(channels, rate) {
  const { ups, downs } = jumps(channels, rate), near = Math.round(rate * NEAR)
  return [...attacks(ups.map(u => u[0]), channels, rate, near), ...stops(downs.map(d => d[0]), channels, rate, near)].sort((p, q) => p - q)
}
// The rises alone, where a sound strikes or a note or a word starts, not where one falls to a dip: { t, its attack's
// start, db, how far the level jumps there }, in time order, the larger the plainer to an ear
export function rises(channels, rate) {
  const { ups } = jumps(channels, rate)
  return attacks(ups.map(u => u[0]), channels, rate, Math.round(rate * NEAR)).map((t, i) => ({ t, db: ups[i][1] }))
}
// The jumps hits() keeps, [time, dB] each, in time order: { ups, downs }, a strike's, then a sound's where none of those is
function jumps(channels, rate) {
  const { e, hop, top } = power(channels, rate), strike = jumpsOver(e, top, 2), sound = jumpsOver(e, top, SOUND)
  const join = (fine, coarse) => [...fine, ...coarse.filter(([k]) => !fine.some(([f]) => Math.abs(f - k) <= SOUND))].sort((p, q) => p[0] - q[0]).map(([k, j]) => [k * hop / rate, j])
  return { ups: join(strike.ups, sound.ups), downs: join(strike.downs, sound.downs) }
}
// The jumps of the level over `m` steps, [step, dB] each: { ups, downs }
function jumpsOver(e, top, m) {
  const level = levels(e, top, m), K = level.length
  const background = Float64Array.from(level).sort()[Math.floor(K * .1)] ?? -Infinity
  const jump = new Float64Array(K)
  for (let k = m; k < K - 1; k++) jump[k] = level[k] - level[k - m]
  const apart = Math.round(APART / STEP * m / 2), around = Math.round(AROUND / STEP * m / 2), ups = [], downs = []
  for (let k = m; k < K - 1; k++) {
    const j = Math.abs(jump[k])
    if (j < JUMP) continue
    // the largest its way within `apart`, the earlier of two alike: looked for nearest first, where a larger one mostly is
    const beaten = i => i >= m && i <= K - 2 && Math.sign(jump[i]) === Math.sign(jump[k]) && (Math.abs(jump[i]) > j || Math.abs(jump[i]) === j && i < k)
    let largest = true
    for (let d = 1; largest && d <= apart; d++) if (beaten(k - d) || beaten(k + d)) largest = false
    if (!largest) continue
    const near = []
    for (let i = Math.max(m, k - around); i <= Math.min(K - 2, k + around); i++) if (Math.abs(i - k) > m) near.push(Math.abs(jump[i]))
    near.sort((p, q) => p - q)
    if (j < 2 * (near[near.length >> 1] ?? 0)) continue
    // the louder side: after a rise, before a fall
    if ((jump[k] > 0 ? Math.max(level[k], level[k + 1]) : Math.max(level[k - m], level[k - m - 1] ?? -Infinity)) - background < OVER) continue
    ;(jump[k] > 0 ? ups : downs).push([k, j])
  }
  return { ups, downs }
}
// Each STEP's power, the channels' mean square, and the loudest: { e, hop, top }; read once for the same channels (rises
// then plainness, a cue finder's two passes)
const powers = new WeakMap()
function power(channels, rate) {
  const was = powers.get(channels)
  if (was?.rate === rate) return was
  const n = channels[0]?.length ?? 0, hop = Math.max(1, Math.round(rate * STEP)), K = Math.floor(n / hop)
  const e = new Float64Array(K)
  let top = 0
  for (let k = 0; k < K; k++) {
    let s = 0
    for (const x of channels) for (let i = k * hop; i < (k + 1) * hop; i++) s += x[i] * x[i]
    top = Math.max(top, e[k] = s / hop / channels.length)
  }
  const out = { e, hop, top, rate }
  powers.set(channels, out)
  return out
}
// The level every STEP, of the `m` steps from there, in dB down to RANGE under the loudest step (`top`)
function levels(e, top, m) {
  const floor = Math.max(1e-10, top * 10 ** (-RANGE / 10)), K = e.length
  return Float64Array.from(e, (v, k) => { let s = 0; for (let i = k; i < Math.min(K, k + m); i++) s += e[i]; return 10 * Math.log10(Math.max(floor, s / Math.min(m, K - k))) })
}

// How plain each of `times` (in time order) is as a cue: { rank, how far the level steps across it, dB: the loudest
// 10 ms within 100 ms on its louder side over the loudest on its quieter side as far as the time beside it; peak, the
// largest sample on its louder side, to the time beside it: the sound it starts or ends }. A sound's start out of a
// pause ranks as far as the sound is over the pause, a short pause's too (its edges' quieter side the pause alone), a
// strike as far as it is over what sounded since the cue before, an edge between two flickers of the ground a few dB.
export function plainness(times, channels, rate) {
  if (!times.length) return []
  const { e, hop, top } = power(channels, rate), level = levels(e, top, 2), K = level.length, w = Math.round(AROUND / STEP)
  const ground = 10 * Math.log10(Math.max(1e-10, top * 10 ** (-RANGE / 10)))
  // the loudest of the 10 ms windows from step `a` up to `b`, the one before `b` at least
  const loudest = (a, b) => { let p = ground; for (let k = Math.max(0, Math.min(a, b - 1)); k < Math.min(K, b); k++) p = Math.max(p, level[k]); return p }
  // the largest sample from `a` up to `b` s
  const peak = (a, b) => { let p = 0; for (const x of channels) for (let i = Math.max(0, Math.round(a * rate)), end = Math.min(x.length, Math.round(b * rate)); i < end; i++) p = Math.max(p, Math.abs(x[i])); return p }
  const step = t => t * rate / hop
  return times.map((t, i) => {
    // the windows wholly before it and wholly after it, within 100 ms; and of those, the ones short of the time beside it
    const k = step(t), lo = Math.floor(k) - 1, hi = Math.ceil(k), prev = i ? times[i - 1] : 0, next = i < times.length - 1 ? times[i + 1] : Infinity
    const before = loudest(lo - w, lo), after = loudest(hi, hi + w), since = loudest(Math.max(lo - w, Math.ceil(step(prev))), lo), until = loudest(hi, Math.min(hi + w, Math.floor(step(next)) - 1))
    return { rank: Math.max(after - since, before - until), peak: Math.max(peak(prev, t), peak(t, next)) }
  })
}

audio.fn.hits = async function(opts) {
  let { at, duration } = named(opts) || {}
  at = parseTime(at); duration = parseTime(duration)
  let ranged = at != null || duration != null, pcm = await this.read(ranged ? { at, duration } : undefined)
  let from = at == null ? 0 : at < 0 ? Math.max(0, this.duration + at) : at
  return Float64Array.from(hits(pcm, this.sampleRate), t => t + from)
}
audio.stat('hits', {})
