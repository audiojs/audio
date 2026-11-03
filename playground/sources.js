// Where sound comes from: files, the microphone, a sound search, the built-in samples.
// Each becomes a name the script opens with audio('name').
import { samples, RATE } from './samples.js'

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

// The microphone, open, sample for sample: an AudioWorklet hands over every block. Nothing is kept until take(onblock):
// from then each block goes to `onblock`, the channels of it, until stop(). `channels`: 1, the input's first alone (a
// voice, one microphone, as a recorder takes it, mono, however many the device gives: a laptop's twin the same); 2, both
// as the device gives them.
// { sampleRate, recent, time, latency, take(onblock), stop(), cancel() }: each block to `onblock` as it comes, with the
// clock's time it came in at; `recent` holds each channel's last 16384 samples (the meters read them); `time` is the
// microphone's own clock, s, running on however late its blocks come; `latency`, s, how long a sound takes from the
// microphone to its clock, as the browser says (Chrome's, the track's own) and a render quantum.
// Opening it is the wait between Record and the take (the device's start, its context's, its module's: 0.3 to 1 s; a
// Mac's WebKit's, till its voice processor lets go, 4 s: settling), so it is opened once and kept: between takes, a take
// starts on the next block. The device is asked for first, its context
// made while it opens, in the press that asks to record so the context starts in that gesture; let go once the page is
// hidden, or KEEP ms after its last take (the browser's microphone light on till then), or when its device ends.
// Held (hold, the Mac app, as a DAW holds its input): opened as the page opens, the permission asked then, and never
// let go but for another channel count, so a take starts on the next block, its start long settled.
const KEEP = 60000
let input = null   // { channels, ready: the input, timer }
let holding = null // the channel count the input is held at, or null
export function hold(channels = 1) {
  holding = channels
  microphone({ channels }).then(mic => mic.cancel(), () => {})
}

// WebKit on a Mac (Safari, the Mac app) opens a voice processor with the microphone, whatever echoCancellation asks, and
// keeps it 3 s (its CoreAudioCaptureUnit's stored VPIO unit): till it lets go, the built-in microphone comes
// voice-processed, 15 to 20 dB down, then stops a tenth of a second as the device is set up again, and comes as it is
// (macOS 26.5's log: "creating AUVoiceProcessor" as the microphone is granted, "deallocateStoredVPIOUnit" 3.6 s on, then
// "Requesting config change for device: BuiltInMicrophoneDevice"). The input is ready once that silence is past, or
// SETTLE ms on where none comes: a take never starts in it. Its first half second or so has a silence too, the speakers
// set up as the voice processor joins them: no silence ending in the input's first SOON s counts
const VPIO = navigator.vendor === 'Apple Computer, Inc.' && navigator.platform === 'MacIntel' && !navigator.maxTouchPoints
const SETTLE = 5000, GAP = 2048, SOON = 2.5
// `done` once, after sound, a run of silence GAP samples or more ending `soon` samples or more into the input has given
// way to sound GAP samples on end: a microphone is never silent to the sample (its noise floor), so a run of nothing
// is the device stopped; another however short after it, the device not going yet
export function settling(done, soon = 0) {
  let heard = false, still = 0, gone = false, back = 0, n = 0
  return x => {
    n += x.length
    if (!x.some(v => v !== 0)) {
      if (heard && (still += x.length) >= GAP && n >= soon) gone = true
      back = 0
      return
    }
    heard = true
    still = 0
    if (gone && (back += x.length) >= GAP) done()
  }
}

export async function microphone({ channels = 1 } = {}) {
  if (input && input.channels !== channels && !input.taken) release(input)
  const held = input ??= open(channels)
  clearTimeout(held.timer)
  let i
  try { i = await held.ready } catch (error) { if (input === held) input = null; throw error }
  const mic = { sampleRate: i.sampleRate, latency: i.latency, get recent() { return i.recent }, get time() { return i.context.currentTime } }
  // the take this handle took, and only that one, let go by it: another's handle (an arming let go late) stops nothing
  let mine = false
  mic.take = f => { held.taken = mine = true; i.onblock = f }
  // the take let go, the input kept for the next
  mic.stop = mic.cancel = () => {
    if (mine) mine = held.taken = false, i.onblock = null
    clearTimeout(held.timer)
    if (holding !== held.channels) held.timer = setTimeout(() => { if (!held.taken) release(held) }, KEEP)
  }
  return mic
}

function open(channels) {
  const asked = navigator.mediaDevices.getUserMedia({ audio: { channelCount: { ideal: channels }, echoCancellation: false, noiseSuppression: false, autoGainControl: false } })
  const context = new AudioContext()
  context.resume()
  const url = URL.createObjectURL(new Blob([`registerProcessor('take', class extends AudioWorkletProcessor {
    constructor(o) { super(); this.k = o.processorOptions.channels }
    process([input]) { if (input?.length) this.port.postMessage({ x: input.slice(0, this.k).map(c => c.slice()), t: currentTime }); return true }
  })`], { type: 'text/javascript' }))
  const held = { channels, taken: false, timer: 0 }
  held.ready = (async () => {
    try {
      const [stream] = await Promise.all([asked, context.audioWorklet.addModule(url)])
      const source = context.createMediaStreamSource(stream), node = new AudioWorkletNode(context, 'take', { numberOfOutputs: 0, processorOptions: { channels } })
      const rate = context.sampleRate, latency = (stream.getAudioTracks()[0]?.getSettings().latency ?? 0) + 128 / rate
      const i = { context, stream, source, node, sampleRate: rate, latency, recent: [], onblock: null }
      node.port.onmessage = ({ data: { x: data, t } }) => {
        i.settle?.(data[0])
        i.onblock?.(data, t)
        // each channel's latest, sliding
        if (i.recent.length !== data.length) i.recent = data.map(() => new Float32Array(16384))
        const n = data[0].length
        i.recent.forEach((x, c) => { x.copyWithin(0, n); x.set(data[c], x.length - n) })
      }
      source.connect(node)
      // its device gone (unplugged): let go, the next take opens another
      stream.getAudioTracks()[0]?.addEventListener('ended', () => release(held))
      if (VPIO) await new Promise(done => { const t = setTimeout(done, SETTLE); i.settle = settling(() => { clearTimeout(t); done() }, SOON * rate) }).finally(() => { i.settle = null })
      return i
    } catch (error) {
      // the microphone let go, had it opened
      asked.then(stream => stream.getTracks().forEach(t => t.stop()), () => {})
      context.close()
      throw error
    } finally { URL.revokeObjectURL(url) }
  })()
  return held
}

function release(held) {
  if (input === held) input = null
  clearTimeout(held.timer)
  held.ready.then(i => { i.node.port.onmessage = null; i.source.disconnect(); i.stream.getTracks().forEach(t => t.stop()); i.context.close() }, () => {})
}
// the page hidden: the input let go, unless a take is going
document.addEventListener('visibilitychange', () => { if (document.hidden && input && !input.taken && holding !== input.channels) release(input) })

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
