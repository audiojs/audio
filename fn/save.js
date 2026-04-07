import audio from '../core.js'
import encode from 'encode-audio'

const FMT_ALIAS = { aif: 'aiff', oga: 'ogg' }

function resolveFormat(fmt) { return FMT_ALIAS[fmt] || fmt || 'wav' }

/** Encode audio to bytes. */
audio.fn.encode = async function(fmt, opts = {}) {
  if (typeof fmt === 'object') { opts = fmt; fmt = undefined }
  fmt = resolveFormat(fmt)
  if (!encode[fmt]) throw new Error('Unknown format: ' + fmt)

  let enc = await encode[fmt]({ sampleRate: this.sampleRate, channels: this.channels, ...opts.meta })
  let parts = []
  for await (let chunk of this.stream({at: opts.at, duration: opts.duration})) {
    let buf = await enc(chunk)
    if (buf.length) parts.push(buf)
  }
  let final = await enc()
  if (final.length) parts.push(final)
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

  let sr = this.sampleRate, ch = this.channels
  let enc = await encode[fmt]({ sampleRate: sr, channels: ch, ...opts.meta })
  let onprogress = opts.onprogress, written = 0

  let write, finish
  if (typeof target === 'string') {
    let { createWriteStream } = await import('fs')
    let ws = createWriteStream(target)
    write = buf => ws.write(Buffer.from(buf))
    finish = () => new Promise((res, rej) => { ws.on('finish', res); ws.on('error', rej); ws.end() })
  } else if (target?.write) {
    write = buf => target.write(buf)
    finish = () => target.close?.()
  } else throw new Error('Invalid save target')

  let tick = 0
  for await (let chunk of this.stream()) {
    let buf = await enc(chunk)
    if (buf.length) write(buf)
    written += chunk[0].length
    if (++tick % 2 === 0) await new Promise(r => setTimeout(r, 0))
    onprogress?.({ offset: written / sr, total: this.duration })
  }
  let final = await enc()
  if (final.length) write(final)
  await finish?.()
}
