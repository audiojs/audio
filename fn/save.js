import audio, { emit, parseTime } from '../core.js'
import encode from '@audio/encode'

const FMT_ALIAS = { aif: 'aiff', oga: 'ogg' }

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

/** Stream-encode audio: calls sink(buf) per chunk, returns sink(null) at end. */
async function encodeStream(inst, fmt, opts, sink) {
  let m = gatherMeta(inst, opts)
  let enc = await encode[fmt]({ sampleRate: inst.sampleRate, channels: inst.channels, ...(m || {}) })
  let written = 0, t = performance.now()
  for await (let chunk of inst.stream({ at: opts.at, duration: opts.duration })) {
    let buf = await enc(chunk)
    if (buf.length) await sink(buf)
    written += chunk[0].length
    let now = performance.now()
    if (now - t > 8) { await new Promise(r => setTimeout(r, 0)); t = performance.now() }
    emit(inst, 'progress', { offset: written / inst.sampleRate, total: (opts.duration != null ? parseTime(opts.duration) : null) ?? inst.duration })
  }
  let final = await enc()
  if (final.length) await sink(final)
  return sink(null)
}

/** Encode audio to bytes. */
audio.fn.encode = async function(fmt, opts = {}) {
  if (typeof fmt === 'object') { opts = fmt; fmt = undefined }
  fmt = resolveFormat(fmt)
  if (!encode[fmt]) throw new Error(`encode: unknown format '${fmt}'`)
  let parts = []
  await encodeStream(this, fmt, opts, buf => { if (buf) parts.push(buf) })
  let total = 0; for (let p of parts) total += p.length
  let out = new Uint8Array(total), pos = 0
  for (let p of parts) { out.set(p, pos); pos += p.length }
  return out
}

/** Save audio to file path (Node) or writable handle (browser). */
audio.fn.save = async function(target, opts = {}) {
  let fmt = opts.format ?? (typeof target === 'string' ? target.split('.').pop() : 'wav')
  fmt = resolveFormat(fmt)
  if (!encode[fmt]) throw new Error(`save: unknown format '${fmt}'`)

  let write, finish
  if (typeof target === 'string') {
    let { createWriteStream } = await import('fs')
    let ws = createWriteStream(target)
    let err = null
    // Attached at creation, not inside finish() — an 'error' event with no listener crashes the process
    ws.on('error', e => { err = e })
    write = buf => {
      if (err) throw err  // abort the encode loop on the next write instead of writing to a dead stream
      if (!ws.write(Buffer.from(buf))) return new Promise((res, rej) => { ws.once('drain', res); ws.once('error', rej) })
    }
    finish = () => new Promise((res, rej) => {
      if (err) return rej(err)
      ws.on('finish', res); ws.on('error', rej); ws.end()
    })
  } else if (target?.write) {
    write = buf => target.write(buf)
    finish = () => target.close?.()
  } else throw new Error('Invalid save target')

  await encodeStream(this, fmt, opts, buf => buf ? write(buf) : finish?.())
}
