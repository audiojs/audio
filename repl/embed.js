// <audio-repl>: the audio repl in any page, its script the element's own text.
//
//   <script type="module" src="https://audio.js.org/embed.js"></script>
//   <audio-repl panel="code" display="wave" height="320">
//   <pre><code>audio('chime.wav').trim().normalize(-1)</code></pre>
//   </audio-repl>
//
// The text is for where scripts don't run, and for a search engine; where they run, a skeleton of the repl's parts
// holds their places, a light passing along it, till the frame's sound is in (a page hides the text till then with
// `@media (scripting: enabled) { audio-repl:not(:defined) > pre { visibility: hidden } }`). Once the element is near
// the screen a frame of the repl takes its place: the script runs, its sound drawn, played, edited, opened whole
// in the repl. A file dropped on it opens in its sound's place. Nothing of the reader's is kept. A sound named by its
// path from the site's root,
// audio('/sounds/take.mp3'), is that site's file. Its mark's moves come out as `mark` events, for a page's own logo to
// move with it; how far its work has come as `progress` events ({ p } 0 to 1, null while busy with no figure; then
// { done: true }), for a strip at the page's own top, as the editor of its own draws one at its top.
//
// What it shows, the frame takes as one JSON (?ui=, repl/editor/config.js reads it): the element's `ui` attribute, as
// that JSON, and over it these attributes, each one key of it:
//   panel       code (the script beside the picture), edits (its steps, each with its settings) or none
//   display     wave or spec
//   controls    the parts shown, each in its own place whatever the list's order. Over the picture: sound (its name, a
//               menu of its ways in: a file, a take, a sample), link and name (the way to the repl, its name);
//               ruler, the time row (left out, none: the big time says it; there all the same with ui's axis
//               inside); look, a band's dropdown of how it draws. In
//               the bar: play record loop clock history message heard, a level (level, or what it reads: peak, rms,
//               loudness), rate channels depth before, view (a switch: the waveform, the spectrogram), open and save (a
//               file of the reader's in; the result out, in the format picked from its menu). Without it, all but
//               sound, view, open and save
//   ops         edits a press away for the page's own sound, one button after the history, a menu of them, as
//               `trim normalize(-1) stretch(1.25)`: a call's own arguments, or the defaults the menus write; for a
//               sound of the reader's, those its kind is given (repl/kind.js NEXT)
//   background  the ground it sits on and fades into, a CSS colour, or page: the page's own under the element, read
//               off the page here (a frame can't see the page around it)
// and in ui, among the rest (repl/README.md): edits chain, the ops (or, with none, those the sound's kind is given) laid
// in sight instead of behind the button, the row over the picture the chain itself: the sound's name, those made after
// it, each a press from its settings, a field to add one (those suggested listed first, then every edit), the history;
// kind, what the page's
// sound is, in a word, said by the level (another's is heard); axis inside, the time row and the values written in the
// sheet the grid rules, which runs the frame's width; inset, a length: the frame the page's width, its picture from
// side to side, the sound's name and the bar standing in from its sides that far (read in the frame: a vw is the
// frame's), or two, how far from its left side and from its right; foot, a length: the room under the picture, from
// its foot to the frame's, the bar in it, its time midway between the grid's last line and the frame's foot (the bar's
// own 60 px at the least); a length may name
// the page's own custom properties (var(--name)), given their values on the element as the frame loads
//   height      in px (320), the element's own
//
// And two methods, for the page's own controls, each loading the frame first where it is not in yet:
// el.edit('normalize(-1)'), a call as the ops write one, makes that edit as the chain's field does (on the chain, the
// sound made again, undo takes it back); a call the editor does not know makes nothing, said in the console.
// el.edits() resolves to what the chain's list offers, by kind, in its order, recipes left out:
// [{ kind: 'Silence', edits: [{ call: 'trim(-40)', name: 'Trim silence', value: '−40dB', line: 'Cut silence from both
// ends' }, …] }, …], each call what edit() takes, name and value as its row says them, line its tooltip.
//
// And it is a sound to the page's own parts, as <audio-sound> is (elements/sound.js): a play button, a clock, a code
// block elsewhere on the page name it (`<audio-play for="id">`, elements/part.js) and show and act on the sound in the
// frame (repl/editor/host.js answers them). el.code, its script as it is now (set: the frame's script whole, one step of
// its history); an `input` event each time its script changes in the frame, by an edit made there; el.playing,
// el.working, el.status, el.error, el.duration, el.time (set: goes there), el.opens and el.saves (the files its script
// opens and saves, by name); toggle(), play(), pause(), save(); open(file) with a File, the reader's own in its sound's
// place; events change, run, play, pause, timeupdate, as <audio-sound>'s.
const HOME = new URL('./', import.meta.url)

