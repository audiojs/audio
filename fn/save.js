import audio, { emit, parseTime, fromEnd, LOAD } from '../core.js'
import { buildPlan, streamPlan, ensurePlan, loadRefs } from '../plan.js'
import encode from '@audio/encode'

const FMT_ALIAS = { aif: 'aiff', oga: 'ogg', mov: 'mp4', m4v: 'mp4' }

/** Encoder factory for a format — codec atoms extend the bundled set (built-ins
 *  win for formats they already serve, mirroring the decode side's precedence). */
function encoderFor(fmt) {
  return encode[fmt] || audio.codecs?.[fmt]?.encode
}

function resolveFormat(fmt) {
  if (typeof fmt === 'string') fmt = fmt.toLowerCase()
  return FMT_ALIAS[fmt] || fmt || 'wav'
}

/** Snapshot meta/markers/regions for the encoder, in output-sample positions. */
function gatherMeta(inst, opts) {
  if (opts.meta === false) return null
  let meta = opts.meta && typeof opts.meta === 'object' ? opts.meta : inst.meta
  let sr = inst.sampleRate
  let markers = (opts.markers ?? inst.markers ?? []).map(m => ({ sample: Math.round(m.time * sr), label: m.label || '' }))
  let regions = (opts.regions ?? inst.regions ?? []).map(r => ({ sample: Math.round(r.at * sr), length: Math.round(r.duration * sr), label: r.label || '' }))
  let hasAny = (meta && Object.keys(meta).some(k => k !== 'raw' && k !== 'pictures' && meta[k] != null && meta[k] !== '')) ||
    meta?.pictures?.length || markers.length || regions.length
  if (!hasAny) return null
  return { meta: meta || {}, markers, regions }
}

// Integer/float depths each lossless encoder writes (32 = float where the format stores it)
const DEPTHS = { wav: [16, 24, 32], aiff: [16, 24], caf: [16, 32], flac: [16, 24], wv: [16, 24, 32], m4a: [16, 24, 32], mp4: [16, 24, 32] }
// Encoder options save() forwards: bitDepth, bitrate (kbps), quality (VBR / codec
// quality), codec (m4a/mp4 track), compression (flac level)
const ENCODE_OPTS = ['bitDepth', 'bitrate', 'quality', 'codec', 'compression']

/** Encoder settings from save opts. Lossless output keeps the source's stored depth
 *  (smallest depth the format writes that holds it): a 24-bit master stays 24-bit.
 *  m4a/mp4 (chpl) and mp3 (ID3 CHAP) carry markers and region starts as chapters. */
function encodeOpts(inst, fmt, opts, m) {
  let o = {}
  for (let k of ENCODE_OPTS) if (opts[k] != null) o[k] = opts[k]
  let depths = DEPTHS[fmt], src = inst.bitDepth
  if (o.bitDepth == null && depths && src > 16) o.bitDepth = depths.find(d => d >= src) ?? depths.at(-1)
  if ((fmt === 'm4a' || fmt === 'mp4' || fmt === 'mp3') && m) {
    let sr = inst.sampleRate
    let ch = [...m.markers.map(x => ({ time: x.sample / sr, title: x.label })), ...m.regions.map(x => ({ time: x.sample / sr, title: x.label }))]
    if (ch.length) o.chapters = ch.sort((a, b) => a.time - b.time)
  }
  return o
}

/** True when ISO-BMFF bytes carry a video track (an `hdlr` box with handler type `vide`). */
function hasVideo(b) {
  for (let i = 4; i + 16 <= b.length; i++)
    if (b[i] === 104 && b[i + 1] === 100 && b[i + 2] === 108 && b[i + 3] === 114   // 'hdlr'
      && b[i + 12] === 118 && b[i + 13] === 105 && b[i + 14] === 100 && b[i + 15] === 101) return true  // 'vide'
  return false
}

/** Container bytes of an MP4/MOV source with a video track. Saving it to .mp4/.mov/.m4v
 *  swaps only the audio track (@audio/encode-mp4 remux), picture copied untouched. */
