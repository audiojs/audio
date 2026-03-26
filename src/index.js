/**
 * audio — indexed, paged audio document with immutable source and declarative ops.
 *
 * import audio from 'audio'
 * let a = await audio('file.mp3')
 * a.gain(-3).trim().normalize()
 * await a.save('out.wav')
 */

import decode from 'audio-decode'
import encode from 'audio-encode'

export const PAGE_SIZE = 65536
export const BLOCK_SIZE = 1024


// ── Entry Points ─────────────────────────────────────────────────────────

export default async function audio(source, opts) {
  if (Array.isArray(source) && source[0] instanceof Float32Array) return Promise.resolve(fromChannels(source, opts))
  if (typeof source === 'number') return Promise.resolve(fromSilence(source, opts))
  return fromEncoded(await resolve(source), opts)
}

audio.from = function(source, opts) {
  if (Array.isArray(source) && source[0] instanceof Float32Array) return fromChannels(source, opts)
  if (typeof source === 'number') return fromSilence(source, opts)
  if (source?.getChannelData) {
    let chs = Array.from({ length: source.numberOfChannels }, (_, i) => new Float32Array(source.getChannelData(i)))
    return fromChannels(chs, { sampleRate: source.sampleRate, ...opts })
  }
  throw new TypeError('audio.from: expected Float32Array[], AudioBuffer, or number')
}

audio.define = function(name, optsOrFn, maybeFn) {
  let opts = {}, fn
  if (typeof optsOrFn === 'function') { fn = optsOrFn } else { opts = optsOrFn || {}; fn = maybeFn }
  if (typeof fn !== 'function') throw new TypeError(`audio.define: expected function for '${name}'`)
  if (ops[name]) throw new Error(`audio.define: '${name}' already registered`)
  ops[name] = { fn, args: opts.args || 0, index: !!opts.index, custom: true }
  proto[name] = function(...args) {
    let def = ops[name], arg, offset, duration
    if (def.args >= 1) { arg = args[0]; offset = args[1]; duration = args[2] }
    else { offset = args[0]; duration = args[1] }
    return pushEdit(this, { type: name, arg, offset, duration })
  }
}


// ── Source Resolution (browser + node) ───────────────────────────────────

async function resolve(source) {
  if (source instanceof ArrayBuffer) return source
  if (source instanceof Uint8Array) return source.buffer.slice(source.byteOffset, source.byteOffset + source.byteLength)
  if (source instanceof URL) return resolve(source.href)
  if (typeof source === 'string') {
    // URL — use fetch (works in browser + Node 18+)
    if (/^(https?|data|blob):/.test(source)) return (await fetch(source)).arrayBuffer()
    // file:// URI — convert to path
    if (source.startsWith('file:')) {
      let { fileURLToPath } = await import('url')
      source = fileURLToPath(source)
    }
    // File path — Node only (dynamic import, invisible to bundlers)
    let { readFile } = await import('fs/promises')
    let buf = await readFile(source)
    return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)
  }
  throw new TypeError('audio: unsupported source type')
}


// ── Create ───────────────────────────────────────────────────────────────

function create(pages, sampleRate, numberOfChannels, length, source) {
  let a = Object.create(proto)
  a.pages = pages
  a.sampleRate = sampleRate
  a.numberOfChannels = numberOfChannels
  a.length = length
  a.source = source
  a.edits = []
  a.version = 0
  a.onchange = null
  a.index = buildIndex(a)
  return a
}

function fromChannels(channelData, opts = {}) {
  let sr = opts.sampleRate || 44100, len = channelData[0].length, pages = []
  for (let off = 0; off < len; off += PAGE_SIZE)
    pages.push({ data: channelData.map(ch => ch.slice(off, Math.min(off + PAGE_SIZE, len))) })
  return create(pages, sr, channelData.length, len, null)
}