// The colour a page shows under an element: the first box from it up that paints one of its own, else the page's
const clear = c => !c || c === 'transparent' || /,\s*0\)$|\/\s*0\)$/.test(c)
function ground(el) {
  for (let e = el; e; e = e.parentElement) { const c = getComputedStyle(e).backgroundColor; if (!clear(c)) return c }
  return clear(getComputedStyle(document.documentElement).backgroundColor) ? 'white' : getComputedStyle(document.documentElement).backgroundColor
}

// the script as the repl's links carry it: deflated, base64url
async function pack(script) {
  const bytes = new Uint8Array(await new Response(new Blob([script]).stream().pipeThrough(new CompressionStream('deflate-raw'))).arrayBuffer())
  let s = ''
  for (const b of bytes) s += String.fromCharCode(b)
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}
// the text as written in the page, its lines' common indent taken off, blank lines at its ends gone
function dedent(text) {
  const lines = text.replace(/^\s*\n|\s+$/g, '').split('\n')
  const indent = Math.min(...lines.filter(l => l.trim()).map(l => l.match(/^[ \t]*/)[0].length))
  return lines.map(l => l.slice(indent)).join('\n')
}

const STYLE = `
  audio-repl { display: block; position: relative; height: var(--audio-repl-height, 320px); margin: 1.5em 0; overflow: hidden; border-radius: 14px; background: #141414; color: #bdbdbd; contain: layout paint; }
  audio-repl > pre { display: none; }
  audio-repl > iframe { position: absolute; inset: 0; width: 100%; height: 100%; border: 0; color-scheme: normal; opacity: 0; transition: opacity .2s ease-out; }
  audio-repl[data-ready] > iframe { opacity: 1; }
  /* till then, the skeleton: each part a block of the text's colour, faint, the picture's and the panel's fainter, one
     light passing along them all at once (the gradient laid on the window, so one band crosses every block) */
  audio-repl > .wait { position: absolute; inset: 0; pointer-events: none; transition: opacity .3s ease-out; --base: color-mix(in srgb, currentColor 7%, transparent); --light: color-mix(in srgb, currentColor 15%, transparent); }
  audio-repl > .wait i { position: absolute; background: linear-gradient(90deg, var(--base) 0 42%, var(--light) 50%, var(--base) 58% 100%) fixed 0 0 / 200vw 100%; animation: audio-repl-wait 1.8s cubic-bezier(.4, 0, .6, 1) infinite; }
  audio-repl > .wait i.area { --base: color-mix(in srgb, currentColor 4%, transparent); --light: color-mix(in srgb, currentColor 9%, transparent); }
  @keyframes audio-repl-wait { from { background-position-x: 100vw; } to { background-position-x: -100vw; } }
  audio-repl[data-ready] > .wait { opacity: 0; }
  audio-repl[background] { background: none; border-radius: 0; color: inherit; }
  /* narrow, the panel goes under the picture: room for both */
  @media (max-width: 640px) { audio-repl:not([panel=none]) { height: max(var(--audio-repl-height, 320px), 440px); } }
  @media (prefers-reduced-motion: reduce) { audio-repl > iframe { transition: none; } audio-repl > .wait i { animation: none; background-position-x: 100vw; } }`

