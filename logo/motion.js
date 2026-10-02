// The logo answering the hand, for the logo page and the site's header. A drag turns it, the signal following the
// pointer under its window; let go, it spins on until friction brings it back to its own speed and, with no speed of its
// own, it catches in the logo pose. A tap gives it the next signal. Hovered near its middle, it stirs, or, as a mimic,
// copies the pointer's sideways moves, as a drag would, and settles back when the pointer leaves. Its own speed comes on
// gently, as a car creeps off the brake, and goes at once. Clicked as a link to another page, it launches, and the page
// it opens takes up its turn and spin.
import { SIGNALS } from './logo.js'

const DRAG = 4 // px a press moves before it is a drag
const MIMIC = 16 // a second: how quickly a mimic catches up with the pointer it copies, a lag of about 60 ms
const SHAPES = Object.keys(SIGNALS)
const ACCEL = 1.5, BRAKE = 10 // how fast, a second, its own speed comes on and goes
const HOLD = 600 // the catch into the pose: a spring's stiffness, critically damped, still within 300 ms
const LAUNCH = { speed: 3, rate: 4, ms: 700 } // clicked away: turns a second it gathers toward, how fast, for how long
const CARRY = 'audio-logo' // where a page leaving hands its motion to the next, for sessionStorage

// What hovering adds, by name: turns a second, in the way it already turns, and times as many cycles. A hover with a
// burst sets off at once and eases out over `ms` to the pace it keeps. One with `follow` copies the pointer: its sideways
// moves turn the wave by that share of what a drag's would, and it stays where they leave it until the pointer goes.
// A setting may also give its own { speed, cycles, burst, ms, follow }
export const HOVERS = { none: { speed: 0, cycles: 1 }, mimic: { speed: 0, cycles: 1, follow: .5 }, creep: { speed: .5, cycles: 1, burst: 3, ms: 1100 }, drift: { speed: .3, cycles: 1 }, stir: { speed: .8, cycles: 2 }, tighten: { speed: .15, cycles: 3 } }
// What a drag upward does, beyond turning it
export const LIFTS = ['none', 'amplitude', 'tension']
// How it sounds: a tick each time a peak, crest or trough, passes through the middle, however it turns; or, under the
// hand, the logo's own tone, sin x + ½ sin 2x, pitched by the spin
export const SOUNDS = ['none', 'ticks', 'tone']
// What a hover adds at `ms` after it began, turns a second: it sets off within 120 ms, at its pace and a burst on top
// of it, and the burst eases out, falling as the square of what is left of its length, to the pace it keeps
export function extra(hover, ms) {
  const go = Math.min(1, ms / 120), left = 1 - Math.min(1, ms / (hover.ms ?? 1))
  return (hover.speed + (hover.burst ?? 0) * left * left) * go * go * (3 - 2 * go)
}
// The last peak through the middle at a phase, counted in half turns: the crest stands there a quarter turn past each
// rest turn and the trough half a turn after it, so a tick falls wherever this changes, never at rest
export const peak = phase => Math.floor(2 * (phase - .25))