function fromSilence(seconds, opts = {}) {
  let sr = opts.sampleRate || 44100, ch = opts.channels || 1
  return fromChannels(Array.from({ length: ch }, () => new Float32Array(Math.round(seconds * sr))), { sampleRate: sr })
}

async function fromEncoded(buf, opts = {}) {
  let { channelData, sampleRate } = await decode(buf)
  let pages = [], len = channelData[0].length
  for (let off = 0; off < len; off += PAGE_SIZE)
    pages.push({ data: channelData.map(ch => ch.slice(off, Math.min(off + PAGE_SIZE, len))) })
  let a = create(pages, sampleRate, channelData.length, len, buf)

  if (opts.onprogress) {
    let blocks = a.index.min[0].length, bpp = Math.ceil(PAGE_SIZE / BLOCK_SIZE), prev = 0
    for (let p = 0; p < a.pages.length; p++) {
      let end = Math.min(prev + bpp, blocks)
      opts.onprogress({
        delta: { fromBlock: prev, min: a.index.min.map(arr => arr.slice(prev, end)), max: a.index.max.map(arr => arr.slice(prev, end)), energy: a.index.energy.map(arr => arr.slice(prev, end)) },
        offset: end * BLOCK_SIZE / a.sampleRate, total: a.length / a.sampleRate,
      })
      prev = end
    }
  }
  return a
}


// ── Index ────────────────────────────────────────────────────────────────

function buildIndex(a) {
  let ch = a.numberOfChannels, totalBlocks = Math.ceil(a.length / BLOCK_SIZE)
  let idx = {
    blockSize: BLOCK_SIZE,
    min: Array.from({ length: ch }, () => new Float32Array(totalBlocks)),
    max: Array.from({ length: ch }, () => new Float32Array(totalBlocks)),
    energy: Array.from({ length: ch }, () => new Float32Array(totalBlocks)),
  }
  let bi = 0
  for (let page of a.pages) {
    if (!page.data) { bi += Math.ceil(PAGE_SIZE / BLOCK_SIZE); continue }
    let pLen = page.data[0].length
    for (let off = 0; off < pLen; off += BLOCK_SIZE) {
      let end = Math.min(off + BLOCK_SIZE, pLen)
      for (let c = 0; c < ch; c++) {
        let s = page.data[c], mn = Infinity, mx = -Infinity, sum = 0
        for (let i = off; i < end; i++) { let v = s[i]; if (v < mn) mn = v; if (v > mx) mx = v; sum += v * v }
        idx.min[c][bi] = mn; idx.max[c][bi] = mx; idx.energy[c][bi] = sum / (end - off)
      }
      bi++
    }
  }
  return idx
}

function reindex(a, startBlock, endBlock) {
  let pcm = render(a, startBlock * BLOCK_SIZE / a.sampleRate, (endBlock - startBlock) * BLOCK_SIZE / a.sampleRate)
  for (let b = startBlock; b < endBlock && b < a.index.min[0].length; b++) {
    let off = (b - startBlock) * BLOCK_SIZE, end = Math.min(off + BLOCK_SIZE, pcm[0].length)
    for (let c = 0; c < a.numberOfChannels; c++) {
      let mn = Infinity, mx = -Infinity, sum = 0
      for (let i = off; i < end; i++) { let v = pcm[c][i]; if (v < mn) mn = v; if (v > mx) mx = v; sum += v * v }
      a.index.min[c][b] = mn; a.index.max[c][b] = mx; a.index.energy[c][b] = sum / (end - off)
    }
  }
}

function staleRange(a) {
  let stale = null
  for (let edit of a.edits) {
    let op = ops[edit.type]
    if (op?.index) continue  // index-safe — skip
    let s = edit.offset != null ? Math.floor(edit.offset * a.sampleRate / BLOCK_SIZE) : 0
    let e = edit.duration != null ? Math.ceil((edit.offset + edit.duration) * a.sampleRate / BLOCK_SIZE) : a.index.min[0].length
    if (!stale) stale = [s, e]; else { stale[0] = Math.min(stale[0], s); stale[1] = Math.max(stale[1], e) }
  }
  return stale
}


