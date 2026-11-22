// <audio-sound>: one sound, as a script makes it: run by the editor's engine, played by its player, saved as the
// script says. The state its parts show (part.js) and the one place they act on.
//
//   <script type="module" src="https://audio.js.org/audio/elements/sound.js"></script>
//   <audio-sound>
//     <audio src="/sounds/take.mp3" data-name="take.mp3"></audio>
//     <audio-code><pre><code>audio('take.mp3').trim().normalize('podcast').save('episode.mp3')</code></pre></audio-code>
//     <audio-play></audio-play> <audio-time></audio-time> <audio-save></audio-save>
//   </audio-sound>
//
// Its script: its <audio-code>'s text (code.js), read each time it runs; with none, its `script` attribute, else
// audio(src) of its `src`. It lays no box (display: contents): its children lie in the page as the page lays them.
//
// The files the script opens by name: each <audio src> or <source src> in it names one, by its data-name or its
// address's last part (a page with no script still plays an <audio controls>); an address (https:, a path from the
// site's root) the engine opens itself; one of the editor's own samples (chime.wav) is made; any other name is asked
// of the page's folder. Names are the page's: every sound on it shares the one engine, and a name is one file there.
//
// Nothing loads till it is reached for: the engine's worker with the first run, the player in sight of the page or with
// the first press. Run by play(), save() or run(); and again, a moment after its script changes, once it has run, so
// an edit is heard as it is made, taking over where it plays.
//
//   sound.code            its script (set: its <audio-code>'s value)
//   sound.files           the names the page gives it and the engine holds
//   sound.opens, .saves   the files its script opens and saves, by name
//   sound.duration        its length, s; 0 till it has run
//   sound.time            where it is, s (set: goes there)
//   sound.playing, .working, .status (what it does, in a word and a figure), .error (a message, or '')
//   run()  play()  pause()  toggle()  save()  open(file)
//   events: change (any of the above), run (an output in), play, pause, ended, timeupdate, error
import { prepare, error as flaw, files as named } from '../repl/code.js'
import { styles } from './part.js'

styles('audio-sound-style', `:where(audio-sound) { display: contents; }
/* the files it names are not its picture: one with no controls shows nothing anyway */
:where(audio-sound:defined) > audio:not([controls]) { display: none; }`)

// The samples the page holds of an output (engine.js peaks): what plays of one is then made in a worker of its own;
// a longer one stays in the engine, which plays it. Ten minutes of one channel
const HELD = 10 * 60 * 48000
// how long after its script's last change a sound that has run runs again, ms
const SOON = 300
// a file's type by its name's end, for the page's download
const MIME = { wav: 'audio/wav', flac: 'audio/flac', mp3: 'audio/mpeg', ogg: 'audio/ogg', opus: 'audio/ogg', aiff: 'audio/aiff', m4a: 'audio/mp4', aac: 'audio/aac' }

// The engine: one worker for every sound on the page, a tab of its own each (engine.js keys its runs by tab), started
// by the first run
let engine = null, started = null, tabs = 0
const engineOf = () => started ??= import('../repl/engine.js').then(m => engine = Object.assign(m.default(), { peaks: HELD }))
// a name's last part, as a script names a file beside it
const base = url => { try { return decodeURIComponent(new URL(url, document.baseURI).pathname.split('/').pop()) } catch { return '' } }
// what the engine opens by its address alone (worker.js address)
const address = name => /^(https?|data|blob):/.test(name) || /^\/(?!\/)/.test(name)
// asked of the page once each, whatever they came to
const fetched = new Map()
const fetching = url => fetched.get(url) ?? fetched.set(url, fetch(url).then(r => r.ok && !/^text\/html/.test(r.headers.get('content-type') ?? '') ? r.blob() : null, () => null)).get(url)

class AudioSound extends HTMLElement {
  #tab = `sound ${++tabs}`
  // the output it holds: { id, code, sampleRate, duration, saves }; the run on its way: { code, promise }
  #out = null; #going = null
  #player = null; #loading = null
  #state = { playing: false, working: 0, status: '', error: '' }
  // where it is, s, while it does not play: where it was paused, sought or ended
  #at = 0
  #wants = false; #soon = 0; #frame = 0; #began = 0; #tick = 0; #progress = null
  #own = null; #wired = false

