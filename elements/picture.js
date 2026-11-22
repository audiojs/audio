// What a sound's pictures share (wave.js, spectrogram.js): a canvas as large as the element, a lane for each channel
// of the sound's output, the place it plays drawn over it, and a press or a drag on it to go elsewhere. Drawn by the
// renderers the editor's own view draws with (gl-waveform, gl-spectrogram: assets/), loaded with the first sound; the
// whole sound across the element's width, no zoom: the editor's view (repl/view.js) is the picture that zooms, selects
// and is edited on, and is not this one yet.
//
// A picture is a part (part.js): of the <audio-sound> it is in, or the one its `for` names. In sight, it has its sound
// run, there being no picture of a sound not made; `lazy`, it waits for the sound to be played or saved. It is a
// slider to the keys and a screen reader: the arrows move a second (with shift, five), Home and End to its ends.
// Its ink is the element's `color`; data-drawn once it shows a sound, data-working while its sound is made.
import { Part, styles, clock } from './part.js'

styles('audio-picture-style', `
:where(audio-wave, audio-spectrogram) { display: block; position: relative; height: 6em; touch-action: pan-y; cursor: text; }
:where(audio-wave, audio-spectrogram) > canvas { display: block; position: absolute; inset: 0; width: 100%; height: 100%; }
:where(audio-wave, audio-spectrogram) > i { position: absolute; top: 0; bottom: 0; left: 0; width: 1px; background: currentColor; pointer-events: none; will-change: transform; }
:where(audio-wave, audio-spectrogram):not([data-drawn]) > i { display: none; }
:where(audio-wave, audio-spectrogram):focus-visible { outline: 1.5px solid currentColor; outline-offset: 3px; }
/* a wave not drawn yet: its zero line */
:where(audio-wave):not([data-drawn])::before { content: ''; position: absolute; inset: 50% 0 auto; border-top: 1px solid; opacity: .25; }`)

export class Picture extends Part {
  static hears = ['change', 'timeupdate', 'run']
  #canvas; #caret; #lanes = []; #of = null; #lib = null; #frame = 0; #seen = null; #sizes = null

  // what draws a lane: its module (a promise of its class), the options of a lane's own, and how a piece of a long
  // sound is given it
  renderer() {}
  options() { return {} }
  summarize() {}

  make() {
    this.#canvas = this.appendChild(document.createElement('canvas'))
    this.#caret = this.appendChild(document.createElement('i'))
    this.tabIndex = 0
    for (const [k, v] of Object.entries({ role: 'slider', 'aria-label': 'Position', 'aria-valuemin': '0' })) this.setAttribute(k, v)
    // a press on it, and the pointer dragged along it: there
    const at = e => { const r = this.getBoundingClientRect(), d = this.sound?.duration ?? 0; if (d && r.width) this.sound.time = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)) * d }
    this.addEventListener('pointerdown', e => { if (e.button) return; this.setPointerCapture(e.pointerId); at(e) })
    this.addEventListener('pointermove', e => { if (this.hasPointerCapture(e.pointerId)) at(e) })
    this.addEventListener('keydown', e => {
      const s = this.sound, d = s?.duration ?? 0, step = e.shiftKey ? 5 : 1
      const to = { ArrowLeft: s?.time - step, ArrowRight: s?.time + step, Home: 0, End: d }[e.key]
      if (!d || to == null) return
      e.preventDefault()
      s.time = Math.max(0, Math.min(d, to))
    })
    this.#sizes = new ResizeObserver(() => this.#draw())
    this.#sizes.observe(this)
  }
  connectedCallback() {
    super.connectedCallback()
    // in sight, its sound is made (once it has one to ask)
    if (this.hasAttribute('lazy') || this.#seen) return
    this.#seen = new IntersectionObserver(entries => { if (entries.some(e => e.isIntersecting) && this.sound) { this.#seen.disconnect(); this.sound.run?.()?.catch?.(() => {}) } })
    this.#seen.observe(this)
  }
  disconnectedCallback() {
    super.disconnectedCallback()
    this.#seen?.disconnect()
    this.#seen = null
  }

  show(sound) {
    const o = sound?.output ?? null, d = sound?.duration ?? 0, t = sound?.time ?? 0
    this.toggleAttribute('data-working', !!sound?.working)
    this.setAttribute('aria-valuemax', String(d))
    this.setAttribute('aria-valuenow', String(t))
    this.setAttribute('aria-valuetext', d ? `${clock(t)} of ${clock(d)}` : clock(t))
    this.#caret.style.transform = `translateX(${d ? this.clientWidth * t / d : 0}px)`
    // (a sound joined after the picture came in sight: made now)
    if (sound && this.#seen && !this.hasAttribute('lazy') && !o && !sound.working && !sound.error && this.#inSight()) { this.#seen.disconnect(); sound.run?.()?.catch?.(() => {}) }
    if (o !== this.#of && (o?.channels !== this.#of?.channels || o?.summary !== this.#of?.summary)) this.#take(o)
  }
  #inSight() { const r = this.getBoundingClientRect(); return r.bottom > 0 && r.top < innerHeight && r.width > 0 }

  // An output taken: a lane a channel, each given its samples, or a long sound's pieces; nothing, cleared
  async #take(o) {
    this.#of = o
    for (const lane of this.#lanes.splice(0)) lane.destroy()
    if (!o || !(o.channels ?? o.summary?.length)) { this.toggleAttribute('data-drawn', false); return this.#clear() }
    const Lane = await (this.#lib ??= this.renderer())
    if (this.#of !== o) return
    const count = o.channels ? o.channels.length : o.summary[0].peaks.length
    for (let c = 0; c < count; c++) {
      const lane = new Lane(this.#canvas, { ...o.channels && { data: o.channels[c] }, sampleRate: o.sampleRate })
      if (!o.channels) for (const piece of o.summary) this.summarize(lane, piece, c)
      this.#lanes.push(lane)
    }
    this.toggleAttribute('data-drawn', true)
    this.#draw()
    this.show(this.sound)
  }
  #clear() { const gl = this.#canvas.getContext('webgl2'); if (gl) { gl.viewport(0, 0, this.#canvas.width, this.#canvas.height); gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT) } }
  // Drawn: the canvas sized to the element in device pixels, each lane its share of the height, all of the sound across
  // the width; again on the next frame while a lane has more to compute (a spectrogram's columns)
  #draw() {
    cancelAnimationFrame(this.#frame)
    const o = this.#of, w = this.clientWidth, h = this.clientHeight, ratio = devicePixelRatio || 1, n = this.#lanes.length
    if (!o || !n || !w || !h) return
    if (this.#canvas.width !== Math.round(w * ratio) || this.#canvas.height !== Math.round(h * ratio)) { this.#canvas.width = Math.round(w * ratio); this.#canvas.height = Math.round(h * ratio) }
    const options = this.options(getComputedStyle(this))
    let pending = false
    this.#lanes.forEach((lane, c) => {
      lane.update({ ...options, range: [0, o.length], viewport: [0, Math.round(h * c / n), w, Math.round(h * (c + 1) / n) - Math.round(h * c / n)], pixelRatio: ratio }).clear().render()
      pending ||= !!lane.pending
    })
    if (pending) this.#frame = requestAnimationFrame(() => this.#draw())
  }
}
