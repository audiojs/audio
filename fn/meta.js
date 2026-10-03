/**
 * Meta — instance API for container tags, pictures, markers, regions.
 *
 * Codec-specific byte parsers/writers live in @audio/decode/meta and @audio/encode/meta.
 * This file wires parsers into Audio instances: lazy parse on first access, plan-projected
 * markers/regions, picture URL helper. Encoders embed meta directly via @audio/encode.
 *
 *   a.meta                 → {title, artist, album, year, bpm, key, comment, pictures, raw, ...}
 *   a.meta.title = 'foo'   → mutation persists through save
 *   a.markers              → [{time, label}] in output seconds (plan-projected)
 *   a.regions              → [{at, duration, label}] in output seconds
 */

import audio, { named } from '../core.js'
import { buildPlan, dominant, planLen } from '../plan.js'
import * as parsers from '@audio/decode/meta'


// ── Picture helper ──────────────────────────────────────────────────────

/** Wrap picture bytes with a lazy `.url` getter (Blob URL in browser, data URL in Node). */
function pic(p, urls) {
  Object.defineProperty(p, 'url', {
    get() {
      if (this._url) return this._url
      if (typeof URL !== 'undefined' && typeof Blob !== 'undefined' && typeof URL.createObjectURL === 'function') {
        this._url = URL.createObjectURL(new Blob([this.data], { type: this.mime || 'image/jpeg' }))
        urls.add(this._url)
        return this._url
      }
      let b64 = typeof Buffer !== 'undefined' ? Buffer.from(this.data).toString('base64')
        : btoa(String.fromCharCode.apply(null, this.data))
      return this._url = `data:${this.mime || 'image/jpeg'};base64,${b64}`
    },
    enumerable: false, configurable: true
  })
  return p
}


// ── Parse/write entry points ────────────────────────────────────────────

function parseByFormat(format, bytes, urls) {
  if (!bytes?.length) return null
  let parse = parsers[format]
  if (!parse) return null
  try {
    let r = parse(bytes)
    if (r?.meta?.pictures) for (let p of r.meta.pictures) pic(p, urls)
    return r
  } catch { return null }
}

/** Lazy parse on first .meta/.markers/.regions access. Fills empty slots only. */
function ensureMeta(a) {
  if (a._.metaDone) return
  a._.metaDone = true
  let r = parseByFormat(a._.format, a._.header, a._.urls ??= new Set())
  if (!r) return
  if (!a._.meta) a._.meta = r.meta
  if (!a._.markers) a._.markers = r.markers || []
  if (!a._.regions) a._.regions = r.regions || []
}


// ── Instance API ────────────────────────────────────────────────────────

Object.defineProperties(audio.fn, {
  meta: {
    get() { ensureMeta(this); return this._.meta ||= {} },
    set(v) { this._.metaDone = true; this._.meta = v || {} },
    enumerable: true, configurable: true
  },
  markers: {
    get() { ensureMeta(this); place(this); return projectMarkers(this, this._.markers || []) },
    // what is set takes the place of the moments there are, those still to be placed too; a time in seconds is marked
    // (mark), a source sample kept as it is
    set(v) {
      this._.metaDone = true
      this._.markers = []
      this._.marks = this._.marks?.filter(m => ranged(m.time))
      for (let m of v || []) m.sample != null ? this._.markers.push({ sample: m.sample, label: m.label || '' }) : this.mark(m.time ?? 0, m.label)
    },
    enumerable: true, configurable: true
  },
  regions: {
    get() { ensureMeta(this); place(this); return projectRegions(this, this._.regions || []) },
    // as markers are set: the ranges, a range of no length none
    set(v) {
      this._.metaDone = true
      this._.regions = []
      this._.marks = this._.marks?.filter(m => !ranged(m.time))
      for (let r of v || []) r.sample != null ? this._.regions.push({ sample: r.sample, length: r.length ?? 0, label: r.label || '' })
        : r.duration > 0 && this.mark({ at: r.at ?? 0, duration: r.duration }, r.label)
    },
    enumerable: true, configurable: true
  }
})