async function videoSource(inst, fmt, opts) {
  if (fmt !== 'mp4' || opts.video === false) return null
  let src = inst.source
  if (typeof src === 'string') {
    if (/^\w+:\/\//.test(src)) return null
    try { src = new Uint8Array(await (await import('fs/promises')).readFile(src)) } catch { return null }
  }
  else if (src instanceof ArrayBuffer) src = new Uint8Array(src)
  else if (ArrayBuffer.isView(src)) src = new Uint8Array(src.buffer, src.byteOffset, src.byteLength)
  return src instanceof Uint8Array && hasVideo(src) ? src : null
}

/** #27 — a zero-length range would silently produce a header-only file. Fails
 *  before the sink opens, so an existing target file isn't truncated first. */
async function assertFrames(inst, opts, verb) {
  if (inst._.waiters && !inst.decoded) return  // live source: length unknown until it ends
  await inst[LOAD]()
  let at = await fromEnd(inst, parseTime(opts.at)) ?? 0
  let dur = parseTime(opts.duration) ?? inst.duration - at
  if (Math.round(Math.min(dur, inst.duration - at) * inst.sampleRate) < 1)
    throw new Error(`${verb}: nothing to ${verb} — empty range (audio is ${(inst.duration || 0).toFixed(3)}s)`)
}

// Samples of DSP rendered synchronously between I/O awaits (~3s stereo ≈ 1 MB).
// Enough sustained sync work that V8 tiers up the DSP hot loop; without it, a
// per-block `await` keeps the FFT-heavy ops (pitch/stretch/denoise) in baseline JIT
// for the whole file — ~10× slower on a one-shot encode. Measured knee: full speed
// from 1<<14 (16 blocks), 10× slow at 1<<13; 1<<17 is 8× above the knee while
// keeping the worst event-loop stall ~60 ms (heaviest op burst) — no spinner/UI freeze.
const ENCODE_BATCH = 1 << 17

/** Stream-encode audio: calls sink(buf) per chunk, then sink(null, head) at the end, `head` being
 *  the bytes to write over the start of the output (the header with its final totals), if any.
 *  `stream`: the encoder emits as it goes, metadata in the header, memory flat however long the
 *  output (@audio/encode `stream: true`); else it may hold output to write an exact header. */
async function encodeStream(inst, fmt, opts, sink, stream) {
  // sampleRate/channels are metadata — constructing the encoder before decode reported
  // them baked in undefined (mp3 defaulted to stereo and threw on mono files)
  if (inst._.ready) await inst._.ready
  // Live (pushable, still receiving) sources can't be planned ahead — stream per block.
  // A chain carrying a whole-render op can't stream either way: fall through to the
  // planned path, whose LOAD waits decode out (crashed on undefined bus before).
  let live = !!inst._.waiters && !inst.decoded && !inst.edits?.some(e => audio.op?.(e[0])?.whole)
  // an MP4 streams fragmented: for a live source only, a finished one keeps moov-first, which every player reads
  if (fmt === 'm4a' || fmt === 'mp4') stream &&= live
  let offset = await fromEnd(inst, parseTime(opts.at)), duration = parseTime(opts.duration), plan = null, frames
  if (!live) {
    await inst[LOAD]()
    await loadRefs(inst)
    plan = buildPlan(inst)
    // the length streamPlan renders: known upfront, the streamed header is exact from the start
    let s = Math.round((offset || 0) * plan.sr)
    frames = (duration != null ? s + Math.round(duration * plan.sr) : plan.totalLen) - s
  }
  let m = gatherMeta(inst, opts)
  let enc = await encoderFor(fmt)({ sampleRate: inst.sampleRate, channels: inst.channels, ...(m || {}), ...encodeOpts(inst, fmt, opts, m), ...(stream && { stream: true, frames }) })
  let total = opts.duration != null ? parseTime(opts.duration) : null  // inst.duration builds the plan — defer past LOAD/live

  if (live) {
    total ??= inst.duration
    let written = 0, t = performance.now()
    for await (let chunk of inst.stream({ at: offset, duration })) {
      let buf = await enc(chunk)
      if (buf.length) await sink(buf)
      written += chunk[0].length
      let now = performance.now()
      if (now - t > 8) { await new Promise(r => setTimeout(r, 0)); t = performance.now() }
      emit(inst, 'progress', { offset: written / inst.sampleRate, total })
    }
    if (!written) throw new Error('encode: nothing to encode — source ended empty')
  } else {
    // Decoded source: drive the DSP through the synchronous plan generator in bursts,
    // crossing an `await` only for I/O between bursts. Identical output to read() (one
    // continuous pass, no seam re-warm), but the hot loop stays hot enough to optimize.
    total ??= inst.duration
    await ensurePlan(inst, plan, offset, duration)
    let sr = inst.sampleRate, written = 0, batch = [], batchLen = 0
    let drain = async () => {
      for (let chunk of batch) {
        let buf = await enc(chunk)
        if (buf.length) await sink(buf)
        written += chunk[0].length
        emit(inst, 'progress', { offset: written / sr, total })
      }
      batch = []; batchLen = 0
    }
    for (let chunk of streamPlan(inst, plan, offset, duration)) {
      batch.push(chunk.map(c => c.slice())); batchLen += chunk[0].length  // copy: streamPlan reuses buffers
      if (batchLen >= ENCODE_BATCH) await drain()
    }
    if (batchLen) await drain()
  }

  let final = await enc()
  if (final.length) await sink(final)
  return sink(null, enc.head?.() || null)
}

/** Encode audio to bytes. */
audio.fn.encode = async function(fmt, opts = {}) {
  if (typeof fmt === 'object') { opts = fmt; fmt = undefined }
  fmt = resolveFormat(fmt)
  if (!encoderFor(fmt)) throw new Error(`encode: unknown format '${fmt}'`)
  await assertFrames(this, opts, 'encode')
  let parts = [], head = null
  await encodeStream(this, fmt, opts, (buf, h) => { if (buf) parts.push(buf); else head = h })
  let total = 0; for (let p of parts) total += p.length
  let out = new Uint8Array(total), pos = 0
  for (let p of parts) { out.set(p, pos); pos += p.length }
  if (head) out.set(head, 0)
  return out
}

/** Save audio to file path (Node) or writable handle (browser). */
audio.fn.save = async function(target, opts = {}) {
  let fmt = opts.format ?? (typeof target === 'string' ? target.split('.').pop() : 'wav')
  fmt = resolveFormat(fmt)
  if (!encoderFor(fmt)) throw new Error(`save: unknown format '${fmt}'`)
  await assertFrames(this, opts, 'save')

  // finish(head): end the output, writing `head` over its start where the target can seek (a file,
  // a browser file handle); a pipe keeps the streamed header, its totals saying "unknown"
  let write, finish
  if (typeof target === 'string') {
    let { createWriteStream } = await import('fs')
    let ws = createWriteStream(target)
    let err = null
    // Attached at creation, not inside finish() — an 'error' event with no listener crashes the process
    ws.on('error', e => { err = e })
    write = buf => {
      if (err) throw err  // abort the encode loop on the next write instead of writing to a dead stream
      // backpressure: wait for drain (or an error), then leave no listener behind
      if (!ws.write(Buffer.from(buf))) return new Promise((res, rej) => {
        let settle = e => { ws.off('drain', settle); ws.off('error', settle); e ? rej(e) : res() }
        ws.on('drain', settle); ws.on('error', settle)
      })
    }
    finish = async head => {
      await new Promise((res, rej) => {
        if (err) return rej(err)
        ws.on('finish', res); ws.on('error', rej); ws.end()
      })
      if (!head) return
      let fh = await (await import('fs/promises')).open(target, 'r+')
      try { await fh.write(head, 0, head.length, 0) } finally { await fh.close() }
    }
  } else if (target?.write) {
    write = buf => target.write(buf)
    finish = async head => {
      if (head && typeof target.seek === 'function') { await target.seek(0); await target.write(head) }
      return target.close?.()
    }
  } else throw new Error('Invalid save target')

  let video = await videoSource(this, fmt, opts)
  if (video) {
    let { remux } = await import('@audio/encode-mp4/remux')
    await write(remux(video, await this.encode(fmt, opts)))
    return finish?.()
  }
  await encodeStream(this, fmt, opts, (buf, head) => buf ? write(buf) : finish(head), true)
}
