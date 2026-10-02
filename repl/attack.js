// Where each hit's attack starts, for a cut there to keep all of it. The onset stat reads energy in blocks
// (fn/beat.js, 1024 samples, 23 ms at 44.1 kHz), so a hit it finds can start up to a block before or after the time it
// gives. Around that time, on an envelope 5 ms wide every millisecond (wide enough that a tone's own cycles don't read
// as rises): the loudest window, the quietest before it, and the last window before the loudest still within 5% of the
// way up from one to the other (13 dB under the rise). The attack starts about halfway into that window, as a sharp
// strike comes into a window only at its end; then back to the zero crossing before it, within a millisecond, so a cut
// there starts from silence. On the built-in chime and handpan, whose strikes are known, this lands from 3.5 ms before
// each strike to half a millisecond into one that rises over 2.5 ms (test/repl.test.js), where the blocks put hits
// 14 ms either side. A slice point, as librosa's onset_backtrack makes one (McFee et al. 2015), found from the rise
// rather than from the local minimum before it, which the ring of a struck bar puts inside its own attack. `channels`
// are the output's; each time comes back after the one before. `back` reads the channels from their end: the same
// search, for where a sound stops.
const WIDE = .005, HOP = .001, UP = .05
export default function attacks(times, channels, rate, block = 1024, back = false) {
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
// where it swells or dies away. The level is every 5 ms, of the 10 ms there, in dB down to 60 under the loudest (quieter
// is silence, its flicker no change). A jump is the 10 ms after a moment over the 10 ms before: 6 dB or more (twice the
// amplitude), the largest its way within 50 ms, and at least twice the median change within 100 ms, so a ring that
// beats or a fast decay, changing as much from moment to moment, makes none. In dB a decay or a swell is a steady
// slope, where a strike is a step: the onset as a relative change, Klapuri (ICASSP 1999), read both ways, so the cues of
// a reversed sound are its own, mirrored. Each up lands where its attack starts (attacks()), each down where its sound
// stops (stops()), looked for from 1.5 × 12.5 ms before the jump to 12.5 ms after: the 10 ms either side of it that it
// compares, and half the 5 ms window attacks() reads.
const STEP = .005, JUMP = 6, APART = .05, AROUND = .1, NEAR = .0125
export function hits(channels, rate) {
  const n = channels[0]?.length ?? 0, hop = Math.max(1, Math.round(rate * STEP)), K = Math.floor(n / hop)
  const e = new Float64Array(K)
  let top = 0
  for (let k = 0; k < K; k++) {
    let s = 0
    for (const x of channels) for (let i = k * hop; i < (k + 1) * hop; i++) s += x[i] * x[i]
    top = Math.max(top, e[k] = s / hop / channels.length)
  }
  const floor = Math.max(1e-10, top * 1e-6), level = Float64Array.from(e, (v, k) => 10 * Math.log10(Math.max(floor, (v + (e[k + 1] ?? v)) / 2)))
  const jump = new Float64Array(K)
  for (let k = 2; k < K - 1; k++) jump[k] = level[k] - level[k - 2]
  const apart = Math.round(APART / STEP), around = Math.round(AROUND / STEP), ups = [], downs = []
  for (let k = 2; k < K - 1; k++) {
    const j = Math.abs(jump[k])
    if (j < JUMP) continue
    let largest = true
    for (let i = Math.max(2, k - apart); largest && i <= Math.min(K - 2, k + apart); i++) if (i !== k && Math.sign(jump[i]) === Math.sign(jump[k]) && (Math.abs(jump[i]) > j || Math.abs(jump[i]) === j && i < k)) largest = false
    if (!largest) continue
    const near = []
    for (let i = Math.max(2, k - around); i <= Math.min(K - 2, k + around); i++) if (Math.abs(i - k) > 2) near.push(Math.abs(jump[i]))
    near.sort((p, q) => p - q)
    if (j < 2 * (near[near.length >> 1] ?? 0)) continue
    ;(jump[k] > 0 ? ups : downs).push(k * hop / rate)
  }
  const near = Math.round(rate * NEAR)
  return [...attacks(ups, channels, rate, near), ...stops(downs, channels, rate, near)].sort((p, q) => p - q)
}
