// The speech bench/rx/deplosive.mjs, deess.mjs and debreath.mjs share, and their filters and frame measures.
//
// VoiceBank clean (Valentini-Botinhao et al. 2016, CC BY 4.0, doi:10.7488/ds/2117), 48 kHz, close-miked read speech:
// `tune`, every 4th of the 504 training utterances (28 speakers, ~/.cache/audiojs/data/vbdemand-train/clean); `test`,
// every 3rd of the 824 test utterances (p232, p257, vbdemand/clean_testset_wav). Joined into reels of up to 60 s, one
// speaker each, 20 ms equal-power crossfades at the joins, as a take is processed whole. Narrations: the first 60 s of
// ten Spoken Wikipedia recordings each (48 kHz float32): `tune`, spoken-train/; `test`, spoken/ (bench/speech.mjs's
// rooms-train and rooms).
import { readdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import path from 'node:path'
import { highpass, lowpass, process as bq } from '@audio/biquad'
import { readWav, rx, DATA } from './lib.mjs'

export const db = v => 10 * Math.log10(v + 1e-30)
export const pct = (v, p) => { let s = Float64Array.from(v).sort(); return s[Math.floor(p * (s.length - 1))] }
/** x through biquad sections in series (a copy, Float64) */
export const sos = (x, cs) => { let y = Float64Array.from(x); for (let c of cs) bq(y, c); return y }
/** the same forward and backward: zero phase, the magnitude squared */
export const zp = (x, cs) => sos(sos(x, cs).reverse(), cs).reverse()
/** 4th-order Butterworth sections */
export const lp4 = (f, sr) => [lowpass(f, 0.5412, sr), lowpass(f, 1.3066, sr)]
export const hp4 = (f, sr) => [highpass(f, 0.5412, sr), highpass(f, 1.3066, sr)]

const VB = { tune: ['vbdemand-train/clean', 4], test: ['vbdemand/clean_testset_wav', 3] }
/** VoiceBank utterances joined into reels, one speaker each (one session, one room), 20 ms equal-power crossfades at
 *  the joins: [{ name, x, sr }] */
export function voicebank(set) {
  let [d, k] = VB[set], dir = path.join(DATA, d), out = [], cur = [], len = 0, who, sr
  let files = readdirSync(dir).filter(f => f.endsWith('.wav')).sort().filter((_, i) => i % k === 0)
  let flush = () => {
    let F = Math.round(0.02 * sr), x = new Float32Array(len - F * (cur.length - 1)), o = 0
    for (let c of cur) {
      if (o) for (let i = 0; i < F; i++) x[o + i] = x[o + i] * Math.cos(Math.PI / 2 * (i + 0.5) / F) + c[i] * Math.sin(Math.PI / 2 * (i + 0.5) / F)
      x.set(o ? c.subarray(F) : c, o ? o + F : 0); o += c.length - F
    }
    out.push({ name: `vb-${set}-${who}-${out.filter(r => r.who === who).length}`, who, x, sr }); cur = []; len = 0
  }
  for (let f of files) {
    let w = readWav(path.join(dir, f)), s = f.split('_')[0]
    if (len && s !== who) flush()
    who = s; sr = w.sr; cur.push(w.ch[0]); len += w.ch[0].length
    if (len >= 60 * sr) flush()
  }
  if (len) flush()
  return out
}

/** the narrations: [{ name, x, sr }] */
export function narrations(set) {
  let dir = path.join(DATA, set === 'tune' ? 'spoken-train' : 'spoken')
  return readdirSync(dir).filter(f => f.endsWith('.f32')).sort().map((f, i) => {
    let b = readFileSync(path.join(dir, f))
    return { name: `nr-${set}-${i}`, x: new Float32Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)).subarray(0, 60 * 48000), sr: 48000 }
  })
}

/** per 10 ms frame: energy, and Talkin's (1995) normalized cross-correlation of the 50–1000 Hz band at 8 kHz, its peak
 *  over 2.5–16.7 ms lags (pitch 60–400 Hz) of a 40 ms window: voiced at ≥ 0.6 */
export function frames(x, sr) {
  let n = sr / 100, m = Math.floor(x.length / n), e = new Float64Array(m), r = new Float64Array(m)
  for (let k = 0; k < m; k++) { let s = 0; for (let i = k * n; i < (k + 1) * n; i++) s += x[i] * x[i]; e[k] = s / n }
  let b = sos(sos(x, hp4(50, sr)), lp4(1000, sr)), d = Math.round(sr / 8000), q = sr / d
  let y = Float64Array.from({ length: Math.floor(b.length / d) }, (_, i) => b[i * d]), W = Math.round(0.04 * q), lo = Math.floor(q / 400), hi = Math.ceil(q / 60)
  for (let k = 0; k < m; k++) {
    let c = Math.round((k * n + n / 2) / d) - (W >> 1), e0 = 0
    if (c < 0 || c + W + hi > y.length) continue
    for (let i = 0; i < W; i++) e0 += y[c + i] ** 2
    if (!(e0 > 1e-14)) continue
    for (let t = lo; t <= hi; t++) {
      let xy = 0, e1 = 0
      for (let i = 0; i < W; i++) xy += y[c + i] * y[c + i + t], e1 += y[c + i + t] ** 2
      r[k] = Math.max(r[k], xy / Math.sqrt(e0 * e1 + 1e-30))
    }
  }
  return { e, r, n, m }
}

/** energy per 10 ms frame of x through `cs` */
export function bandFrames(x, sr, cs) {
  let y = cs.length ? sos(x, cs) : x, n = sr / 100, m = Math.floor(x.length / n), e = new Float64Array(m)
  for (let k = 0; k < m; k++) { let s = 0; for (let i = k * n; i < (k + 1) * n; i++) s += y[i] * y[i]; e[k] = s / n }
  return e
}

/** RX `plugin` as lib.mjs's rx(), a job tried twice: a host that dies (it has, once in hours) is restarted by the next */
export const rxRetry = (plugin, params) => { let f = rx(plugin, params); return async y => { try { return await f(y) } catch { return f(y) } } }

/** A system's scores on a set, kept by its key in a JSON `file` (renders are deterministic and are not kept: made again
 *  when a key is new). `fn()` → the scores. */
export async function scored(file, key, fn) {
  let read = () => existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : {}, all = read()
  if (key in all) return all[key]
  let m = await fn()
  all = read(); all[key] = m; writeFileSync(file, JSON.stringify(all, null, 1))
  return m
}