/**
 * Mark a moment, or a range: `time` in seconds of the audio as it is now, after its edits, or `{ at, duration }`, and a
 * label; chainable. The mark keeps to what it marks through the edits after it, and saves as a cue or chapter
 * (save.js), a range as a region. What it marks is a sample of the source, or of a sound an edit put in; in silence (a
 * pad, a gap opened, a take written past the end), the sound nearest it, at the distance it is from it. A time past the
 * end is as far past the last sound: it marks the end until an edit after it makes the audio reach it.
 *   audio('talk.mp3').remove({ at: 0, duration: 5 }).mark(60, 'Part two').mark({ at: 90, d: 30 }, 'Q&A').save('talk.mp3')
 */
audio.fn.mark = function (time, label = '') {
  ;(this._.marks ||= []).push({ time, label: String(label ?? ''), n: this.edits?.length ?? 0 })
  place(this)
  return this
}

const ranged = time => !!time && typeof time === 'object'

// ── What a mark keeps to ────────────────────────────────────────────────
// A moment: { sample, ref?, offset? }, a sample of the source, or of `ref`, a sound an edit put in; in silence, the
// sample nearest it and `offset`, how far from it, in that sound's samples along it (so a speed or a reverse after it
// carries the distance as it carries the sound). A range: { sample, length, ref?, below?, above? }, the samples of the
// sound it starts on that it covers, and how far it runs on past their low and high ends, into silence or another sound.

/** Marks placed, once the audio says its rate (a file still opening has none yet: its marks wait, as its edits do), each
 *  where the edits before it took the audio. One whose timeline renders through an edit not yet prepared (trim() or
 *  normalize() after deepfilter(), which reads its input whole first) waits too, till the audio is read */
function place(a) {
  if (!a._.marks?.length || !(a._.sr || a.sampleRate)) return
  ensureMeta(a)
  let waiting = []
  for (let mark of a._.marks.splice(0)) {
    let { time, label, n } = mark, tl
    try { tl = timelineAt(a, n) }
    catch (e) { if (unprepared(a, n)) { waiting.push(mark); continue } throw e }
    let { segs, sr, end } = tl, { at, duration } = ranged(time) ? named(time) : { at: time }
    let sample = t => Math.max(0, Math.round((+t || 0) * sr))
    if (!(duration > 0)) {
      // past the end, as in silence after it: the sound nearest it and the distance, so an edit after it that makes the
      // audio longer (a take written past the end, a pad) takes it where it was put; while shorter, it marks the end
      let p = sample(at), m = segs ? keep(p, segs) : { sample: Math.min(end, p) }
      if (m) (a._.markers ||= []).push({ ...m, ...p > end && segs && { past: true }, label })
      continue
    }
    let p = sample(at), q = Math.max(p + 1, sample(+at + duration))
    let r = segs ? span(p, q, segs) : { sample: p, length: q - p }
    if (r) (a._.regions ||= []).push({ ...r, label })
  }
  a._.marks.push(...waiting)
}
/** Whether an edit among the first `n` has a preparation (a model's run over its input) not yet made for the audio as it
 *  is now (core.js loadOps) */
const unprepared = (a, n) => a._.prepared !== a.version && a.edits.slice(0, n).some(([type]) => audio.op(type)?.prepare)

/** The audio's timeline as its first `n` edits left it (all, by default): its segments and rate, and its end in samples;
 *  a source still arriving, unedited, none and no end yet (its samples are its own) */
function timelineAt(a, n = a.edits?.length ?? 0) {
  if (n) {
    let ref = a
    if (n < a.edits.length) { ref = audio.from(a, { sampleRate: a._.sr }); ref.edits = a.edits.slice(0, n); ref.version = n }
    let plan = buildPlan(ref)
    return { segs: plan.segs, sr: plan.sr, end: a.decoded ? planLen(plan.segs) : Infinity }
  }
  let sr = a._.sr || a.sampleRate
  return a.decoded ? { segs: a._.len ? [[0, a._.len, 0]] : [], sr, end: a._.len } : { segs: null, sr, end: Infinity }
}

