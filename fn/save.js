export default (audio) => {
  /** Save audio to file path (Node) or writable handle (browser). */
  audio.fn.save = async function(target, opts = {}) {
    let fmt = opts.format ?? (typeof target === 'string' ? target.split('.').pop() : 'wav')
    let bytes = await this.read({ format: fmt, meta: opts.meta })
    if (typeof target === 'string') {
      let { writeFile } = await import('fs/promises')
      await writeFile(target, Buffer.from(bytes))
    } else if (target?.write) { await target.write(bytes); await target.close?.() }
  }
}
