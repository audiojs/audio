// The logo answering the hand, for the logo page and the site's header. A drag turns it, the signal following the
// pointer under its window; let go, it spins on until friction brings it back to its own speed and, with no speed of its
// own, it catches in the logo pose. A tap gives it the next signal. Hovered near its middle, it stirs.
import { SIGNALS } from './logo.js'

const DRAG = 4 // px a press moves before it is a drag
const SHAPES = Object.keys(SIGNALS)

// What hovering near its middle adds: turns a second, in the way it already turns, and times as many cycles
export const HOVERS = { none: { speed: 0, cycles: 1 }, drift: { speed: .3, cycles: 1 }, stir: { speed: .8, cycles: 2 }, tighten: { speed: .15, cycles: 3 } }
// What a drag upward does, beyond turning it
export const LIFTS = ['none', 'amplitude', 'tension']
// How it sounds: a tick each time a peak, crest or trough, passes through the middle, however it turns; or, under the
// hand, the logo's own tone, sin x + ½ sin 2x, pitched by the spin
export const SOUNDS = ['none', 'ticks', 'tone']
// The last peak through the middle at a phase, counted in half turns: the crest stands there a quarter turn past each
// rest turn and the trough half a turn after it, so a tick falls wherever this changes, never at rest
export const peak = phase => Math.floor(2 * (phase - .25))

// A spring toward a target, stepped finely enough to stay stable: damping 1 comes to rest without overshoot, less wobbles
function spring(x, velocity, target, dt, stiffness, damping) {
  for (let t = 0; t < dt; t += 1 / 240) {
    const h = Math.min(1 / 240, dt - t)
    velocity += (-stiffness * (x - target) - 2 * damping * Math.sqrt(stiffness) * velocity) * h
    x += velocity * h
  }
  return [x, velocity]
}

// Sound starts only once the page has been touched, as browsers require; it rests while the page is hidden
let audio, tick
function hear() {
  audio ??= new AudioContext()
  audio.resume()
  return audio
}
document.addEventListener('visibilitychange', () => audio?.[document.hidden ? 'suspend' : 'resume']())
// A tick: 5 ms of a decaying 1.8 kHz sine
function click() {
  if (!tick) {
    const rate = audio.sampleRate
    tick = audio.createBuffer(1, Math.round(rate * .005), rate)
    const data = tick.getChannelData(0)
    for (let i = 0; i < data.length; i++) data[i] = .05 * Math.sin(2 * Math.PI * 1800 * i / rate) * Math.exp(-5 * i / data.length)
  }
  const source = audio.createBufferSource()
  source.buffer = tick
  source.connect(audio.destination)
  source.start()
}

/**
 * Makes a logo drawn by logo.js on canvas answer the pointer and keys, and animates it, drawing only while something moves.
 * settings: speed (turns a second on its own), cycles, signal, hover (a key of HOVERS), lift, sound; tap, whether a tap
 * gives the next signal, and ontap(signal) to hear which; area, an element whose hover and drag stand for the canvas's,
 * as a whole title for its mark; favicon, to show the wave in the tab. set() changes settings, and set({}) redraws.
 */
