/**
 * HTMLAudioElement where there is none (Node, Bun, Deno, a worker): `new Audio('song.mp3').play()` as a page plays it,
 * the same properties, methods and events, by the WHATWG HTML media element (https://html.spec.whatwg.org/multipage/media.html).
 *
 *   import 'audio/polyfill'                 // globalThis.Audio, where the runtime has none
 *   import { Audio } from 'audio/polyfill'  // the class, the global left alone
 *
 * A source is a path, a URL, bytes or a Blob, as audio() takes it; it decodes as it arrives and plays from the speakers
 * (@audio/speaker). What the element has for a page alone is left out: controls drawn, text tracks, srcObject, a sink.
 */
import audio from './audio.js'

const MIME = {
  'audio/mpeg': 1, 'audio/mp3': 1, 'audio/wav': 1, 'audio/wave': 1, 'audio/x-wav': 1, 'audio/flac': 1, 'audio/x-flac': 1,
  'audio/ogg': 1, 'audio/opus': 1, 'audio/webm': 1, 'audio/aac': 1, 'audio/mp4': 1, 'audio/x-m4a': 1, 'audio/aiff': 1,
  'audio/x-aiff': 1, 'audio/x-caf': 1, 'audio/amr': 1, 'audio/qoa': 1, 'video/mp4': 1, 'video/quicktime': 1, 'video/webm': 1
}
const CODECS = /^(mp3|mp4a(\.[\d.]+)?|aac|flac|vorbis|opus|pcm|1|alac)$/i

/** MediaError: why the source failed to play */
export class MediaError {
  static MEDIA_ERR_ABORTED = 1
  static MEDIA_ERR_NETWORK = 2
  static MEDIA_ERR_DECODE = 3
  static MEDIA_ERR_SRC_NOT_SUPPORTED = 4
  constructor(code, message = '') { this.code = code; this.message = message }
}
Object.assign(MediaError.prototype, { MEDIA_ERR_ABORTED: 1, MEDIA_ERR_NETWORK: 2, MEDIA_ERR_DECODE: 3, MEDIA_ERR_SRC_NOT_SUPPORTED: 4 })

