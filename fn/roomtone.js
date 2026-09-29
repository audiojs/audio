/**
 * Room tone: fill digital silence with the recording's own room tone (iZotope RX Ambience Match class).
 *
 * a.roomtone()                    → every stretch of digital silence (edited-out pauses, pad()) sounds like the room
 * a.trim().pad(1.5, 2).roomtone() → an audiobook chapter: 1.5 s of room tone before, 2 s after (ACX: 1 to 5 s)
 *
 * ACX rejects "digital silence instead of room tone": a pause cut to zero, or a head pasted from generated
 * silence, drops the room out and back in. The tone comes from the quietest hundredth of the recording's
 * 0.1 s stretches that hold no silence (the room between words); it fills each silent run as half-overlapped
 * Hann grains of them, drawn at random, so a long gap doesn't loop audibly, and meets the recording at each
 * edge through a 5 ms crossfade. Silence: every channel under `threshold` (-90 dBFS, a 16-bit LSB) for at
 * least 10 ms. No room tone to take (all silence): nothing changes. Needs the whole signal (whole-render).
 */
import audio from '../core.js'

const GRAIN = 0.1, MIN = 0.01, XF = 0.005

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
  // the room: the quietest hundredth (at least five) of the 0.1 s grains that hold no silence, wherever they are
  // (between words, before a gate closes): a file with few pauses has soft speech in its quietest twentieth;
  // grains are drawn from them at random
  let cand = []
  for (let i = 0; i + G <= n; i += hop) {
    if (silent[i + G] - silent[i]) continue
    let e = 0
    for (let c = 0; c < nch; c++) for (let j = i; j < i + G; j++) e += input[c][j] * input[c][j]
    cand.push([e, i])
  }
  if (!cand.length) return
  cand.sort((a, b) => a[0] - b[0])
  let room = cand.slice(0, Math.max(5, Math.ceil(cand.length / 100))).map(c => c[1]), rand = rng(room[0] + 1), X = Math.round(XF * sr)
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