// what an element asks beyond its attributes: its ui attribute's JSON
const uiOf = el => { try { return JSON.parse(el.getAttribute('ui') || '{}') } catch { return {} } }
// An element's insets as written, one or two (its ui's inset: a length, or a number, px; two of them, its left side's
// and its right's)
const insets = el => [].concat(uiOf(el).inset ?? []).map(length => typeof length === 'number' ? `${length}px` : length)
// A length as the frame can read it: the page's custom properties in it (var(--name), a fallback after its comma)
// given their values on the element, which the frame cannot see
const own = (el, length) => typeof length !== 'string' ? length : length.replace(/var\(\s*(--[\w-]+)\s*(?:,([^()]*))?\)/g, (_, name, or) => getComputedStyle(el).getPropertyValue(name).trim() || or?.trim() || '0px')
// How far an element's frame stands its name row and its bar in from its left side and from its right, px as the
// page measures them; none where it asks for none
function insetsOf(el) {
  const lengths = insets(el)
  if (!lengths.length || !lengths.every(length => typeof length === 'string' && CSS.supports('width', length))) return []
  const probe = el.appendChild(document.createElement('i'))
  const px = lengths.map(length => { probe.style.cssText = `position: absolute; visibility: hidden; width: ${length}`; return probe.offsetWidth })
  probe.remove()
  return px
}
// The room an element's frame keeps under its picture for the bar to stand in (its ui's foot), px as the
// page measures it, never less than the bar's own 60; 60 where it asks for none
function footOf(el) {
  const foot = own(el, typeof uiOf(el).foot === 'number' ? `${uiOf(el).foot}px` : uiOf(el).foot)
  if (typeof foot !== 'string' || !CSS.supports('height', foot)) return 60
  const probe = el.appendChild(document.createElement('i'))
  probe.style.cssText = `position: absolute; visibility: hidden; height: ${foot}`
  const px = probe.offsetHeight
  probe.remove()
  return Math.max(60, px)
}
// The skeleton of an element's repl, laid out as index.html lays out its parts at the element's size: the
// sound's name and the way to the repl over the picture; a panel beside it, or under the bar at 640 px and
// narrower (panel, code unless none); the bar: play, the time (large where the picture has the width), the history, and
// past 670 px the facts. On the page's ground (background) the bar starts at the frame's edge; with an inset, the
// picture from side to side, the rest that far in. The way to the repl only where the page shows it (controls: link,
// or none named). The quick edits laid in sight (ui edits chain, the page's ops or those a kind is given) as the page
// lays them: the row over the picture the chain, after the name (on a row of its own under it at 760 px and narrower,
// the picture that much lower), the save at its right end
function skeleton(el) {
  const W = el.clientWidth, H = el.clientHeight, panel = el.getAttribute('panel') !== 'none', narrow = W <= 640, ui = uiOf(el)
  const shows = part => el.hasAttribute('controls') ? el.getAttribute('controls').trim().split(/\s+/).includes(part) : !['sound', 'view', 'open', 'save'].includes(part)
  const chained = ui.edits === 'chain', linked = shows('link'), top = chained && W <= 760 ? 66 : 46
  // (the bar's 60 px in the room under the picture, ui foot: the time in the middle of all under the grid's last line,
  // the strip of times over the room counted in, as the view lays it, 26 px: editor.js underGrid)
  const room = footOf(el), strip = room > 60 && ui.axis === 'inside' ? 26 : 0, under = panel && narrow ? Math.round(H * .45) : 0, pic = H - under - room, bar = pic + (room - 60 - strip) / 2, side = panel && !narrow ? Math.round(W * .44) : W
  const [inset, back = inset] = insetsOf(el), edge = inset ?? 12, far = back ?? 12, x = inset ?? (el.hasAttribute('background') ? 0 : 12), wide = !panel && !narrow
  const block = (left, top, width, height, round = 4, area = false) => `<i${area ? ' class="area"' : ''} style="left:${left}px;top:${top}px;width:${Math.max(0, width)}px;height:${Math.max(0, height)}px;border-radius:${round}px"></i>`
  // (the row over the picture's right end, with the chain: the save; the way to the repl before it; the chain after the
  // name, or on its own row under it)
  const end = chained && shows('save') ? 28 : 0, at = side - far - end - (end ? 16 : 0)
  const chain = !chained ? [] : W <= 760 ? [block(edge, 40, Math.min(260, W - edge - far), 10)] : [block(edge + 166, 14, Math.min(420, at - (linked ? 162 : 0) - edge - 178), 10)]
  return [
    block(edge, 13, 140, 12), linked && block(at - 146, 14, 146, 10), end && block(side - far - end, 14, end, 10), ...chain,
    inset == null ? block(8, top, side - 16, pic - top - 8, 8, true) : block(0, top, side, pic - top - 8, 0, true),
    panel && (narrow ? block(8, H - under + 8, W - 16, under - 16, 8, true) : block(side + 8, top, W - side - 16, pic - top - 8, 8, true)),
    block(x + (inset == null ? 10 : 0), bar + 18, 24, 24, 12), block(x + (inset == null ? 50 : 40), bar + 17, wide ? 150 : 86, 26), block(x + (inset == null ? 0 : -10) + (wide ? 214 : 150), bar + 24, 56, 12),
    W > 670 && block(W - far - 124, bar + 25, 124, 10)
  ].filter(Boolean).join('')
}

class AudioRepl extends HTMLElement {
  static observer = new IntersectionObserver(entries => {
    for (const e of entries) if (e.isIntersecting) { AudioRepl.observer.unobserve(e.target); e.target.load() }
  }, { rootMargin: '400px 0px' })