// a timeline a segment reads through: a stage (a baked prefix), or the one a whole render rendered in place (plan.js)
const under = ref => ref?.segs ? ref : ref?._?.timeline

/** What an output sample plays: { sample, ref, rate }, a sample of the source (ref undefined) or of a sound an edit put
 *  in, and how many of its samples go by an output sample there (negative: backwards); null in silence */
function contentAt(p, segs) {
  for (let sg of segs) {
    if (sg[6] && !(sg = dominant(sg))) continue  // crossfade side: only where it's what's heard
    let from = sg[0], count = sg[1], to = sg[2], rate = sg[3] || 1, ref = sg[4], tl = under(ref)
    if (ref === null || p < to || p >= to + count) continue
    let idx = p - to, s = rate < 0 ? from + (count - 1 - idx) * -rate : from + idx * rate
    if (!tl) return { sample: Math.round(s), ref, rate }
    let c = contentAt(s, tl.segs)
    if (c) return { ...c, rate: c.rate * rate }
  }
  return null
}

/** Each output sample that plays `sample` of the source, or of `ref`, and the rate there: [[at, rate], …] */
function plays(sample, ref, segs) {
  let out = []
  for (let sg of segs) {
    if (sg[6] && !(sg = dominant(sg))) continue
    let from = sg[0], count = sg[1], to = sg[2], rate = sg[3] || 1, r = sg[4], tl = under(r)
    // a timeline under this one: through it, then this segment
    if (tl) { for (let [p, k] of plays(sample, ref, tl.segs)) for (let [q] of plays(p, undefined, [[from, count, to, rate]])) out.push([q, k * rate]); continue }
    if (r !== ref) continue
    let absR = Math.abs(rate), off = sample - from
    if (off < 0 || off >= count * absR) continue
    let idx = off / absR
    out.push([rate < 0 ? to + count - 1 - idx : to + idx, rate])
  }
  return out
}

/** Project a source sample to all output-sample positions via plan segments. */
export const remapSample = (m, segs) => plays(m, undefined, segs).map(p => p[0])

/** The output samples where sound begins and ends, through the timelines under it: where silence gives way */
function edges(segs) {
  let out = []
  for (let sg of segs) {
    if (sg[6] && !(sg = dominant(sg))) continue
    let from = sg[0], count = sg[1], to = sg[2], rate = sg[3] || 1, ref = sg[4], tl = under(ref)
    if (ref === null || !(count > 0)) continue
    out.push(to, to + count - 1)
    if (tl) for (let e of edges(tl.segs)) for (let [q] of plays(e, undefined, [[from, count, to, rate]])) out.push(Math.round(q))
  }
  return out
}

/** The sound nearest an output sample: { at, c }, the output sample and what it plays (contentAt); null in none */
function near(p, segs) {
  let best = null
  for (let q of edges(segs)) {
    if (best && Math.abs(q - p) >= Math.abs(best.at - p)) continue
    let c = contentAt(q, segs)
    if (c) best = { at: q, c }
  }
  return best
}

/** A moment at output sample p, as a mark keeps to it */
function keep(p, segs) {
  let c = contentAt(p, segs)
  if (c) return c.ref ? { sample: c.sample, ref: c.ref } : { sample: c.sample }
  let n = near(p, segs)
  if (!n) return null
  return { sample: n.c.sample, ...n.c.ref && { ref: n.c.ref }, offset: (p - n.at) * n.c.rate }
}

/** A range of output samples [p, q), as a mark keeps to it: from the sample its first sound plays to the last sample of
 *  that sound it plays, either way round (reversed); what it runs on past them, at either end. Silence alone, by the
 *  sound nearest it */
