/**
 * Room tone: fill digital silence with the recording's own room tone (iZotope RX Ambience Match class).
 *
 * a.roomtone()                    → every stretch of digital silence (edited-out pauses, pad()) sounds like the room
 * a.trim().pad(1.5, 2).roomtone() → an audiobook chapter: 1.5 s of room tone before, 2 s after (ACX: 1 to 5 s)
 *
 * ACX rejects "digital silence instead of room tone": a pause cut to zero, or a head pasted from generated
 * silence, drops the room out and back in. The tone comes from the room between words: the quietest stretches
 * of the recording that hold still for 0.3 s (their 0.1 s grains within 3 dB), 20 dB or more under its loudest
 * tenth, or all of it when all of it is that still sound; it fills each silent run as half-overlapped Hann grains
 * of them, drawn at random, so a long gap doesn't loop audibly, and meets the recording at each edge through a
 * 5 ms crossfade. Silence: every channel under `threshold` (-90 dBFS, a 16-bit LSB) for at least 10 ms. No room
 * to take (all silence; or every pause gated or cut, the quietest left a word's tail, which never holds still):
 * nothing changes, rather than the gaps filling with murmur. Needs the whole signal (whole-render).
 */
import audio from '../core.js'

const GRAIN = 0.1, MIN = 0.01, XF = 0.005, PAUSE = 0.3, STILL = 3, UNDER = 20

/** Seeded uniform [0, 1): the same input fills the same way (renders are reproducible). */
const rng = seed => () => (seed = (seed * 16807) % 2147483647) / 2147483647

function roomtone(input, output, ctx) {
  let sr = ctx.sampleRate, n = input[0].length, nch = input.length
  for (let c = 0; c < nch; c++) output[c].set(input[c])
  let lim = 10 ** ((ctx.threshold ?? -90) / 20), minRun = Math.round(MIN * sr)
  // silent frames: every channel under the threshold
  let quiet = new Uint8Array(n)
  for (let i = 0; i < n; i++) { let q = 1; for (let c = 0; c < nch && q; c++) if (Math.abs(input[c][i]) >= lim) q = 0; quiet[i] = q }
  let runs = []
  for (let i = 0; i < n;) {
    if (!quiet[i]) { i++; continue }
    let s = i
    while (i < n && quiet[i]) i++
    if (i - s >= minRun) runs.push([s, i])
  }
  if (!runs.length) return
  // silence is the runs, not a lone sample near zero (room noise crosses zero all the time)
  let G = Math.min(n, Math.round(GRAIN * sr)), hop = G >> 1, silent = new Uint32Array(n + 1)
  quiet.fill(0)
  for (let [s, e] of runs) quiet.fill(1, s, e)
  for (let i = 0; i < n; i++) silent[i + 1] = silent[i] + quiet[i]
  // the room: 0.1 s grains that hold no silence, from the quietest stretch that holds still for PAUSE s (each grain
  // within STILL dB of its quietest), and every such stretch as quiet as it; grains are drawn from them at random.
  // A word's soft tail never holds still that long: where every pause is silence (gated, cut), nothing here is the
  // room, and nothing changes rather than the gaps filling with murmur
  let level = []
  for (let i = 0; i + G <= n; i += hop) {
    if (silent[i + G] - silent[i]) { level.push(NaN); continue }
    let e = 0
    for (let c = 0; c < nch; c++) for (let j = i; j < i + G; j++) e += input[c][j] * input[c][j]
    level.push(10 * Math.log10(e / (G * nch) + 1e-30))
  }
  let still = [], R = Math.max(1, Math.round((PAUSE - GRAIN) / (hop / sr)) + 1)
  for (let k = 0; k + R <= level.length; k++) {
    let w = level.slice(k, k + R)
    if (w.every(v => v === v) && Math.max(...w) - Math.min(...w) <= STILL) still.push([Math.max(...w), k])
  }
  if (!still.length) return
  // and under the program by UNDER dB (its loudest tenth of grains), a held vowel or note holding still too; or the
  // program itself is that still sound (all of it room)
  let heard = level.filter(v => v === v).sort((p, q) => p - q), loud = heard[Math.floor(0.9 * (heard.length - 1))]
  let floor = still.reduce((m, s) => Math.min(m, s[0]), Infinity), room = new Set()
  if (!(floor <= loud - UNDER || loud - heard[Math.floor(0.1 * (heard.length - 1))] <= STILL)) return
  for (let [top, k] of still) if (top <= floor + STILL) for (let j = k; j < k + R; j++) room.add(j * hop)
  room = [...room]
  let rand = rng(room[0] + 1), X = Math.round(XF * sr)
  let hann = Float32Array.from({ length: G }, (_, k) => Math.sin(Math.PI * (k + 0.5) / G) ** 2)
  for (let [s, e] of runs) {
    let len = e - s, fill = Array.from({ length: nch }, () => new Float32Array(len + G))
    for (let g = -hop; g < len; g += hop) {
      let src = room[Math.floor(rand() * room.length)]
      for (let k = 0; k < G; k++) { let t = g + k; if (t < 0 || t >= len + G) continue; for (let c = 0; c < nch; c++) fill[c][t] += input[c][src + k] * hann[k] }
    }
    // meet the recording at the edges: the fill fades in over what was there, and out again
    // (a run at the file's start or end has no recording on that side to meet)
    for (let i = 0; i < len; i++) {
      let w = Math.min(s === 0 ? 1 : (i + 1) / X, e === n ? 1 : (len - i) / X, 1)
      for (let c = 0; c < nch; c++) output[c][s + i] = input[c][s + i] * (1 - w) + fill[c][i] * w
    }
  }
}

audio.op('roomtone', { params: ['threshold'], whole: roomtone })