// ── Edit History ─────────────────────────────────────────────────────────

function pushEdit(a, edit) {
  a.edits.push(edit)
  a.version++
  a.onchange?.()
  return a
}


// ── Ops Registry ─────────────────────────────────────────────────────────
// Built-in ops: fn(chs, edit, sr) → chs. Custom ops (via audio.define) marked with custom: true.

const ops = {
  slice: { index: true, fn(chs, e, sr) {
    let s = Math.round((e.offset || 0) * sr)
    let end = e.duration != null ? s + Math.round(e.duration * sr) : chs[0].length
    return chs.map(ch => ch.slice(s, Math.min(end, ch.length)))
  }},

  remove: { index: true, fn(chs, e, sr) {
    let s = Math.round((e.offset || 0) * sr), d = Math.round((e.duration || 0) * sr)
    return chs.map(ch => {
      let o = new Float32Array(ch.length - d)
      o.set(ch.subarray(0, s))
      o.set(ch.subarray(s + d), s)
      return o
    })
  }},

  insert: { index: true, fn(chs, e, sr) {
    let p = Math.round((e.offset || 0) * sr), src = render(e.source)
    return chs.map((ch, c) => {
      let ins = src[c] || new Float32Array(src[0].length)
      let o = new Float32Array(ch.length + ins.length)
      o.set(ch.subarray(0, p))
      o.set(ins, p)
      o.set(ch.subarray(p), p + ins.length)
      return o
    })
  }},

  pad: { index: true, fn(chs, e, sr) {
    let n = Math.round((e.duration || 0) * sr)
    return chs.map(ch => {
      let o = new Float32Array(ch.length + n)
      if (e.side === 'start') o.set(ch, n); else o.set(ch)
      return o
    })
  }},

  repeat: { index: true, fn(chs, e) {
    let t = e.times || 1
    return chs.map(ch => {
      let o = new Float32Array(ch.length * (t + 1))
      for (let i = 0; i <= t; i++) o.set(ch, i * ch.length)
      return o
    })
  }},

  gain: { index: true, fn(chs, e, sr) {
    let f = 10 ** ((e.db || 0) / 20)
    let s = e.offset != null ? Math.round(e.offset * sr) : 0
    let end = e.duration != null ? s + Math.round(e.duration * sr) : chs[0].length
    return chs.map(ch => {
      let o = new Float32Array(ch)
      for (let i = s; i < Math.min(end, o.length); i++) o[i] *= f
      return o
    })
  }},

  fade: { fn(chs, e, sr) {
    let fadeIn = e.duration > 0, n = Math.round(Math.abs(e.duration) * sr)
    return chs.map(ch => {
      let o = new Float32Array(ch)
      if (fadeIn) for (let i = 0; i < Math.min(n, o.length); i++) o[i] *= i / n
      else { let s = o.length - n; for (let i = Math.max(0, s); i < o.length; i++) o[i] *= (o.length - i) / n }
      return o
    })
  }},

  reverse: { index: true, fn(chs, e, sr) {
    let s = e.offset != null ? Math.round(e.offset * sr) : 0
    let end = e.duration != null ? s + Math.round(e.duration * sr) : chs[0].length
    return chs.map(ch => { let o = new Float32Array(ch); o.subarray(s, Math.min(end, o.length)).reverse(); return o })
  }},

  mix: { fn(chs, e, sr) {
    let p = e.offset != null ? Math.round(e.offset * sr) : 0, src = render(e.source)
    return chs.map((ch, c) => {
      let o = new Float32Array(ch), m = src[c] || src[0]
      let n = e.duration != null ? Math.round(e.duration * sr) : m.length
      for (let i = 0; i < Math.min(n, m.length) && p + i < o.length; i++) o[p + i] += m[i]
      return o
    })
  }},

  write: { fn(chs, e, sr) {
    let p = e.offset != null ? Math.round(e.offset * sr) : 0
    return chs.map((ch, c) => {
      let o = new Float32Array(ch)
      let s = Array.isArray(e.data) ? (e.data[c] || e.data[0]) : e.data
      for (let i = 0; i < s.length && p + i < o.length; i++) o[p + i] = s[i]
      return o
    })
  }},
}