// A spring toward a target, stepped finely enough to stay stable: damping 1 comes to rest without overshoot, less wobbles.
// Whatever is no number, in the state or the target, is dropped: one bad value never freezes it there.
function spring(x, velocity, target, dt, stiffness, damping) {
  if (!Number.isFinite(target)) return [x, velocity]
  for (let t = 0; t < dt; t += 1 / 240) {
    const h = Math.min(1 / 240, dt - t)
    velocity += (-stiffness * (x - target) - 2 * damping * Math.sqrt(stiffness) * velocity) * h
    x += velocity * h
  }
  return Number.isFinite(x) && Number.isFinite(velocity) ? [x, velocity] : [target, 0]
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
 * settings: speed (turns a second on its own), cycles and amplitude (its height), each a number or a function read each
 * frame, eased either way; axis, how much of the ink the zero axis takes (see logo.js), 0 to 1, a number or a function
 * too, taking it at once; signal (a name, or a function read each frame that gives a trace, drawn every frame while it
 * is set: see logo.js); hover (a key of HOVERS, or its own), lift, sound; hold, to keep it from catching in its pose
 * while something else turns it by turn(); tap, whether a tap gives the next signal, and ontap(signal) to hear which;
 * ondraw(), called after each frame drawn; area, an element whose hover and drag stand for the canvas's, as a whole title for its mark; favicon, to
 * show the wave in the tab; hidden, to keep moving while the page is hidden, where the tab's icon is all that shows.
 * set() changes settings, and set({}) redraws; turn(turns) turns it at once, and phase reads where it has turned to.
 */
export function motion(view, canvas, settings = {}) {
  const o = { speed: 0, cycles: 1, amplitude: 1, signal: 'sine', hover: 'stir', lift: 'none', sound: 'none', tap: true, hidden: false, axis: 0, ...settings }
  // velocity is the motor's drive and what a hand gave, the fling; pose, the rest turn it is caught toward
  const s = { hovered: false, over: false, seen: null, follow: 0, pressed: false, dragging: false, lift: 0, phase: 0, velocity: 0, drive: 0, fling: 0, pose: null, launch: -Infinity, ran: -Infinity, was: false, spin: 0, cycles: typeof o.cycles === 'function' ? 1 : o.cycles, cyclesVelocity: 0, amplitude: 1, amplitudeVelocity: 0, axis: 0, grab: null, tick: peak(0), tone: null }
  const surface = o.area ?? canvas
  const still = matchMedia('(prefers-reduced-motion: reduce)')
  let changed = true, morphing = false, dragged = false
  // Turns for a sideways move of the pointer, px: across the drawing's width, a cycle
  const turns = dx => s.cycles * dx * canvas.width / canvas.clientWidth / view.scale() / 2

  // Near the middle: inside an ellipse over the waveform's centre, most of a lobe across and one high
  const near = e => {
    const box = canvas.getBoundingClientRect(), px = canvas.width / canvas.clientWidth, scale = view.scale()
    const x = ((e.clientX - box.left) * px - canvas.width / 2) / scale, y = ((e.clientY - box.top) * px - canvas.height / 2) / scale
    return (x / .8) ** 2 + y ** 2 < 1
  }
  const press = () => {
    s.pressed = true
    s.pose = null
    s.phase += s.follow
    s.follow = 0
    if (o.sound !== 'none') hear()
  }
  // Let go: a drag flings with its last speed, unless the hand had stopped; a press that never moved is a tap
  const release = e => {
    if (!s.pressed) return
    if (s.dragging && e && e.timeStamp - s.grab.at > 80) s.velocity = 0
    if (s.dragging) s.fling = s.velocity - s.drive
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
    if (!o.area) s.over = s.hovered = near(e)
    // a mimic takes the pointer's sideways move (a jump of more than 60 px counts for 60) to turn by a moment later
    const hover = HOVERS[o.hover] ?? o.hover, from = s.seen ?? e.clientX
    s.seen = e.clientX
    if (hover.follow && s.over && !s.grab && e.pointerType !== 'touch' && canvas.clientWidth && !still.matches) s.follow += hover.follow * turns(Math.max(-60, Math.min(60, e.clientX - from)))
    if (!s.grab) return
    if (!s.dragging && Math.hypot(e.clientX - s.grab.x, e.clientY - s.grab.y) < DRAG) return
    s.dragging = true
    surface.classList.add('turning')
    const turned = turns(e.clientX - s.grab.lastX), dt = Math.max(1, e.timeStamp - s.grab.at) / 1000
    s.phase += turned
    s.velocity = .6 * s.velocity + .4 * turned / dt
    s.lift = s.grab.y - e.clientY
    Object.assign(s.grab, { lastX: e.clientX, at: e.timeStamp })
  })
  surface.addEventListener('pointerup', release)
  surface.addEventListener('pointercancel', release)
  // A drag is not a click: whatever the area does when clicked, a link's jump say, waits for a real one. A click that
  // leaves for another page, in this tab, launches it.
  surface.addEventListener('click', e => {
    if (dragged) e.preventDefault(), e.stopPropagation()
    else if (surface.href && surface.href.split('#')[0] !== location.href.split('#')[0] && !(e.metaKey || e.ctrlKey || e.shiftKey || e.altKey)
      && !still.matches) s.launch = performance.now() + LAUNCH.ms
    dragged = false
  }, true)
  if (o.area) surface.addEventListener('pointerenter', e => { s.over = s.hovered = true; s.seen = e.clientX })
  surface.addEventListener('pointerleave', () => { s.over = s.hovered = false; s.seen = null })
  surface.addEventListener('focus', () => s.hovered = true)
  surface.addEventListener('blur', () => { s.hovered = false; release() })
  // Keys, on the drawing itself: the arrows nudge it as a small fling would; Space or Enter is a tap. An area keeps its own.
  if (!o.area) {
    canvas.addEventListener('keydown', e => {
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { e.preventDefault(); s.fling += e.key === 'ArrowRight' ? 1 : -1 }
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

  // Between pages it carries on: leaving, it hands on its turn, its spin and what is left of a launch, which the page
  // it opens takes up, when it opens within a couple of seconds
  addEventListener('pagehide', () => {
    try { sessionStorage.setItem(CARRY, JSON.stringify({ at: Date.now(), phase: s.phase % 1, velocity: s.velocity, launch: s.launch - performance.now() })) } catch {}
  })
  function arrive() {
    let got = null
    try { got = JSON.parse(sessionStorage.getItem(CARRY)); sessionStorage.removeItem(CARRY) } catch {}
    const late = got ? Date.now() - got.at : Infinity
    if (!(late < 2000)) return
    Object.assign(s, { phase: got.phase, drive: got.velocity, fling: 0, pose: null, launch: performance.now() + got.launch - late, tick: peak(got.phase) })
    changed = true
  }
  arrive()
  addEventListener('pageshow', e => { if (e.persisted) arrive() })

  let last = performance.now(), failed = false
  // A frame that throws is reported once and does not end the animation: the mark carries on with the next
  function frame(now) {
    try { step(now) } catch (error) { if (!failed) console.error(error); failed = true }
    next()
  }
  function step(now) {
    const dt = Math.min(.1, Math.max(0, now - last) / 1000), hover = HOVERS[o.hover] ?? o.hover, active = s.hovered || s.pressed
    last = now
    // a mimic's turn from the pointer goes into the phase over a moment: it lags behind, as a copy does
    if (s.follow) {
      const move = s.follow * (1 - Math.exp(-MIMIC * dt))
      s.phase += move
      s.follow = Math.abs(s.follow - move) < 1e-6 ? 0 : s.follow - move
      changed = true
    }
    const launched = now < s.launch
    if (active && !s.was) s.ran = now
    s.was = active
    const running = active && hover.burst && now - s.ran < hover.ms
    const motor = launched ? LAUNCH.speed : o.speed + (active ? Math.sign(o.speed || 1) * (running ? extra(hover, now - s.ran) : hover.speed) : 0)
    if (!s.dragging) {
      const rate = Math.abs(motor) < Math.abs(s.drive) ? BRAKE : launched ? LAUNCH.rate : ACCEL
      s.drive = running && !launched ? motor : motor + (s.drive - motor) * Math.exp(-rate * dt)
      // No motor, no hand, a fling all but spent: caught in the pose it is heading for, not rolled back to one behind,
      // and held to it until something moves it again, the catch's own speed included. A mimic keeps to where the pointer
      // that it copies has left it, until that goes.
      if (Math.abs(motor) < 1e-3 && !s.pressed && !o.hold && !(s.over && hover.follow) && (s.pose != null || Math.abs(s.fling) < .3)) {
        s.velocity = s.drive + s.fling
        s.pose ??= Math.round(s.phase + s.velocity / (Math.sqrt(HOLD) * Math.E))
        ;[s.phase, s.velocity] = spring(s.phase, s.velocity, s.pose, dt, HOLD, 1)
        s.drive = 0
        s.fling = s.velocity
      } else {
        s.fling *= Math.exp(-dt)
        s.velocity = s.drive + s.fling
        s.phase += s.velocity * dt
        s.pose = null
      }
    }
    s.spin = s.dragging ? Math.abs(s.velocity) : Math.abs(s.velocity - motor)
    const lift = s.dragging ? s.lift : 0
    const cycles = (typeof o.cycles === 'function' ? o.cycles() : o.cycles) * (active ? hover.cycles : 1) * (o.lift === 'tension' ? Math.min(6, Math.max(.5, 1 + lift / 40)) : 1)
    const amplitude = (typeof o.amplitude === 'function' ? o.amplitude() : o.amplitude) * (o.lift === 'amplitude' ? Math.min(1.8, Math.max(.1, 1 + lift / 60)) : 1)
    // A lift follows the hand at once; everything else eases, with a little give
    const [stiffness, damping] = s.dragging && o.lift !== 'none' ? [900, 1] : [400, .8]
    ;[s.cycles, s.cyclesVelocity] = spring(s.cycles, s.cyclesVelocity, cycles, dt, stiffness, damping)
    ;[s.amplitude, s.amplitudeVelocity] = spring(s.amplitude, s.amplitudeVelocity, amplitude, dt, stiffness, damping)
    // the axis is there or not, at once
    const axis = typeof o.axis === 'function' ? o.axis() : o.axis
    if (Number.isFinite(axis) && axis !== s.axis) { s.axis = axis; changed = true }
    if (audio) listen()
    // Drawn only while something moves or changes, or a trace is live
    const live = typeof o.signal === 'function'
    if (changed || morphing || live || s.pressed || Math.abs(s.velocity) > 1e-5 || Math.abs(s.cyclesVelocity) > 1e-5 || Math.abs(s.amplitudeVelocity) > 1e-5) {
      changed = false
      view.set({ phase: s.phase, cycles: s.cycles, amplitude: s.amplitude, axis: Math.min(1, Math.max(0, s.axis)), signal: live ? o.signal() : o.signal }, now)
      morphing = view.render(now)
      o.ondraw?.()
      if (tab) {
        clearTimeout(trailing)
        if (now - shown > 125) favicon()
        else trailing = setTimeout(favicon, 125)
      }
    }
  }
  // Frames follow the display, which stops for a hidden page; a mark kept moving (hidden) with an icon in the tab
  // steps on a timer instead, at the icon's pace
  let pending = 0, timed = false
  function next() {
    timed = document.hidden && o.hidden && !!tab
    pending = timed ? setTimeout(() => frame(performance.now()), 125) : requestAnimationFrame(frame)
  }
  const restart = () => { (timed ? clearTimeout : cancelAnimationFrame)(pending); next() }
  document.addEventListener('visibilitychange', restart)
  next()

  return {
    // Where its wave has turned to, in turns, what a mimic is still to turn included
    get phase() { return s.phase + s.follow },
    // Turns it by so many turns at once, as a hand or a scrubbed sound would
    turn(turns) { s.phase += turns; s.pose = null; changed = true },
    set(changes) {
      Object.assign(o, changes)
      changed = true
      if (o.sound !== 'none' && navigator.userActivation?.isActive) hear()
      if (document.hidden) restart()
    },
  }
}
