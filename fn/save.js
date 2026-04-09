import audio, { emit } from '../core.js'
import encode from 'encode-audio'

const FMT_ALIAS = { aif: 'aiff', oga: 'ogg' }

function resolveFormat(fmt) { return FMT_ALIAS[fmt] || fmt || 'wav' }

/** Stream-encode audio: calls sink(buf) per chunk, returns sink(null) at end. */
async function encodeStream(inst, fmt, opts, sink) {
  let enc = await encode[fmt]({ sampleRate: inst.sampleRate, channels: inst.channels, ...opts.meta })
  let written = 0, tick = 0
  for await (let chunk of inst.stream({ at: opts.at, duration: opts.duration })) {
    let buf = await enc(chunk)
    if (buf.length) await sink(buf)
    written += chunk[0].length
    if (++tick % 2 === 0) await new Promise(r => setTimeout(r, 0))
    emit(inst, 'progress', { offset: written / inst.sampleRate, total: opts.duration ?? inst.duration })
  }
  let final = await enc()
  if (final.length) await sink(final)
  return sink(null)
}

/** Encode audio to bytes. */
audio.fn.encode = async function(fmt, opts = {}) {
  if (typeof fmt === 'object') { opts = fmt; fmt = undefined }
  fmt = resolveFormat(fmt)
  if (!encode[fmt]) throw new Error('Unknown format: ' + fmt)
  let parts = []
  await encodeStream(this, fmt, opts, buf => { if (buf) parts.push(buf) })
  let total = parts.reduce((n, p) => n + p.length, 0)
  let out = new Uint8Array(total), pos = 0
  for (let p of parts) { out.set(p, pos); pos += p.length }
  return out
}

/** Save audio to file path (Node) or writable handle (browser). */
audio.fn.save = async function(target, opts = {}) {
  let fmt = opts.format ?? (typeof target === 'string' ? target.split('.').pop() : 'wav')
  fmt = resolveFormat(fmt)
  if (!encode[fmt]) throw new Error('Unknown format: ' + fmt)

  let write, finish
  if (typeof target === 'string') {
    let { createWriteStream } = await import('fs')
    let ws = createWriteStream(target)
    write = buf => { if (!ws.write(Buffer.from(buf))) return new Promise(r => ws.once('drain', r)) }
    finish = () => new Promise((res, rej) => { ws.on('finish', res); ws.on('error', rej); ws.end() })
  } else if (target?.write) {
    write = buf => target.write(buf)
    finish = () => target.close?.()
  } else throw new Error('Invalid save target')

  await encodeStream(this, fmt, opts, buf => buf ? write(buf) : finish?.())
}
