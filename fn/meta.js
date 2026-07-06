/**
 * Meta — instance API for container tags, pictures, markers, regions.
 *
 * Codec-specific byte parsers/writers live in audio-decode/meta and encode-audio/meta.
 * This file wires parsers into Audio instances: lazy parse on first access, plan-projected
 * markers/regions, picture URL helper. Encoders embed meta directly via encode-audio.
 *
 *   a.meta                 → {title, artist, album, year, bpm, key, comment, pictures, raw, ...}
 *   a.meta.title = 'foo'   → mutation persists through save
 *   a.markers              → [{time, label}] in output seconds (plan-projected)
 *   a.regions              → [{at, duration, label}] in output seconds
 */

import audio from '../core.js'
import { buildPlan } from '../plan.js'
import * as parsers from 'audio-decode/meta'


// ── Picture helper ──────────────────────────────────────────────────────

/** Wrap picture bytes with a lazy `.url` getter (Blob URL in browser, data URL in Node). */
function pic(p) {
  Object.defineProperty(p, 'url', {
    get() {
      if (this._url) return this._url
      if (typeof URL !== 'undefined' && typeof Blob !== 'undefined' && typeof URL.createObjectURL === 'function')
        return this._url = URL.createObjectURL(new Blob([this.data], { type: this.mime || 'image/jpeg' }))
      let b64 = typeof Buffer !== 'undefined' ? Buffer.from(this.data).toString('base64')
        : btoa(String.fromCharCode.apply(null, this.data))
      return this._url = `data:${this.mime || 'image/jpeg'};base64,${b64}`
    },
    enumerable: false, configurable: true
  })
  return p
}


// ── Parse/write entry points ────────────────────────────────────────────

function parseByFormat(format, bytes) {
  if (!bytes?.length) return null
  let parse = parsers[format]
  if (!parse) return null
  try {
    let r = parse(bytes)
    if (r?.meta?.pictures) for (let p of r.meta.pictures) pic(p)
    return r
  } catch { return null }
}

/** Lazy parse on first .meta/.markers/.regions access. Fills empty slots only. */
function ensureMeta(a) {
  if (a._.metaDone) return
  a._.metaDone = true
  let r = parseByFormat(a._.format, a._.header)
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
    get() { ensureMeta(this); return projectMarkers(this, this._.markers || []) },
    set(v) { this._.metaDone = true; this._.markers = (v || []).map(m => toSrcMarker(this, m)) },
    enumerable: true, configurable: true
  },
  regions: {
    get() { ensureMeta(this); return projectRegions(this, this._.regions || []) },
    set(v) { this._.metaDone = true; this._.regions = (v || []).map(r => toSrcRegion(this, r)) },
    enumerable: true, configurable: true
  }
})

function toSrcMarker(a, m) {
  let sr = a._.sr || a.sampleRate
  let sample = m.sample != null ? m.sample : Math.round((m.time ?? 0) * sr)
  return { sample, label: m.label || '' }
}
function toSrcRegion(a, r) {
  let sr = a._.sr || a.sampleRate
  let sample = r.sample != null ? r.sample : Math.round((r.at ?? 0) * sr)
  let length = r.length != null ? r.length : Math.round((r.duration ?? 0) * sr)
  return { sample, length, label: r.label || '' }
}


// ── Plan-aware projection ───────────────────────────────────────────────

/** Project a source-sample to all output-sample positions via plan segments. */
export function remapSample(m, segs) {
  let out = []
  for (let sg of segs) {
    let from = sg[0], count = sg[1], to = sg[2], rate = sg[3] || 1, ref = sg[4]
    if (ref !== undefined) continue  // skip silence (ref=null) and ref segments
    let absR = Math.abs(rate)
    let off = m - from
    if (off < 0 || off >= count * absR) continue
    let idx = off / absR
    let outPos = rate < 0 ? to + count - 1 - idx : to + idx
    out.push(outPos)
  }
  return out
}

function projectMarkers(a, markers) {
  if (!markers.length) return []
  let plan = a.edits?.length ? buildPlan(a) : null
  let segs = plan ? plan.segs : [[0, a._.len, 0]]
  let sr = plan ? plan.sr : a._.sr
  let out = []
  for (let m of markers) {
    for (let p of remapSample(m.sample, segs)) out.push({ time: p / sr, label: m.label })
  }
  out.sort((a, b) => a.time - b.time)
  return out
}

/**
 * Project a source [a,b) region through every plan segment independently (not paired by
 * index — a structural op like repeat() can duplicate one endpoint's segment but not the
 * other's, so start/end must each be mapped per-segment then merged, never zipped).
 */
function projectRegionRange(a0, b0, segs) {
  let ivs = []
  for (let sg of segs) {
    let from = sg[0], count = sg[1], to = sg[2], rate = sg[3] || 1, ref = sg[4]
    if (ref !== undefined) continue  // skip silence (ref=null) and ref segments
    let absR = Math.abs(rate)
    let lo = Math.max(a0, from), hi = Math.min(b0, from + count * absR)
    if (hi <= lo) continue
    let p0 = rate < 0 ? to + count - (lo - from) / absR : to + (lo - from) / absR
    let p1 = rate < 0 ? to + count - (hi - from) / absR : to + (hi - from) / absR
    ivs.push(p0 < p1 ? [p0, p1] : [p1, p0])
  }
  if (!ivs.length) return []
  ivs.sort((x, y) => x[0] - y[0])
  let merged = [ivs[0]]
  for (let i = 1; i < ivs.length; i++) {
    let last = merged[merged.length - 1], [s, e] = ivs[i]
    if (s <= last[1] + 1e-9) last[1] = Math.max(last[1], e)
    else merged.push([s, e])
  }
  return merged
}

function projectRegions(a, regions) {
  if (!regions.length) return []
  let plan = a.edits?.length ? buildPlan(a) : null
  let segs = plan ? plan.segs : [[0, a._.len, 0]]
  let sr = plan ? plan.sr : a._.sr
  let out = []
  for (let r of regions) {
    for (let [lo, hi] of projectRegionRange(r.sample, r.sample + r.length, segs))
      out.push({ at: lo / sr, duration: (hi - lo) / sr, label: r.label })
  }
  out.sort((a, b) => a.at - b.at)
  return out
}