// ── Render (apply edits to source pages → PCM) ──────────────────────────

function render(a, offset, duration) {
  let sr = a.sampleRate, ch = a.numberOfChannels

  // Flatten pages
  let flat = Array.from({ length: ch }, () => new Float32Array(a.length))
  let pos = 0
  for (let page of a.pages) {
    if (!page.data) { pos += PAGE_SIZE; continue }
    for (let c = 0; c < ch; c++) flat[c].set(page.data[c], pos)
    pos += page.data[0].length
  }

  // Apply edits
  for (let edit of a.edits) {
    let op = ops[edit.type]
    if (!op) throw new Error(`Unknown op: ${edit.type}`)

    if (op.custom) {
      // Custom ops — apply per block within range
      let s = edit.offset != null ? Math.round(edit.offset * sr) : 0
      let e = edit.duration != null ? s + Math.round(edit.duration * sr) : flat[0].length
      let out = flat.map(ch => new Float32Array(ch))
      for (let off = s; off < e; off += BLOCK_SIZE) {
        let be = Math.min(off + BLOCK_SIZE, e, out[0].length)
        let block = out.map(ch => ch.subarray(off, be))
        let result = op.fn(block, edit.arg, { offset: off / sr, sampleRate: sr, blockSize: be - off })
        if (result && result !== block) for (let c = 0; c < out.length; c++) out[c].set(result[c], off)
      }
      flat = out
    } else {
      // Built-in ops — whole-audio transform
      flat = op.fn(flat, edit, sr)
    }
  }

  // Extract range
  if (offset != null) {
    let s = Math.round(offset * sr), e = duration != null ? s + Math.round(duration * sr) : flat[0].length
    flat = flat.map(ch => ch.slice(s, Math.min(e, ch.length)))
  }
  return flat
}


// ── Prototype (methods on every audio instance) ──────────────────────────