function span(p, q, segs) {
  let last = q - 1, inside = [p, last, ...edges(segs).filter(e => e > p && e < last)].sort((x, y) => x - y)
  let heard = inside.map(at => ({ at, c: contentAt(at, segs) })).filter(x => x.c)
  let first = heard[0] ?? near(p, segs)
  if (!first) return null
  let lastOf = heard.findLast(x => x.c.ref === first.c.ref) ?? first, c0 = first.c, c1 = lastOf.c
  let lo = Math.min(c0.sample, c1.sample), hi = Math.max(c0.sample, c1.sample), run = { below: 0, above: 0 }
  // the range's start before its first sound, its end after the last: on the side of the sound each lies by
  run[c0.rate > 0 ? 'below' : 'above'] += (first.at - p) * Math.abs(c0.rate)
  run[c1.rate > 0 ? 'above' : 'below'] += (last - lastOf.at) * Math.abs(c1.rate)
  return { sample: lo, length: hi - lo + 1, ...c0.ref && { ref: c0.ref }, ...run.below && { below: run.below }, ...run.above && { above: run.above } }
}


// ── Plan-aware projection ───────────────────────────────────────────────

function projectMarkers(a, markers) {
  if (!markers.length) return []
  let { segs, sr, end } = timelineAt(a), out = []
  if (!segs) return markers.map(m => ({ time: m.sample / sr, label: m.label }))
  for (let m of markers) for (let [p, k] of plays(m.sample, m.ref, segs)) {
    let at = p + (m.offset ?? 0) / k
    if (m.past && at > end) at = end
    if (at >= 0 && at <= end) out.push({ time: at / sr, label: m.label })
  }
  return out.sort((a, b) => a.time - b.time)
}

/**
 * Project the content [a0, b0) of the source, or of `ref`, through every plan segment independently (not paired by
 * index — a structural op like repeat() can duplicate one endpoint's segment but not the other's, so start/end must
 * each be mapped per-segment then merged, never zipped): [[p0, p1, e0, e1, rate], …], each piece's output span, which
 * end of the content its ends are ('below', 'above', or null where a segment cuts it), and the rate at each.
 */
function pieces(a0, b0, ref, segs) {
  let out = []
  for (let sg of segs) {
    if (sg[6] && !(sg = dominant(sg))) continue  // crossfade side: only where it's what's heard
    let from = sg[0], count = sg[1], to = sg[2], rate = sg[3] || 1, r = sg[4], tl = under(r), absR = Math.abs(rate)
    // [lo, hi) of what this segment reads, its ends e0 and e1, into the output
    let put = (lo, hi, e0, e1, k0, k1) => {
      let x0 = Math.max(lo, from), x1 = Math.min(hi, from + count * absR)
      if (x1 <= x0) return
      if (x0 > lo) e0 = null
      if (x1 < hi) e1 = null
      let u0 = (x0 - from) / absR, u1 = (x1 - from) / absR
      out.push(rate < 0 ? [to + count - u1, to + count - u0, e1, e0, k1 * rate, k0 * rate] : [to + u0, to + u1, e0, e1, k0 * rate, k1 * rate])
    }
    if (tl) for (let [p0, p1, e0, e1, k0, k1] of pieces(a0, b0, ref, tl.segs)) put(p0, p1, e0, e1, k0, k1)
    else if (r === ref) put(a0, b0, 'below', 'above', 1, 1)
  }
  return out
}

function projectRegions(a, regions) {
  if (!regions.length) return []
  let { segs, sr, end } = timelineAt(a), out = []
  if (!segs) return regions.map(r => ({ at: r.sample / sr, duration: r.length / sr, label: r.label }))
  for (let r of regions) {
    let ivs = pieces(r.sample, r.sample + r.length, r.ref, segs).sort((x, y) => x[0] - y[0]), merged = []
    for (let iv of ivs) {
      let last = merged.at(-1)
      if (!last || iv[0] > last[1] + 1e-9) { merged.push(iv.slice()); continue }
      if (iv[1] > last[1]) { last[1] = iv[1]; last[3] = iv[3]; last[5] = iv[5] }
    }
    // what it runs on past its sound, at an end that is the sound's own
    for (let [p0, p1, e0, e1, k0, k1] of merged) {
      let lo = Math.max(0, p0 - (r[e0] ?? 0) / Math.abs(k0)), hi = Math.min(end, p1 + (r[e1] ?? 0) / Math.abs(k1))
      if (hi > lo) out.push({ at: lo / sr, duration: (hi - lo) / sr, label: r.label })
    }
  }
  return out.sort((a, b) => a.at - b.at)
}
