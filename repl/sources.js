// Where sound comes from: files, the microphone, a sound search, the built-in samples.
// Each becomes a name the script opens with audio('name').
import { samples, RATE } from '../site/samples.js'

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

// Records from the microphone, sample for sample: an AudioWorklet hands over every block. The context starts in the
// click that asks to record, so it runs even when the permission prompt takes a while.
// Returns { level, stop(): { channels, sampleRate }, cancel() }; `level` is the latest block's peak.
export async function record() {
  const context = new AudioContext()
  context.resume()
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } })
    const url = URL.createObjectURL(new Blob([`registerProcessor('take', class extends AudioWorkletProcessor {
      process([input]) { if (input?.length) this.port.postMessage(input.map(c => c.slice())); return true }
    })`], { type: 'text/javascript' }))
    await context.audioWorklet.addModule(url)
    URL.revokeObjectURL(url)
    const source = context.createMediaStreamSource(stream), node = new AudioWorkletNode(context, 'take', { numberOfOutputs: 0 })
    const blocks = [], take = { level: 0 }
    node.port.onmessage = ({ data }) => {
      blocks.push(data)
      let peak = 0
      for (const channel of data) for (const v of channel) if (Math.abs(v) > peak) peak = Math.abs(v)
      take.level = peak
    }
    source.connect(node)
    const release = () => { node.port.onmessage = null; source.disconnect(); stream.getTracks().forEach(t => t.stop()); context.close() }
    take.stop = () => {
      release()
      const length = blocks.reduce((n, b) => n + b[0].length, 0), count = blocks.reduce((n, b) => Math.max(n, b.length), 0)
      const channels = Array.from({ length: count }, (_, i) => {
        const out = new Float32Array(length)
        let at = 0
        for (const b of blocks) { out.set(b[i] ?? b[0], at); at += b[0].length }
        return out
      })
      return { channels, sampleRate: context.sampleRate }
    }
    take.cancel = release
    return take
  } catch (error) { context.close(); throw error }
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