const proto = {
  get duration() { return this.length / this.sampleRate },
  get channels() { return this.numberOfChannels },

  // Structural
  slice(offset, duration) {
    let child = create(this.pages, this.sampleRate, this.numberOfChannels, this.length, this.source)
    child.index = this.index
    return pushEdit(child, { type: 'slice', offset, duration })
  },
  insert(other, offset) { return pushEdit(this, { type: 'insert', source: other, offset: offset ?? this.duration }) },
  remove(offset, duration) { return pushEdit(this, { type: 'remove', offset, duration }) },
  pad(duration, opts) { return pushEdit(this, { type: 'pad', duration, side: opts?.side || 'end' }) },
  repeat(times) { return pushEdit(this, { type: 'repeat', times }) },

  // Sample
  gain(db, offset, duration) { return pushEdit(this, { type: 'gain', db, offset, duration }) },
  fade(dur) { return pushEdit(this, { type: 'fade', duration: dur }) },
  reverse(offset, duration) { return pushEdit(this, { type: 'reverse', offset, duration }) },
  mix(other, offset, duration) { return pushEdit(this, { type: 'mix', source: other, offset, duration }) },
  write(data, offset) { return pushEdit(this, { type: 'write', data, offset }) },

  // Smart
  trim(threshold = -40) {
    let thresh = 10 ** (threshold / 20), blocks = this.index.min[0].length
    let s = 0, e = blocks - 1
    for (; s < blocks; s++) if (isBlockLoud(this, s, thresh)) break
    for (; e >= s; e--) if (isBlockLoud(this, e, thresh)) break
    let ss = findThresholdCrossing(this, s, thresh, 'start'), se = findThresholdCrossing(this, e, thresh, 'end')
    return pushEdit(this, { type: 'slice', offset: ss / this.sampleRate, duration: Math.max(0, (se - ss) / this.sampleRate) })
  },
  normalize(targetDb = 0) {
    let peak = 0
    for (let c = 0; c < this.numberOfChannels; c++)
      for (let i = 0; i < this.index.max[c].length; i++)
        peak = Math.max(peak, Math.abs(this.index.max[c][i]), Math.abs(this.index.min[c][i]))
    return pushEdit(this, { type: 'gain', db: targetDb - (peak > 0 ? 20 * Math.log10(peak) : -Infinity) })
  },

  // Undo — returns the popped edit (re-apply by calling the op method again)
  undo() {
    if (!this.edits.length) return null
    let edit = this.edits.pop()
    this.version++
    this.onchange?.()
    return edit
  },

  // Output
  async read(offset, duration, opts) {
    let pcm = render(this, offset, duration)
    if (opts?.format === 'int16') return pcm.map(ch => { let o = new Int16Array(ch.length); for (let i = 0; i < ch.length; i++) o[i] = Math.max(-32768, Math.min(32767, Math.round(ch[i] * 32767))); return o })
    if (opts?.format === 'uint8') return pcm.map(ch => { let o = new Uint8Array(ch.length); for (let i = 0; i < ch.length; i++) o[i] = Math.round((ch[i] + 1) * 127.5); return o })
    return pcm
  },
  async encode(format) {
    let fn = encode[format]
    if (!fn) throw new Error(`Unsupported format: ${format}`)
    return fn(render(this), { sampleRate: this.sampleRate })
  },
  async save(target) {
    let format = typeof target === 'string' ? target.split('.').pop() : 'wav'
    let bytes = await this.encode(format)
    if (typeof target === 'string') {
      let { writeFile } = await import('fs/promises')
      await writeFile(target, Buffer.from(bytes))
    } else if (target?.write) { await target.write(bytes); await target.close?.() }
  },

  // Analysis
  async limits(offset, duration) {
    let s = staleRange(this); if (s) reindex(this, s[0], s[1])
    let { min, max } = this.index
    let sb = offset != null ? Math.floor(offset * this.sampleRate / BLOCK_SIZE) : 0
    let eb = duration != null ? Math.ceil((offset + duration) * this.sampleRate / BLOCK_SIZE) : min[0].length
    let mn = Infinity, mx = -Infinity
    for (let c = 0; c < this.numberOfChannels; c++)
      for (let i = sb; i < Math.min(eb, min[c].length); i++) { if (min[c][i] < mn) mn = min[c][i]; if (max[c][i] > mx) mx = max[c][i] }
    return { min: mn, max: mx }
  },
  async loudness(offset, duration) {
    let s = staleRange(this); if (s) reindex(this, s[0], s[1])
    let { energy } = this.index
    let sb = offset != null ? Math.floor(offset * this.sampleRate / BLOCK_SIZE) : 0
    let eb = duration != null ? Math.ceil((offset + duration) * this.sampleRate / BLOCK_SIZE) : energy[0].length
    let winBlocks = Math.ceil(0.4 * this.sampleRate / BLOCK_SIZE), gates = []
    for (let i = sb; i < eb; i += winBlocks) {
      let we = Math.min(i + winBlocks, eb), sum = 0, n = 0
      for (let c = 0; c < this.numberOfChannels; c++) for (let j = i; j < we; j++) { sum += energy[c][j]; n++ }
      if (n > 0) gates.push(sum / n)
    }
    let absT = 10 ** (-70 / 10), gated = gates.filter(g => g > absT)
    if (!gated.length) return -Infinity
    let mean = gated.reduce((a, b) => a + b, 0) / gated.length
    let final = gated.filter(g => g > mean * 10 ** (-10 / 10))
    if (!final.length) return -Infinity
    return -0.691 + 10 * Math.log10(final.reduce((a, b) => a + b, 0) / final.length)
  },
  async peaks(count, opts) {
    let s = staleRange(this); if (s) reindex(this, s[0], s[1])
    let { min, max } = this.index, ch = opts?.channel, total = min[0].length, bpp = total / count
    let outMin = new Float32Array(count), outMax = new Float32Array(count)
    let cS = ch != null ? ch : 0, cE = ch != null ? ch + 1 : this.numberOfChannels
    for (let i = 0; i < count; i++) {
      let from = Math.floor(i * bpp), to = Math.floor((i + 1) * bpp), mn = Infinity, mx = -Infinity
      for (let c = cS; c < cE; c++) for (let j = from; j < Math.min(to, total); j++) { if (min[c][j] < mn) mn = min[c][j]; if (max[c][j] > mx) mx = max[c][j] }
      outMin[i] = mn === Infinity ? 0 : mn; outMax[i] = mx === -Infinity ? 0 : mx
    }
    return { min: outMin, max: outMax }
  },

  // Playback — returns controller, starts async
  play(offset = 0, duration) {
    let a = this
    let ctrl = { playing: false, currentTime: offset, ontimeupdate: null, onended: null, pause() { ctrl.playing = false }, stop() { ctrl.playing = false } }
    ;(async () => {
      ctrl.playing = true
      let speaker
      try { speaker = (await import('audio-speaker')).default } catch { }
      if (!speaker) { ctrl.playing = false; return }
      let pcm = render(a, offset, duration)
      let write = speaker({ sampleRate: a.sampleRate, channels: a.numberOfChannels })
      let chunk = Math.round(a.sampleRate * 0.1)
      for (let off = 0; off < pcm[0].length && ctrl.playing; off += chunk) {
        let end = Math.min(off + chunk, pcm[0].length)
        let interleaved = new Float32Array((end - off) * a.numberOfChannels)
        for (let i = 0; i < end - off; i++) for (let c = 0; c < a.numberOfChannels; c++) interleaved[i * a.numberOfChannels + c] = pcm[c][off + i]
        await new Promise(resolve => write(Buffer.from(interleaved.buffer), resolve))
        ctrl.currentTime = offset + (off + end) / 2 / a.sampleRate
        ctrl.ontimeupdate?.(ctrl.currentTime)
      }
      write(null); ctrl.playing = false; ctrl.onended?.()
    })()
    return ctrl
  },

  // Streaming
  async *stream(offset, duration) {
    let pcm = render(this, offset, duration), len = pcm[0].length
    for (let off = 0; off < len; off += PAGE_SIZE) yield pcm.map(ch => ch.slice(off, Math.min(off + PAGE_SIZE, len)))
  },

  toJSON() { return { edits: this.edits, sampleRate: this.sampleRate, channels: this.numberOfChannels, duration: this.duration } },
}


// ── Helpers ──────────────────────────────────────────────────────────────

function isBlockLoud(a, block, thresh) {
  for (let c = 0; c < a.numberOfChannels; c++)
    if (Math.abs(a.index.max[c][block]) > thresh || Math.abs(a.index.min[c][block]) > thresh) return true
  return false
}

function findThresholdCrossing(a, blockIdx, thresh, side) {
  let sampleStart = blockIdx * BLOCK_SIZE, pageIdx = Math.floor(sampleStart / PAGE_SIZE), page = a.pages[pageIdx]
  if (!page?.data) return sampleStart
  let off = sampleStart - pageIdx * PAGE_SIZE, end = Math.min(off + BLOCK_SIZE, page.data[0].length)
  if (side === 'start') {
    for (let i = off; i < end; i++) for (let c = 0; c < a.numberOfChannels; c++)
      if (Math.abs(page.data[c][i]) > thresh) return pageIdx * PAGE_SIZE + i
  } else {
    for (let i = end - 1; i >= off; i--) for (let c = 0; c < a.numberOfChannels; c++)
      if (Math.abs(page.data[c][i]) > thresh) return pageIdx * PAGE_SIZE + i + 1
  }
  return sampleStart
}

export { proto as Audio }
