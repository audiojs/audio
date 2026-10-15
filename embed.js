// <audio-repl>: the audio playground in any page, its script the element's own text.
//
//   <script type="module" src="https://audio.js.org/embed.js"></script>
//   <audio-repl panel="code" display="wave" height="320">
//   <pre><code>audio('chime.wav').trim().normalize(-1)</code></pre>
//   </audio-repl>
//
// The text shows as it is until the frame comes (and where scripts don't run, or for a search engine); once the element
// is near the screen a frame of the playground takes its place: the script runs, its sound drawn, played, edited,
// opened whole in the playground. Nothing of the reader's is kept. Attributes: panel, code (the script beside the
// picture), edits (its steps, each with its settings) or none; display, wave or spec; height, in px (320).
const HOME = new URL('./', import.meta.url)

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
  audio-repl > pre { box-sizing: border-box; height: 100%; margin: 0; padding: 16px 18px; overflow: auto; background: none; color: inherit; font: 13px/1.55 ui-monospace, SFMono-Regular, Menlo, monospace; }
  audio-repl > iframe { position: absolute; inset: 0; width: 100%; height: 100%; border: 0; color-scheme: normal; opacity: 0; transition: opacity .2s ease-out; }
  audio-repl[data-ready] > iframe { opacity: 1; }
  audio-repl[data-ready] > pre { visibility: hidden; }
  /* narrow, the panel goes under the picture: room for both */
  @media (max-width: 640px) { audio-repl:not([panel=none]) { height: max(var(--audio-repl-height, 320px), 440px); } }
  @media (prefers-reduced-motion: reduce) { audio-repl > iframe { transition: none; } }`

class AudioRepl extends HTMLElement {
  static observer = new IntersectionObserver(entries => {
    for (const e of entries) if (e.isIntersecting) { AudioRepl.observer.unobserve(e.target); e.target.load() }
  }, { rootMargin: '400px 0px' })

  connectedCallback() {
    if (!document.getElementById('audio-repl-style')) document.head.append(Object.assign(document.createElement('style'), { id: 'audio-repl-style', textContent: STYLE }))
    const height = parseFloat(this.getAttribute('height'))
    if (height > 0) this.style.setProperty('--audio-repl-height', `${height}px`)
    if (!this.frame) AudioRepl.observer.observe(this)
  }
  disconnectedCallback() { AudioRepl.observer.unobserve(this) }

  // the script: the element's code as written, read once, before the frame goes in beside it
  get script() { return this.code ??= dedent((this.querySelector('pre') ?? this).textContent) }

  async load() {
    if (this.frame) return
    const q = new URLSearchParams({ embed: '' })
    for (const name of ['panel', 'display']) if (this.hasAttribute(name)) q.set(name, this.getAttribute(name))
    const frame = this.frame = document.createElement('iframe')
    frame.title = this.getAttribute('title') || 'audio playground: the script, its sound, to play and edit'
    // the microphone, for a script that records; the clipboard, for the editor's copy
    frame.allow = 'microphone; autoplay; clipboard-write'
    frame.addEventListener('load', () => this.dataset.ready = '', { once: true })
    frame.src = new URL(`playground.html?${q}#code=${await pack(this.script)}`, HOME)
    this.append(frame)
  }
}

if (!customElements.get('audio-repl')) customElements.define('audio-repl', AudioRepl)