/** TimeRanges: ordered, non-overlapping [start, end) seconds */
export class TimeRanges {
  #r
  constructor(ranges = []) { this.#r = ranges }
  get length() { return this.#r.length }
  start(i) { return this.#at(i)[0] }
  end(i) { return this.#at(i)[1] }
  #at(i) {
    if (!(i >= 0 && i < this.#r.length)) throw new DOMException(`The index provided (${i}) is greater than or equal to the maximum bound (${this.#r.length}).`, 'IndexSizeError')
    return this.#r[i]
  }
}

const EVENTS = ['abort', 'canplay', 'canplaythrough', 'durationchange', 'emptied', 'ended', 'error', 'loadeddata',
  'loadedmetadata', 'loadstart', 'pause', 'play', 'playing', 'progress', 'ratechange', 'seeked', 'seeking', 'stalled',
  'suspend', 'timeupdate', 'volumechange', 'waiting']
const STATES = { HAVE_NOTHING: 0, HAVE_METADATA: 1, HAVE_CURRENT_DATA: 2, HAVE_FUTURE_DATA: 3, HAVE_ENOUGH_DATA: 4 }
const NETWORK = { NETWORK_EMPTY: 0, NETWORK_IDLE: 1, NETWORK_LOADING: 2, NETWORK_NO_SOURCE: 3 }

export class Audio extends EventTarget {
  static { Object.assign(this, STATES, NETWORK); Object.assign(this.prototype, STATES, NETWORK) }

  #src = ''; #a = null; #gen = 0
  #paused = true; #ended = false; #seeking = false; #pending = []
  #volume = 1; #muted = false; #rate = 1; #defaultRate = 1; #pitch = true; #loop = false
  #time = 0; #duration = NaN; #played = []
  #handlers = {}; #tasks = new Set(); #last = 0

  constructor(src) {
    super()
    this.readyState = 0
    this.networkState = 0
    this.error = null
    this.autoplay = false
    this.preload = 'auto'
    this.controls = false
    this.crossOrigin = null
    this.defaultMuted = false
    if (src !== undefined) this.src = src
  }

  // ── the source ─────────────────────────────────────────────────────────
  get src() { return this.#src }
  set src(v) { this.#src = v instanceof URL ? v.href : typeof v === 'string' ? v : v; this.load() }
  get currentSrc() { return this.#a ? this.#src : '' }

  /** Start over with the source: pending play() promises reject (AbortError), the old one stops, the new one loads */
  load() {
    let gen = ++this.#gen
    // what was queued for the old source goes (its events unfired, its promises settled as they would have been)
    for (let t of this.#tasks) { clearTimeout(t.id); t.purged?.() }
    this.#tasks.clear()
    this.#reject('AbortError', 'The play() request was interrupted by a new load request.')
    if (this.#a) { this.#a.stop(); this.#a.dispose?.(); this.#a = null }
    if (this.networkState === 1 || this.networkState === 2) this.#fire('abort')
    if (this.networkState !== 0) this.#fire('emptied')
    this.readyState = 0; this.error = null
    this.#paused = true; this.#ended = false; this.#seeking = false
    let had = this.#time !== 0
    this.#time = 0; this.#duration = NaN; this.#played = []
    if (had) this.#fire('timeupdate')
    if (this.#src === '' || this.#src == null) { this.networkState = 3; return this.#fail(4, 'Empty src attribute', gen) }
    this.networkState = 2
    this.#fire('loadstart')
    let a
    try { a = audio(this.#src) } catch (e) { return this.#fail(4, e.message, gen) }
    this.#a = a
    a.on('metadata', ({ estDuration }) => {
      if (gen !== this.#gen) return
      this.#metadata(estDuration ?? Infinity)
    })
    let first = true
    a.on('data', () => {
      if (gen !== this.#gen || !first || this.readyState < 1) return
      first = false
      this.#ready()
    })
    a.on('timeupdate', t => {
      if (gen !== this.#gen || this.#paused) return
      // looping, the engine runs on into the start: an element seeks there, and says so
      if (this.#loop && t < this.#last - 0.05) this.#seek(t, true)
      this.#last = t
      this.#queue(() => !this.#paused && this.dispatchEvent(new Event('timeupdate')))
    })
    a.on('ended', () => gen === this.#gen && this.#end())
    // failing before its metadata, the source is not one it can play (the spec's dedicated media source failure);
    // after, its data is broken
    a.on('error', e => gen === this.#gen && this.#fail(this.readyState < 1 ? 4 : 3, e?.message ?? String(e), gen))
    a.ready.then(() => {
      if (gen !== this.#gen) return
      if (this.readyState < 1) this.#metadata(a.duration)
      if (first) { first = false; this.#ready() }
      if (a.duration !== this.#duration) { this.#duration = a.duration; this.#fire('durationchange') }
      this.networkState = 1
      this.#fire('progress'); this.#fire('suspend')
    }, e => gen === this.#gen && this.#fail(this.readyState < 1 ? 4 : 2, e?.message ?? String(e), gen))
  }

  // data to play: enough of it, as it decodes faster than it plays
  #ready() {
    this.readyState = 4
    this.#fire('loadeddata'); this.#fire('canplay')
    if (!this.#paused) this.#playing()
    this.#fire('canplaythrough')
    if (this.autoplay && this.#paused) this.play().catch(() => {})
  }

  #metadata(duration) {
    if (this.readyState >= 1) return
    this.readyState = 1
    this.#duration = duration
    this.#fire('durationchange'); this.#fire('loadedmetadata')
    if (this.#time) this.#a.seek(this.#time)
  }

  #fail(code, message, gen) {
    if (gen !== this.#gen || this.error) return
    this.error = new MediaError(code, message)
    this.networkState = 3
    this.#reject('NotSupportedError', 'Failed to load because no supported source was found.')
    this.#fire('error')
  }

  canPlayType(type) {
    let [mime, ...params] = String(type).toLowerCase().split(';').map(s => s.trim())
    if (!MIME[mime]) return ''
    let codecs = params.find(p => p.startsWith('codecs='))
    if (!codecs) return 'maybe'
    return codecs.slice(7).replace(/"/g, '').split(',').every(c => CODECS.test(c.trim())) ? 'probably' : ''
  }

  // ── playing ────────────────────────────────────────────────────────────
  get paused() { return this.#paused }
  get ended() { return this.#ended && !this.#loop }
  get seeking() { return this.#seeking }
  get duration() { return this.#duration }

  /** The spec's play(): a promise that resolves as it starts playing (as soon as there is data to play: the element's
   *  "notify about playing"), rejects NotSupportedError for a source that failed, AbortError when paused or reloaded
   *  before it got there */
  play() {
    if (this.error?.code === 4) return Promise.reject(new DOMException('Failed to load because no supported source was found.', 'NotSupportedError'))
    if (this.networkState === 0) this.load()
    let p = new Promise((resolve, reject) => this.#pending.push({ resolve, reject }))
    let a = this.#a
    if (this.#ended && !this.#loop) { this.currentTime = 0 }
    if (this.#paused) {
      this.#paused = false
      this.#played.push([this.#time, this.#time])
      this.#fire('play')
      if (a) {
        this.#sync()
        if (a.playing) a.resume()
        else {
          let gen = this.#gen
          a.play({ at: this.#time, loop: this.#loop }).played.catch(e => this.#fail(3, e?.message ?? String(e), gen))
        }
      }
      if (this.readyState < 3) this.#fire('waiting')
      else this.#playing()
    }
    else if (this.readyState >= 3) this.#playing()
    return p
  }

  // the promises waiting are taken now, and resolved after 'playing' (a pause() after this can't reject them)
  #playing() {
    let taken = this.#pending.splice(0), resolve = () => { for (let p of taken) p.resolve() }
    this.#queue(() => { this.dispatchEvent(new Event('playing')); resolve() }, resolve)
  }

  pause() {
    if (this.networkState === 0) this.load()
    if (this.#paused) return
    this.#time = this.currentTime
    this.#paused = true
    this.#a?.pause()
    let taken = this.#pending.splice(0), reject = () => { for (let p of taken) p.reject(new DOMException('The play() request was interrupted by a call to pause().', 'AbortError')) }
    this.#queue(() => { this.dispatchEvent(new Event('timeupdate')); this.dispatchEvent(new Event('pause')); reject() }, reject)
  }

  #end() {
    let a = this.#a
    if (!a?.ended) return  // stopped or handed over: not the end of the media
    this.#time = this.#duration
    this.#ended = true
    if (this.#loop) return
    this.#fire('timeupdate')
    if (!this.#paused) { this.#paused = true; this.#fire('pause') }
    this.#fire('ended')
  }

  get currentTime() {
    let a = this.#a
    let t = a && a.playing ? a.currentTime : this.#time
    if (!this.#paused && this.#played.length) { let r = this.#played.at(-1); r[1] = Math.max(r[1], t) }
    return t
  }
  set currentTime(t) {
    t = +t
    if (!Number.isFinite(t)) throw new TypeError(`Failed to set the 'currentTime' property on 'HTMLMediaElement': The provided double value is non-finite.`)
    t = Math.max(0, this.#duration > 0 ? Math.min(t, this.#duration) : t)
    this.#time = t; this.#ended = false
    if (this.readyState < 1) return
    this.#seek(t)
  }
  // as a page's element seeks: seeking, its readyState down until the data at the new place is there, then up again;
  // `wrapped`, the engine is there already (a loop run on into its start)
  #seek(t, wrapped) {
    this.#seeking = true
    this.readyState = 1
    this.#last = t
    this.#fire('seeking')
    let a = this.#a, gen = this.#gen
    if (!wrapped) a.seek(t)
    if (!this.#paused) this.#played.push([t, t])
    const done = () => {
      if (gen !== this.#gen || !this.#seeking) return
      if (a.seeking) return setTimeout(done, 5)
      this.#seeking = false
      this.readyState = 4
      this.dispatchEvent(new Event('timeupdate')); this.dispatchEvent(new Event('seeked'))
      this.#fire('canplay')
      if (!this.#paused) this.#playing()
      this.#fire('canplaythrough')
    }
    this.#queue(done)
  }
  fastSeek(t) { this.currentTime = t }

  get buffered() {
    let a = this.#a
    if (!a || this.readyState < 1) return new TimeRanges()
    let end = a.decoded ? a.duration : (a.pages?.reduce((n, p) => n + (p?.[0]?.length || 0), 0) || 0) / (a.sampleRate || 1)
    return new TimeRanges(end > 0 ? [[0, end]] : [])
  }
  get seekable() { return new TimeRanges(this.#duration > 0 ? [[0, this.#duration]] : []) }
  get played() {
    this.currentTime  // the current stretch brought up to now
    let r = this.#played.filter(([s, e]) => e > s).sort((x, y) => x[0] - y[0]), out = []
    for (let [s, e] of r) { let l = out.at(-1); if (l && s <= l[1]) l[1] = Math.max(l[1], e); else out.push([s, e]) }
    return new TimeRanges(out)
  }

  // ── level, speed, looping ──────────────────────────────────────────────
  get volume() { return this.#volume }
  set volume(v) {
    v = +v
    if (!(v >= 0 && v <= 1)) throw new DOMException(`Failed to set the 'volume' property on 'HTMLMediaElement': The volume provided (${v}) is outside the range [0, 1].`, 'IndexSizeError')
    if (v === this.#volume) return
    this.#volume = v; this.#sync(); this.#fire('volumechange')
  }
  get muted() { return this.#muted }
  set muted(v) { v = !!v; if (v === this.#muted) return; this.#muted = v; this.#sync(); this.#fire('volumechange') }
  get playbackRate() { return this.#rate }
  set playbackRate(v) { v = this.#speed(v); if (v === this.#rate) return; this.#rate = v; this.#sync(); this.#fire('ratechange') }
  get defaultPlaybackRate() { return this.#defaultRate }
  set defaultPlaybackRate(v) { v = this.#speed(v); if (v === this.#defaultRate) return; this.#defaultRate = v; this.#fire('ratechange') }
  get preservesPitch() { return this.#pitch }
  set preservesPitch(v) { this.#pitch = !!v; this.#sync() }
  get loop() { return this.#loop }
  set loop(v) { this.#loop = !!v; if (this.#a) this.#a.loop = this.#loop }

  #speed(v) {
    v = +v
    if (!Number.isFinite(v)) throw new TypeError(`Failed to set the 'playbackRate' property on 'HTMLMediaElement': The provided double value is non-finite.`)
    if (v !== 0 && (Math.abs(v) < 0.0625 || Math.abs(v) > 16)) throw new DOMException(`Failed to set the 'playbackRate' property on 'HTMLMediaElement': The provided playback rate (${v}) is not in the supported playback range.`, 'NotSupportedError')
    if (v < 0) throw new DOMException(`Failed to set the 'playbackRate' property on 'HTMLMediaElement': The provided playback rate (${v}) is not supported: it plays forwards only.`, 'NotSupportedError')
    return v
  }

  #sync() {
    let a = this.#a
    if (!a) return
    a.volume = this.#volume; a.muted = this.#muted
    if (this.#rate > 0) a.playbackRate = this.#rate
    a.preservesPitch = this.#pitch; a.loop = this.#loop
  }

  #reject(name, message) { for (let p of this.#pending.splice(0)) p.reject(new DOMException(message, name)) }
  #fire(type) { this.#queue(() => this.dispatchEvent(new Event(type))) }
  // events go out as a page queues them: after the call that caused them returns, in order; a load() drops them,
  // calling `purged` instead
  #queue(fn, purged) {
    let t = { purged, id: setTimeout(() => { this.#tasks.delete(t); fn() }, 0) }
    this.#tasks.add(t)
  }

  // the on<event> handler properties, as a page's element has them
  static {
    for (let type of EVENTS) Object.defineProperty(this.prototype, 'on' + type, {
      get() { return this.#handlers[type] ?? null },
      set(fn) {
        let old = this.#handlers[type]
        if (old) this.removeEventListener(type, old)
        this.#handlers[type] = typeof fn === 'function' ? fn : null
        if (this.#handlers[type]) this.addEventListener(type, this.#handlers[type])
      },
      enumerable: true, configurable: true
    })
  }
}

if (typeof globalThis.Audio === 'undefined') globalThis.Audio = Audio
export default Audio
