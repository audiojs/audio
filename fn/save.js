import encode from 'encode-audio'

const FMT_ALIAS = { aif: 'aiff', oga: 'ogg' }

export default (audio) => {
  /** Save audio to file path (Node) or writable handle (browser). */
  audio.fn.save = async function(target, opts = {}) {
    let fmt = opts.format ?? (typeof target === 'string' ? target.split('.').pop() : 'wav')
    fmt = FMT_ALIAS[fmt] || fmt
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

    for await (let chunk of this.stream()) {
      let buf = await enc(chunk)
      if (buf.length) write(buf)
      written += chunk[0].length
      onprogress?.({ offset: written / sr, total: this.duration })
    }
    let final = await enc()
    if (final.length) write(final)
    await finish?.()
  }
}