  connectedCallback() {
    if (this.#wired) return
    this.#wired = true
    // its script changed (its <audio-code>'s input): what it names said again, and, once it has run, run again
    this.addEventListener('input', e => { if (e.target.localName === 'audio-code') this.#edited() })
    // a file dropped on anything in it opens
    this.addEventListener('dragover', e => { if ([...e.dataTransfer?.types ?? []].includes('Files')) e.preventDefault() })
    this.addEventListener('drop', e => { const file = e.dataTransfer?.files?.[0]; if (file) { e.preventDefault(); this.open(file) } })
    // the player once the sound is in sight, so a first press opens the device in the press (Safari opens it only there)
    const seen = new IntersectionObserver(entries => { if (entries.some(e => e.isIntersecting)) { seen.disconnect(); this.#play() } })
    for (const el of this.children) seen.observe(el)
    // its script's element defined after it: its text read as the element gives it from then
    customElements.whenDefined('audio-code').then(() => this.#say('change'))
  }
  disconnectedCallback() {
    this.pause()
    clearTimeout(this.#soon)
    clearInterval(this.#tick)
    this.#tick = 0
  }

  get #script() { return this.querySelector('audio-code') }
  // (its <audio-code> not yet defined: the text of its <pre>, as the element will read it)
  get code() { const script = this.#script; return this.#own ?? script?.value ?? script?.textContent.replace(/^\s*\n/, '').replace(/\s+$/, '') ?? this.getAttribute('script') ?? (this.hasAttribute('src') ? `audio(${JSON.stringify(this.getAttribute('src'))})` : '') }
  set code(text) {
    const script = this.#script
    if (script) script.value = text
    else this.#own = String(text)
    this.#edited()
  }
  // the files the page gives it by name, name → address
  get #given() { return new Map([...this.querySelectorAll('audio[src], source[src]')].map(a => [a.dataset.name || base(a.getAttribute('src')), a.src])) }
  get files() { return [...new Set([...this.#given.keys(), ...engine?.names ?? []])] }
  get opens() { return named(this.code).opens.map(f => f.name) }
  get saves() { return named(this.code).saves.map(f => f.name) }
  get duration() { return this.#out?.duration ?? 0 }
  get time() { return Math.min(this.#player?.playing ? this.#at = this.#player.time : this.#at, this.duration) }
  set time(t) { this.#at = Math.max(0, Math.min(+t || 0, this.duration)); this.#player?.seek(this.#at); this.#say('timeupdate') }
  get playing() { return this.#state.playing }
  get working() { return this.#state.working > 0 }
  get status() { return this.#state.status }
  get error() { return this.#state.error }
  // a plugin's parameters, for the script editor's completions (script.js describe)
  describe(name) { return engineOf().then(e => e.describe(name)) }

  #say(type, detail) { this.dispatchEvent(new CustomEvent(type, { detail })) }
  #set(patch) { Object.assign(this.#state, patch); this.#say('change') }
  #edited() {
    this.#say('change')
    clearTimeout(this.#soon)
    if (this.#out || this.#going) this.#soon = setTimeout(() => this.run().catch(() => {}), SOON)
  }
  // working: said at once, in words once it takes a moment (the editor's status, editor/run.js): a file decoding, the
  // steps applied, and how far, or how long
  #work(by) {
    this.#state.working += by
    if (this.#state.working > 0 && !this.#tick) { this.#began = performance.now(); this.#tick = setInterval(() => this.#told(), 100) }
    if (this.#state.working <= 0) { this.#state.working = 0; clearInterval(this.#tick); this.#tick = 0; this.#progress = null }
    this.#told(true)
  }
  // (`anyway`: said though its words stand, working having begun or ended)
  #told(anyway = false) {
    const p = this.#progress, took = performance.now() - this.#began
    let status = ''
    if (this.working && took > 200) {
      const word = !p ? 'Working' : p.decoding ? 'Decoding' : p.step ? `Applying ${p.step}` : p.steps?.length ? `Applying ${p.steps.join(', ')}` : p.saving ? 'Saving' : 'Rendering'
      const figure = p?.share != null ? `${Math.min(99, Math.floor(p.share * 100))}%` : took > 1000 ? `${(took / 1000).toFixed(1)}s` : ''
      status = figure ? `${word} ${figure}` : word
    }
    if (status !== this.#state.status) this.#set({ status })
    else if (anyway) this.#say('change')
  }
  #fail(error) {
    this.#set({ error: error?.message ?? String(error) })
    this.#say('error', error)
    return null
  }

  // The files a script names, in the engine before it runs: those the page gives, the editor's samples, the page's
  // folder's; what none of them has, the engine says is not open
  async #bring(eng, names) {
    const given = this.#given
    await Promise.all(names.filter(name => !eng.has(name)).map(async name => {
      let data = given.has(name) ? await fetching(given.get(name)) : null
      if (!data && address(name)) return
      if (!data) { const { builtins, sample } = await import('../repl/sources.js'); if (builtins[name]) data = sample(name) }
      data ??= await fetching(new URL(name, document.baseURI).href)
      if (data && !eng.has(name)) await eng.file(name, data)
    }))
  }

  // Runs its script as it is now: the output it comes to, { duration, sampleRate, saves }, the one it holds if the
  // script is the one that made it; null where a newer run took its place, or it failed (its `error` says how)
  run() {
    const code = this.code
    if (this.#out?.code === code) return Promise.resolve(this.#out)
    if (this.#going?.code === code) return this.#going.promise
    const going = this.#going = { code }
    return going.promise = this.#make(code).finally(() => { if (this.#going === going) this.#going = null })
  }
  async #make(code) {
    clearTimeout(this.#soon)
    if (!code.trim()) return null
    const syntax = flaw(code)
    if (syntax) return this.#fail({ message: `Syntax error on line ${code.slice(0, syntax.from).split('\n').length}`, ...syntax })
    this.#set({ error: '' })
    this.#work(1)
    try {
      const eng = await engineOf(), script = prepare(code)
      this.#progress = { decoding: true }
      await this.#bring(eng, script.names)
      const parts = [], progress = this.#progress = {}
      let reply
      const ended = new Promise(resolve => {
        const on = {
          loading: m => { progress.decoding = true; progress.share = m.estimate && m.channels ? Math.min(1, (m.at + m.channels[0].length) / (m.estimate * m.sampleRate)) : null },
          arrived: () => { progress.decoding = false; progress.share = null },
          doing: m => { progress.decoding = false; if (m.steps) progress.steps = m.steps; if ('step' in m) progress.step = m.step },
          chunk: m => { progress.decoding = false; if (m.channels) parts.push(m); if (m.total && !progress.step) progress.share = (m.at + (m.channels?.[0].length ?? 0)) / m.total },
          done: resolve, error: m => resolve({ error: m.error }), skip: () => resolve({ skipped: true })
        }
        // (the engine's tab is the page's: named as the run is asked, nothing between)
        eng.tab = this.#tab
        reply = eng.run(script, on)
      })
      const r = await reply
      if (r.skipped) return null
      if (r.error) return this.#fail(r.error)
      // a script that makes no sound: nothing to play or save
      if (!r.output) { this.#out = null; this.#player?.set(null, 48000); return this.#fail({ message: r.value != null ? `No sound: the script's value is ${r.value}` : 'The script makes no sound' }) }
      const last = await ended
      if (last.skipped || this.#going?.code !== code) return null
      if (last.error) return this.#fail(last.error)
      const length = Math.round(last.duration * last.sampleRate)
      // the samples the page holds of it: all of them, or none where it is longer than that (played by the engine)
      const channels = last.long || !parts.length ? null : Array.from({ length: last.channels }, (_, c) => {
        const x = new Float32Array(length)
        for (const p of parts) x.set(p.channels[c].subarray(0, Math.max(0, length - p.at)), p.at)
        return x
      })
      this.#out = { id: r.id, code, channels, length, sampleRate: last.sampleRate, duration: last.duration, saves: r.saves ?? [], stats: last.stats ?? null }
      this.#hear()
      this.#say('run', this.#out)
      return this.#out
    } catch (e) { return this.#fail(e) }
    finally { this.#work(-1) }
  }
  // the output to the player, once both are here: one playing gives way to it where it is
  // the output of the script as it is now, whichever run comes to it: a run a newer one took over is not the last word
  async #settled() {
    let out
    do out = await this.run(); while (!out && this.#going)
    return out
  }
  #hear() {
    const o = this.#out
    if (!o || !this.#player || o.heard) return
    o.heard = true
    this.#player.set(o.channels, o.sampleRate, async what => (await engineOf()).voice({ ...what, output: o.id, ...o.channels && { held: { key: o.id, channels: o.channels, sampleRate: o.sampleRate } } }), o.length)
  }
  #play() {
    return this.#loading ??= import('../repl/player.js').then(m => {
      this.#player = m.default({ onend: () => { this.#wants = false; this.#at = this.duration; this.#moving(false); this.#say('ended') } })
      this.#hear()
      return this.#player
    })
  }
  // playing: said, and the time with it, a frame at a time
  #moving(on) {
    cancelAnimationFrame(this.#frame)
    if (on) { const step = () => { this.#say('timeupdate'); this.#frame = requestAnimationFrame(step) }; this.#frame = requestAnimationFrame(step) }
    if (on !== this.#state.playing) { this.#set({ playing: on }); this.#say(on ? 'play' : 'pause') }
    this.#say('timeupdate')
  }

  // Plays from where it is, from its start once it has ended; the script run first where it has not
  async play() {
    this.#wants = true
    // the device, opened in the press
    this.#player?.warm()
    this.#moving(true)
    const [out, player] = await Promise.all([this.#settled(), this.#play()])
    if (!this.#wants) return
    if (!out) { this.#wants = false; return this.#moving(false) }
    await player.play({ start: this.#at >= out.duration - .01 ? 0 : this.#at })
  }
  pause() {
    this.#wants = false
    this.#at = this.time
    this.#player?.pause()
    this.#moving(false)
  }
  toggle() { return this.#wants ? this.pause() : this.play() }

  // Saves what the script saves, each save() a file by its name; with none, the output, by `name` (its type by its end:
  // take.mp3), a WAV named after the file it opens by default. The page downloads each; [{ name, type, bytes }] or null
  async save(name) {
    const out = await this.#settled()
    if (!out) return null
    this.#work(1)
    this.#progress = { saving: true }
    try {
      const eng = await engineOf(), file = String(name ?? this.getAttribute('download') ?? `${(this.opens[0] ?? 'audio').replace(/^.*\//, '').replace(/\.\w+$/, '')}.wav`)
      eng.tab = this.#tab
      const { files = [], error } = await eng.export({ format: file.match(/\.(\w+)$/)?.[1].toLowerCase() ?? 'wav', name: file.replace(/\.\w+$/, '') })
      if (error) return this.#fail(error)
      for (const f of files) {
        const url = URL.createObjectURL(new Blob([f.bytes], { type: MIME[f.type] ?? 'application/octet-stream' }))
        Object.assign(document.createElement('a'), { href: url, download: f.name }).click()
        setTimeout(() => URL.revokeObjectURL(url), 10000)
      }
      return files
    } catch (e) { return this.#fail(e) }
    finally { this.#work(-1) }
  }

  // A file of the reader's own in place of the first the script opens: in the engine by its name (one free there), the
  // script naming it, one step its undo takes back; then run, where the sound has run or plays
  async open(file, name = file.name) {
    const eng = await engineOf(), { unique } = await import('../repl/sources.js')
    name = unique(name, new Set(this.files))
    await eng.file(name, file)
    const code = this.code, first = named(code).opens[0], q = first ? code[first.from] : "'"
    const said = `${q}${name.replaceAll('\\', '\\\\').replaceAll(q, '\\' + q)}${q}`
    this.code = first ? code.slice(0, first.from) + said + code.slice(first.to) : `audio(${said})`
    return name
  }
}

if (!customElements.get('audio-sound')) customElements.define('audio-sound', AudioSound)
