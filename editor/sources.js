// Where sound comes from: files, the microphone, a sound search, the built-in samples.
// Each becomes a name the script opens with audio('name').
import { samples, RATE } from '../site/samples.js'
import { cycle } from './meters.js'

// A name that is free in `taken`: voice.wav, voice-2.wav, …
export function unique(name, taken) {
  if (!taken.has(name)) return name
  const [, base, ext = ''] = name.match(/^(.*?)(\.\w+)?$/)
  let i = 2
  while (taken.has(`${base}-${i}${ext}`)) i++
  return `${base}-${i}${ext}`
}

// The built-in samples, made on first use: chime.wav, handpan.wav, …
export const builtins = Object.fromEntries(Object.entries(samples).map(([name, s]) => [`${name}.wav`, s.description]))
export function sample(name) {
  const make = samples[name.replace(/\.wav$/, '')]?.make
  return make && { channels: make(), sampleRate: RATE }
}

// The microphone, open, sample for sample: an AudioWorklet hands over every block. Opened in the press that asks to
// record, its context starts in that gesture, so it runs even when the permission prompt takes a while; its module
// loads while the browser asks. Nothing is kept until take(onblock): from then each block goes to `onblock`, the
// channels of it, and stop() returns them all. `channels`: 1, the input's first alone (a voice, one microphone, as
// a recorder takes it, mono, however many the device gives: a laptop's twin the same); 2, both as the device gives them.
// { sampleRate, recent, heard, trace(t), take(onblock), stop(): { channels, sampleRate }, cancel() }: `recent` holds
// each channel's last 16384 samples (the meters read them), `heard` is the RMS of the last 50 ms, and trace(t) eases one
// cycle of them into the trace t (meters.js).
export async function microphone({ channels = 1 } = {}) {
  const context = new AudioContext()
  context.resume()
  const url = URL.createObjectURL(new Blob([`registerProcessor('take', class extends AudioWorkletProcessor {
    constructor(o) { super(); this.k = o.processorOptions.channels }
    process([input]) { if (input?.length) this.port.postMessage(input.slice(0, this.k).map(c => c.slice())); return true }
  })`], { type: 'text/javascript' }))
  const asked = navigator.mediaDevices.getUserMedia({ audio: { channelCount: { ideal: channels }, echoCancellation: false, noiseSuppression: false, autoGainControl: false } })
  try {
    const [stream] = await Promise.all([asked, context.audioWorklet.addModule(url)])
    const source = context.createMediaStreamSource(stream), node = new AudioWorkletNode(context, 'take', { numberOfOutputs: 0, processorOptions: { channels } })
    const rate = context.sampleRate, blocks = [], mic = { sampleRate: rate, recent: [] }
    let onblock = null
    Object.defineProperty(mic, 'heard', { get() {
      const x = mic.recent, n = x[0]?.length ?? 0, w = Math.round(rate * .05)
      let sum = 0
      for (let i = n - w; i < n; i++) { let v = 0; for (const c of x) v += c[i]; v /= x.length; sum += v * v }
      return x.length ? Math.sqrt(sum / w) : 0
    } })
    mic.trace = t => cycle(mic.recent, (mic.recent[0]?.length ?? 0) - 1600, rate, t)
    mic.take = f => { onblock = f }
    node.port.onmessage = ({ data }) => {
      if (onblock) { blocks.push(data); onblock(data) }
      // each channel's latest, sliding
      if (mic.recent.length !== data.length) mic.recent = data.map(() => new Float32Array(16384))
      const n = data[0].length
      mic.recent.forEach((x, c) => { x.copyWithin(0, n); x.set(data[c], x.length - n) })
    }
    source.connect(node)
    const release = () => { node.port.onmessage = null; source.disconnect(); stream.getTracks().forEach(t => t.stop()); context.close() }
    mic.stop = () => {
      release()
      const length = blocks.reduce((n, b) => n + b[0].length, 0), count = blocks.reduce((n, b) => Math.max(n, b.length), 0)
      const channels = Array.from({ length: count }, (_, i) => {
        const out = new Float32Array(length)
        let at = 0
        for (const b of blocks) { out.set(b[i] ?? b[0], at); at += b[0].length }
        return out
      })
      return { channels, sampleRate: rate }
    }
    mic.cancel = release
    return mic
  } catch (error) {
    // the microphone let go, had it opened
    asked.then(stream => stream.getTracks().forEach(t => t.stop()), () => {})
    context.close()
    throw error
  } finally { URL.revokeObjectURL(url) }
}

// Sounds to search: Openverse (openverse.org) indexes Freesound, Jamendo and Wikimedia Commons, with licenses,
// and needs no key. Anonymous use is limited to 20 searches a minute.
export async function search(query, { page = 1, signal } = {}) {
  const url = `https://api.openverse.org/v1/audio/?q=${encodeURIComponent(query)}&page=${page}&page_size=20`
  const response = await fetch(url, { signal })
  if (response.status === 429) throw new Error('Too many searches for now. Try again in a minute.')
  if (!response.ok) throw new Error(`Search failed (${response.status}).`)
  const { results = [], result_count: total = 0 } = await response.json()
  return {
    total,
    results: results.filter(r => r.url).map(r => ({
      title: r.title || 'Untitled',
      creator: r.creator || 'unknown',
      provider: r.source || r.provider,
      duration: r.duration ? r.duration / 1000 : null,
      license: `${r.license === 'cc0' ? 'CC0' : r.license === 'pdm' ? 'Public domain' : 'CC ' + r.license.toUpperCase()} ${r.license_version || ''}`.trim(),
      page: r.foreign_landing_url,
      url: r.url
    }))
  }
}
// The line a found sound brings into the script, so its credit travels with it.
export const credit = r => `// "${r.title.replace(/\n/g, ' ')}" by ${r.creator}, ${r.license}${r.page ? `, ${r.page.replace(/^https?:\/\//, '')}` : ''}`
