import encode from 'encode-audio'
import { render, buildPlan, streamPlan } from '../history.js'

/** Stream-encode chunks into format. Yields Uint8Array chunks. */
async function* streamEncode(chunks, sr, ch, fmt, meta) {
  if (!encode[fmt]) throw new Error('Unknown format: ' + fmt)
  let enc = await encode[fmt]({ sampleRate: sr, channels: ch, ...meta })
  for (let chunk of chunks) {
    let buf = await enc(chunk)
    if (buf.length) yield buf
  }
  let final = await enc()
  if (final.length) yield final
}

export default (audio) => {
  /** Save audio to file path (Node) or writable handle (browser). */
  audio.fn.save = async function(target, opts = {}) {
    let fmt = opts.format ?? (typeof target === 'string' ? target.split('.').pop() : 'wav')

    // Try streaming encode (avoids loading all PCM into WASM at once)
    let plan = buildPlan(this)
    if (plan && streamEncode) {
      let chunks = streamPlan(this, plan)
      let encoded = streamEncode(chunks, this.sampleRate, this.channels, fmt, opts.meta)

      if (typeof target === 'string') {
        let { createWriteStream } = await import('fs')
        let ws = createWriteStream(target)
        for await (let buf of encoded) ws.write(Buffer.from(buf))
        await new Promise((resolve, reject) => { ws.on('finish', resolve); ws.on('error', reject); ws.end() })
      } else if (target?.write) {
        for await (let buf of encoded) await target.write(buf)
        await target.close?.()
      }
      return
    }

    // Fallback: whole-file encode
    let bytes = await this.read({ format: fmt, meta: opts.meta })
    if (typeof target === 'string') {
      let { writeFile } = await import('fs/promises')
      await writeFile(target, Buffer.from(bytes))
    } else if (target?.write) { await target.write(bytes); await target.close?.() }
  }
}