  connectedCallback() {
    if (!document.getElementById('audio-repl-style')) document.head.append(Object.assign(document.createElement('style'), { id: 'audio-repl-style', textContent: STYLE }))
    const height = parseFloat(this.getAttribute('height'))
    if (height > 0) this.style.setProperty('--audio-repl-height', `${height}px`)
    // the skeleton, laid out again as the element's size changes, till the frame is shown
    if (!this.frame && !this.wait) {
      this.wait = Object.assign(document.createElement('div'), { className: 'wait', ariaHidden: 'true' })
      this.append(this.wait)
      this.sizes = new ResizeObserver(() => { this.wait.innerHTML = skeleton(this) })
      this.sizes.observe(this)
    }
    if (!this.frame) AudioRepl.observer.observe(this)
  }
  disconnectedCallback() { AudioRepl.observer.unobserve(this) }

  // the script: the element's code as written, read once, before the frame goes in beside it
  get script() { return this.written ??= dedent((this.querySelector('pre') ?? this).textContent) }

  // The sound in the frame, as the frame last said it (host.js): its script and the files it names; its state
  told = null
  state = { playing: false, working: false, status: '', error: '', duration: 0, time: 0 }
  get code() { return this.told?.code ?? this.script }
  set code(text) {
    text = String(text)
    if (text === this.code) return
    // (before the frame is in, the script it opens with; then asked of it: what the frame says of its script till it
    // says this one, sent before it took this, is not news; for two seconds at most, should it never say it)
    if (!this.frame) return void (this.written = text)
    this.told = { opens: [], saves: [], ...this.told, code: text }
    this.sent = { code: text, till: performance.now() + 2000 }
    this.ask({ audio: 'code', code: text })
  }
  get opens() { return this.told?.opens ?? [] }
  get saves() { return this.told?.saves ?? [] }
  get files() { return [] }
  get playing() { return this.state.playing }
  get working() { return this.state.working }
  get status() { return this.state.status }
  get error() { return this.state.error }
  get duration() { return this.state.duration }
  get time() { return this.state.time }
  set time(t) { this.state = { ...this.state, time: +t || 0 }; this.ask({ audio: 'seek', time: +t || 0 }); this.dispatchEvent(new CustomEvent('timeupdate')) }
  toggle() { this.ask({ audio: 'toggle' }) }
  play() { this.ask({ audio: 'play' }) }
  pause() { this.ask({ audio: 'pause' }) }
  save() { this.ask({ audio: 'save' }) }
  describe() { return null }