export function motion(view, canvas, settings = {}) {
  const o = { speed: 0, cycles: 1, signal: 'sine', hover: 'stir', lift: 'none', sound: 'none', tap: true, ...settings }
  const s = { hovered: false, pressed: false, dragging: false, lift: 0, phase: 0, velocity: 0, spin: 0, cycles: o.cycles, cyclesVelocity: 0, amplitude: 1, amplitudeVelocity: 0, grab: null, tick: peak(0), tone: null }
  const surface = o.area ?? canvas
  let changed = true, morphing = false, dragged = false

  // Near the middle: inside an ellipse over the waveform's centre, most of a lobe across and one high
  const near = e => {
    const box = canvas.getBoundingClientRect(), px = canvas.width / canvas.clientWidth, scale = view.scale()
    const x = ((e.clientX - box.left) * px - canvas.width / 2) / scale, y = ((e.clientY - box.top) * px - canvas.height / 2) / scale
    return (x / .8) ** 2 + y ** 2 < 1
  }
  const press = () => {
    s.pressed = true
    if (o.sound !== 'none') hear()
  }
  // Let go: a drag flings with its last speed, unless the hand had stopped; a press that never moved is a tap
  const release = e => {
    if (!s.pressed) return
    if (s.dragging && e && e.timeStamp - s.grab.at > 80) s.velocity = 0
    dragged = s.dragging
    if (!s.dragging && o.tap) {
      o.signal = SHAPES[(SHAPES.indexOf(o.signal) + 1) % SHAPES.length]
      o.ontap?.(o.signal)
      if (audio && o.sound !== 'none') click()
    }
    Object.assign(s, { pressed: false, dragging: false, grab: null, lift: 0 })
    surface.classList.remove('turning')
  }
  surface.addEventListener('pointerdown', e => {
    surface.setPointerCapture(e.pointerId)
    s.grab = { x: e.clientX, y: e.clientY, lastX: e.clientX, at: e.timeStamp }
    dragged = false
    press()
  })
  surface.addEventListener('pointermove', e => {
    if (!o.area) s.hovered = near(e)
    if (!s.grab) return
    if (!s.dragging && Math.hypot(e.clientX - s.grab.x, e.clientY - s.grab.y) < DRAG) return
    s.dragging = true
    surface.classList.add('turning')
    const turned = s.cycles * (e.clientX - s.grab.lastX) * canvas.width / canvas.clientWidth / view.scale() / 2, dt = Math.max(1, e.timeStamp - s.grab.at) / 1000
    s.phase += turned
    s.velocity = .6 * s.velocity + .4 * turned / dt
    s.lift = s.grab.y - e.clientY
    Object.assign(s.grab, { lastX: e.clientX, at: e.timeStamp })
  })
  surface.addEventListener('pointerup', release)
  surface.addEventListener('pointercancel', release)
  // A drag is not a click: whatever the area does when clicked, a link's jump say, waits for a real one
  surface.addEventListener('click', e => { if (dragged) e.preventDefault(), e.stopPropagation(); dragged = false }, true)
  if (o.area) surface.addEventListener('pointerenter', () => s.hovered = true)
  surface.addEventListener('pointerleave', () => s.hovered = false)
  surface.addEventListener('focus', () => s.hovered = true)
  surface.addEventListener('blur', () => { s.hovered = false; release() })
  // Keys, on the drawing itself: the arrows nudge it as a small fling would; Space or Enter is a tap. An area keeps its own.
  if (!o.area) {
    canvas.addEventListener('keydown', e => {
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { e.preventDefault(); s.velocity += e.key === 'ArrowRight' ? 1 : -1 }
      else if ((e.key === ' ' || e.key === 'Enter') && !e.repeat) { e.preventDefault(); press() }
    })
    canvas.addEventListener('keyup', e => { if (e.key === ' ' || e.key === 'Enter') release() })
  }

  // The tab's icon follows the wave, a few times a second and once more when it comes to rest
  const tab = o.favicon && document.querySelector('link[rel~=icon]')
  let shown = -Infinity, trailing
  const favicon = () => {
    Object.assign(tab, { type: 'image/png', href: view.favicon(matchMedia('(prefers-color-scheme: dark)').matches ? '#F2F4F8' : '#141414') })
    shown = performance.now()
  }

  // Any touch of the page may start the sound, so it can tick while the logo turns on its own
  const listening = () => { if (o.sound !== 'none') hear() }
  document.addEventListener('pointerdown', listening)
  document.addEventListener('keydown', listening)

  // Ticks follow every turn; the tone, the hand's spin only, over what the logo does on its own
  function listen() {
    const on = o.sound !== 'none', speed = Math.min(8, s.spin)
    if (on && o.sound === 'tone') {
      s.tone ??= voice()
      s.tone.tone.frequency.setTargetAtTime(55 + 110 * speed, audio.currentTime, .015)
    }
    s.tone?.level.gain.setTargetAtTime(on && o.sound === 'tone' ? .05 * Math.min(1, speed / 1.5) : 0, audio.currentTime, .03)
    const passed = peak(s.phase)
    if (on && o.sound === 'ticks' && passed !== s.tick) click()
    s.tick = passed
  }
  function voice() {
    const tone = audio.createOscillator(), level = audio.createGain()
    tone.setPeriodicWave(audio.createPeriodicWave(new Float32Array(3), new Float32Array([0, 1, .5])))
    level.gain.value = 0
    tone.connect(level).connect(audio.destination)
    tone.start()
    return { tone, level }
  }

  let last = performance.now()
  function frame(now) {
    const dt = Math.min(.1, Math.max(0, now - last) / 1000), hover = HOVERS[o.hover], active = s.hovered || s.pressed
    last = now
    const motor = o.speed + (active ? Math.sign(o.speed || 1) * hover.speed : 0)
    if (!s.dragging) {
      s.velocity = motor + (s.velocity - motor) * Math.exp(-dt)
      if (Math.abs(motor) < 1e-3 && Math.abs(s.velocity) < .3 && !s.pressed)
        [s.phase, s.velocity] = spring(s.phase, s.velocity, Math.round(s.phase), dt, 40, 1)
      else s.phase += s.velocity * dt
    }
    s.spin = s.dragging ? Math.abs(s.velocity) : Math.abs(s.velocity - motor)
    const lift = s.dragging ? s.lift : 0
    const cycles = o.cycles * (active ? hover.cycles : 1) * (o.lift === 'tension' ? Math.min(6, Math.max(.5, 1 + lift / 40)) : 1)
    const amplitude = o.lift === 'amplitude' ? Math.min(1.8, Math.max(.1, 1 + lift / 60)) : 1
    // A lift follows the hand at once; everything else eases, with a little give
    const [stiffness, damping] = s.dragging && o.lift !== 'none' ? [900, 1] : [150, .6]
    ;[s.cycles, s.cyclesVelocity] = spring(s.cycles, s.cyclesVelocity, cycles, dt, stiffness, damping)
    ;[s.amplitude, s.amplitudeVelocity] = spring(s.amplitude, s.amplitudeVelocity, amplitude, dt, stiffness, damping)
    if (audio) listen()
    // Drawn only while something moves or changes
    if (changed || morphing || s.pressed || Math.abs(s.velocity) > 1e-5 || Math.abs(s.cyclesVelocity) > 1e-5 || Math.abs(s.amplitudeVelocity) > 1e-5) {
      changed = false
      view.set({ phase: s.phase, cycles: s.cycles, amplitude: s.amplitude, signal: o.signal }, now)
      morphing = view.render(now)
      if (tab) {
        clearTimeout(trailing)
        if (now - shown > 125) favicon()
        else trailing = setTimeout(favicon, 125)
      }
    }
    requestAnimationFrame(frame)
  }
  requestAnimationFrame(frame)

  return {
    set(changes) {
      Object.assign(o, changes)
      changed = true
      if (o.sound !== 'none' && navigator.userActivation?.isActive) hear()
    },
  }
}
