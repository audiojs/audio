// <audio-repl>: the audio playground in any page, its script the element's own text.
//
//   <script type="module" src="https://audio.js.org/embed.js"></script>
//   <audio-repl panel="code" display="wave" height="320">
//   <pre><code>audio('chime.wav').trim().normalize(-1)</code></pre>
//   </audio-repl>
//
// The text is for where scripts don't run, and for a search engine; where they run, a skeleton of the playground's parts
// holds their places, a light passing along it, till the frame's sound is in (a page hides the text till then with
// `@media (scripting: enabled) { audio-repl:not(:defined) > pre { visibility: hidden } }`). Once the element is near
// the screen a frame of the playground takes its place: the script runs, its sound drawn, played, edited, opened whole
// in the playground. Nothing of the reader's is kept. A sound named by its path from the site's root,
// audio('/sounds/take.mp3'), is that site's file. Its mark's moves come out as `mark` events, for a page's own logo to
// move with it.
//
// What it shows, the frame takes as one JSON (?ui=, playground/editor.js reads it): the element's `ui` attribute, as
// that JSON, and over it these attributes, each one key of it:
//   panel       code (the script beside the picture), edits (its steps, each with its settings) or none
//   display     wave or spec
//   controls    the parts shown, each in its own place whatever the list's order. Over the picture: sound (its name, a
//               menu of its ways in: a file, a take, a sample), link and name (the way to the playground, its name);
//               ruler, the time row (left out, none: the big time says it); look, a band's dropdown of how it draws. In
//               the bar: play record loop clock history message heard, a level (level, or what it reads: peak, rms,
//               loudness), rate channels depth before, view (a switch: the waveform, the spectrogram), open and save (a
//               file of the reader's in; the result out, in the format picked from its menu). Without it, all but
//               sound, view, open and save
//   ops         edits a press away, one button after the history, a menu of them, as `trim normalize(-1) stretch(1.25)`:
//               a call's own arguments, or the defaults the menus write
//   background  the ground it sits on and fades into, a CSS colour, or page: the page's own under the element, read
//               off the page here (a frame can't see the page around it)
//   height      in px (320), the element's own
const HOME = new URL('./', import.meta.url)

// The colour a page shows under an element: the first box from it up that paints one of its own, else the page's
const clear = c => !c || c === 'transparent' || /,\s*0\)$|\/\s*0\)$/.test(c)
function ground(el) {
  for (let e = el; e; e = e.parentElement) { const c = getComputedStyle(e).backgroundColor; if (!clear(c)) return c }
  return clear(getComputedStyle(document.documentElement).backgroundColor) ? 'white' : getComputedStyle(document.documentElement).backgroundColor
}

// the script as the playground's links carry it: deflated, base64url
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

// The skeleton of an element's playground, laid out as index.html lays out its parts at the element's size: the
// sound's name and the way to the playground over the picture; a panel beside it, or under the bar at 640 px and
// narrower (panel, code unless none); the bar: play, the time (large where the picture has the width), the history, and
// past 670 px the facts. On the page's ground (background) the bar starts at the frame's edge
function skeleton(el) {
  const W = el.clientWidth, H = el.clientHeight, panel = el.getAttribute('panel') !== 'none', narrow = W <= 640
  const under = panel && narrow ? Math.round(H * .45) : 0, bar = H - under - 60, side = panel && !narrow ? Math.round(W * .44) : W
  const x = el.hasAttribute('background') ? 0 : 12, wide = !panel && !narrow
  const block = (left, top, width, height, round = 4, area = false) => `<i${area ? ' class="area"' : ''} style="left:${left}px;top:${top}px;width:${Math.max(0, width)}px;height:${Math.max(0, height)}px;border-radius:${round}px"></i>`
  return [
    block(12, 13, 140, 12), block(side - 158, 14, 146, 10),
    block(8, 46, side - 16, bar - 54, 8, true),
    panel && (narrow ? block(8, H - under + 8, W - 16, under - 16, 8, true) : block(side + 8, 46, W - side - 16, bar - 54, 8, true)),
    block(x + 10, bar + 18, 24, 24, 12), block(x + 50, bar + 17, wide ? 150 : 86, 26), block(x + (wide ? 214 : 150), bar + 24, 56, 12),
    W > 670 && block(W - 136, bar + 25, 124, 10)
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
  get script() { return this.code ??= dedent((this.querySelector('pre') ?? this).textContent) }

  async load() {
    if (this.frame) return
    // the frame's one JSON: the ui attribute's, each attribute over it; controls and ops their words, or calls with their
    // arguments, the spaces in a call's parentheses kept; background page, the colour the page shows under the element
    let ui = {}
    try { ui = JSON.parse(this.getAttribute('ui') || '{}') } catch {}
    const words = name => this.getAttribute(name).match(/[\w-]+(?:\([^)]*\))?/g) ?? []
    for (const name of ['panel', 'display', 'background']) if (this.hasAttribute(name)) ui[name] = this.getAttribute(name).trim()
    for (const name of ['controls', 'ops']) if (this.hasAttribute(name)) ui[name] = words(name)
    if (ui.background === 'page') ui.background = ground(this.parentElement)
    const q = new URLSearchParams({ embed: '' })
    if (Object.keys(ui).length) q.set('ui', JSON.stringify(ui))
    const frame = this.frame = document.createElement('iframe')
    frame.title = this.getAttribute('title') || 'audio playground: the script, its sound, to play and edit'
    // the microphone, for a script that records; the clipboard, for the editor's copy
    frame.allow = 'microphone; autoplay; clipboard-write'
    // shown once its sound is in, its mark first at rest; or a while after it loads, whatever its script does
    const ready = () => { if ('ready' in this.dataset) return; this.dataset.ready = ''; this.sizes?.disconnect(); setTimeout(() => this.wait?.remove(), 400) }
    frame.addEventListener('load', () => setTimeout(ready, 8000), { once: true })
    // how its mark moves (playground/editor.js), a `mark` event on the element: { mode: rest, work, play, record or
    // scrub } as it changes, { turn } for each turn a scrub gives it; a page's own mark moves with it (../logo/mark.js sways)
    addEventListener('message', e => {
      if (e.source !== frame.contentWindow || e.data?.audio !== 'mark') return
      if (e.data.mode === 'rest') ready()
      this.dispatchEvent(new CustomEvent('mark', { detail: e.data }))
    })
    frame.src = new URL(`./?${q}#code=${await pack(this.script)}`, HOME)
    this.append(frame)
  }
}

if (!customElements.get('audio-repl')) customElements.define('audio-repl', AudioRepl)