  async load() {
    if (this.frame) return
    // the frame's one JSON: the ui attribute's, each attribute over it; controls and ops their words, or calls with their
    // arguments, the spaces in a call's parentheses kept; background page, the colour the page shows under the element
    const ui = uiOf(this)
    const words = name => this.getAttribute(name).match(/[\w-]+(?:\([^)]*\))?/g) ?? []
    for (const name of ['panel', 'display', 'background']) if (this.hasAttribute(name)) ui[name] = this.getAttribute(name).trim()
    for (const name of ['controls', 'ops']) if (this.hasAttribute(name)) ui[name] = words(name)
    if (ui.background === 'page') ui.background = ground(this.parentElement)
    // (its insets and its foot as the frame can read them: the page's custom properties given their values here)
    if (ui.inset != null) ui.inset = Array.isArray(ui.inset) ? ui.inset.map(length => own(this, length)) : own(this, ui.inset)
    if (ui.foot != null) ui.foot = own(this, ui.foot)
    const q = new URLSearchParams({ embed: '' })
    if (Object.keys(ui).length) q.set('ui', JSON.stringify(ui))
    const frame = this.frame = document.createElement('iframe')
    frame.title = this.getAttribute('title') || 'audio editor: the script, its sound, to play and edit'
    // the microphone, for a script that records; the clipboard, for the editor's copy
    frame.allow = 'microphone; autoplay; clipboard-write'
    // shown once its sound is in (its length said, or its mark first at rest); or a while after it loads, whatever its script does
    const ready = () => { if ('ready' in this.dataset) return; this.dataset.ready = ''; this.sizes?.disconnect(); setTimeout(() => this.wait?.remove(), 400) }
    frame.addEventListener('load', () => setTimeout(ready, 8000), { once: true })
    // how its mark moves (repl/editor/play.js), a `mark` event on the element: { mode: rest, work, play, record or
    // scrub } as it changes, { turn } for each turn a scrub gives it; a page's own mark moves with it (../logo/mark.js sways)
    addEventListener('message', e => {
      if (e.source !== frame.contentWindow) return
      // (what the list offers, asked by edits())
      if (e.data?.audio === 'edits' || e.data?.audio === 'answer') { this.answers?.get(e.data.id)?.(e.data.list ?? e.data.answer); this.answers?.delete(e.data.id); return }
      // how far its work has come (repl/editor/run.js progress), a `progress` event on the element, for the page to draw
      // at its own top: { p } 0 to 1, or null while busy with no figure; { done: true } once it ends
      // its script, as it changed there; its state (host.js): said on to the page's parts as <audio-sound> says its own
      if (e.data?.audio === 'code') {
        if (this.sent && e.data.code !== this.sent.code && performance.now() < this.sent.till) return
        this.sent = null
        const fresh = e.data.code !== this.code
        this.told = { code: e.data.code, opens: e.data.opens ?? [], saves: e.data.saves ?? [] }
        if (fresh) this.dispatchEvent(new Event('input', { bubbles: true }))
        return this.dispatchEvent(new CustomEvent('change'))
      }
      if (e.data?.audio === 'state') {
        const { audio, ...now } = e.data, was = this.state
        this.state = now
        // (shown once its sound has a length: the file as it is, drawn while an edit that takes seconds is still made
        // on it, where the mark's first rest would keep the skeleton up till that edit is in)
        if (now.duration) ready()
        this.dispatchEvent(new CustomEvent('change'))
        if (now.duration && now.duration !== was.duration) this.dispatchEvent(new CustomEvent('run'))
        if (now.playing !== was.playing) this.dispatchEvent(new CustomEvent(now.playing ? 'play' : 'pause'))
        if (now.time !== was.time) this.dispatchEvent(new CustomEvent('timeupdate'))
        return
      }
      if (e.data?.audio === 'progress') return this.dispatchEvent(new CustomEvent('progress', { detail: e.data.done ? { done: true } : { p: Number.isFinite(e.data.p) ? e.data.p : null } }))
      if (e.data?.audio !== 'mark') return
      this.heard = true
      this.send()
      if (e.data.mode === 'rest') ready()
      this.dispatchEvent(new CustomEvent('mark', { detail: e.data }))
    })
    frame.src = new URL(`./?${q}#code=${await pack(this.script)}`, HOME)
    this.append(frame)
  }

  // An edit the page asks for (a call as the ops write one); the frame waits for its sound before it makes it
  // (repl/editor/menus.js pageEdit)
  edit(call) { this.ask({ audio: 'edit', call: String(call) }) }
  // What the chain's list offers, by kind, in its order, recipes left out: a promise of [{ kind, edits: [{ call, name,
  // value, line }] }], each call what edit() takes (repl/editor/menus.js offer)
  edits() { return this.answer({ audio: 'edits' }) }
  // A sample the page asks for in the sound's place, as the sound's menu opens one, one step of its history: a recording
  // of the playground's samples by its file as /samples/index.json names it (speech/gettysburg-address.mp3), or a
  // synthesized one by its name (chime.wav); its word, its line and its credit the catalogue's. A promise of what is open
  // once its sound is in, as sound() says it, or { error } (no such sample, it would not open, another asked for after
  // it) (repl/editor/files.js pageOpen)
  // A File of the reader's own instead, opened as one dropped on the frame, as <audio-sound>'s open() takes one
  open(file) { return file instanceof Blob ? this.ask({ audio: 'file', file }) : this.answer({ audio: 'open', file: String(file) }) }
  // The sound open now: a promise of { name, kind, file, title, about }, file, title and about the catalogue's where it is
  // one of its recordings, else null (repl/editor/files.js pageSound)
  sound() { return this.answer({ audio: 'sound' }) }
  // (a message the frame answers, by its id)
  answer(message) { return new Promise(resolve => { const id = this.asked = (this.asked ?? 0) + 1; (this.answers ??= new Map()).set(id, resolve); this.ask({ ...message, id }) }) }
  // a message to the frame, sent once it listens (its first mark: the editor's scripts in), the frame loaded first where
  // it is not in yet
  ask(message) { (this.queued ??= []).push(message); this.load(); this.send() }
  send() { if (this.heard) for (const m of this.queued?.splice(0) ?? []) this.frame.contentWindow.postMessage(m, HOME.origin) }
}

if (!customElements.get('audio-repl')) customElements.define('audio-repl', AudioRepl)
