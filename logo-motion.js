// The logo answering the hand, for the logo pages and the site's header. A drag turns it, the signal following the
// pointer under its window; let go, it spins on, friction slows it and, with nothing driving it, it catches in the logo
// pose. A tap gives it the next signal. Hovered, it stirs.
import { SIGNALS } from './logo.js'

const DRAG = 4 // px a press moves before it is a drag
const SHAPES = Object.keys(SIGNALS)

// How it moves on its own, turns a second: at rest, and hovered, with its cycles
export const RESTS = { still: 0, drift: .05 }
export const HOVERS = { still: { speed: 0, cycles: 1 }, drift: { speed: .3, cycles: 1 }, stir: { speed: .8, cycles: 2 }, tighten: { speed: .15, cycles: 3 } }
// What a drag upward does, beyond turning it
export const LIFTS = ['none', 'amplitude', 'tension']
// How it sounds under the hand: ticks each eighth of a turn and a knock at each rest turn, like a knob with detents;
// or the logo's own tone, sin x + ½ sin 2x, pitched by the spin
export const SOUNDS = ['none', 'ticks', 'tone']

// A spring toward a target, stepped finely enough to stay stable: damping 1 comes to rest without overshoot, less wobbles
function spring(x, velocity, target, dt, stiffness, damping) {
  for (let t = 0; t < dt; t += 1 / 240) {
    const h = Math.min(1 / 240, dt - t)
    velocity += (-stiffness * (x - target) - 2 * damping * Math.sqrt(stiffness) * velocity) * h
    x += velocity * h
  }
  return [x, velocity]
}

// Sound starts only from a press, as browsers require; it rests while the page is hidden
let audio
const clicks = {}
function hear() {
  audio ??= new AudioContext()
  audio.resume()
  return audio
}
document.addEventListener('visibilitychange', () => audio?.[document.hidden ? 'suspend' : 'resume']())
// A short decaying sine: a tick high and brief, a knock lower and longer
function click(kind) {
  const [pitch, seconds, level] = kind === 'knock' ? [700, .012, .12] : [1800, .005, .05], rate = audio.sampleRate
  if (!clicks[kind]) {
    clicks[kind] = audio.createBuffer(1, Math.round(rate * seconds), rate)
    const data = clicks[kind].getChannelData(0)
    for (let i = 0; i < data.length; i++) data[i] = level * Math.sin(2 * Math.PI * pitch * i / rate) * Math.exp(-5 * i / data.length)
  }
  const source = audio.createBufferSource()
  source.buffer = clicks[kind]
  source.connect(audio.destination)
  source.start()
}

/**
 * Makes a logo drawn by logo.js on canvas answer the pointer and keys, and animates it.
 * settings: { rest, hover, lift, sound } as keys of RESTS, HOVERS, LIFTS and SOUNDS; set() changes them later.
 */
export function motion(view, canvas, settings = {}) {
  const o = { rest: 'drift', hover: 'stir', lift: 'none', sound: 'ticks', ...settings }
  const calm = matchMedia('(prefers-reduced-motion: reduce)').matches
  const s = { hovered: false, pressed: false, dragging: false, lift: 0, taps: 0, phase: 0, velocity: 0, spin: 0, cycles: 1, cyclesVelocity: 0, amplitude: 1, amplitudeVelocity: 0, grab: null, tick: 0, tone: null }

  const press = () => {
    s.pressed = true
    if (o.sound !== 'none') hear()
  }
  // Let go: a drag flings with its last speed, unless the hand had stopped; a press that never moved is a tap
  const release = e => {
    if (!s.pressed) return
    if (s.dragging && e && e.timeStamp - s.grab.at > 80) s.velocity = 0
    if (!s.dragging) {
      s.taps++
      if (audio && o.sound !== 'none') click('knock')
    }
    Object.assign(s, { pressed: false, dragging: false, grab: null, lift: 0 })
    canvas.classList.remove('turning')
  }
  canvas.addEventListener('pointerdown', e => {
    canvas.setPointerCapture(e.pointerId)
    s.grab = { x: e.clientX, y: e.clientY, lastX: e.clientX, at: e.timeStamp }
    press()
  })
  canvas.addEventListener('pointermove', e => {
    if (!s.grab) return
    if (!s.dragging && Math.hypot(e.clientX - s.grab.x, e.clientY - s.grab.y) < DRAG) return
    s.dragging = true
    canvas.classList.add('turning')
    const turned = s.cycles * (e.clientX - s.grab.lastX) * canvas.width / canvas.clientWidth / view.scale() / 2, dt = Math.max(1, e.timeStamp - s.grab.at) / 1000
    s.phase += turned
    s.velocity = .6 * s.velocity + .4 * turned / dt
    s.lift = s.grab.y - e.clientY
    Object.assign(s.grab, { lastX: e.clientX, at: e.timeStamp })
  })
  canvas.addEventListener('pointerup', release)
  canvas.addEventListener('pointercancel', release)
  canvas.addEventListener('pointerenter', () => s.hovered = true)
  canvas.addEventListener('pointerleave', () => s.hovered = false)
  canvas.addEventListener('focus', () => s.hovered = true)
  canvas.addEventListener('blur', () => { s.hovered = false; release() })
  // Keys: the arrows nudge it as a small fling would; Space or Enter is a tap
  canvas.addEventListener('keydown', e => {
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { e.preventDefault(); s.velocity += e.key === 'ArrowRight' ? 1 : -1 }
    else if ((e.key === ' ' || e.key === 'Enter') && !e.repeat) { e.preventDefault(); press() }
  })
  canvas.addEventListener('keyup', e => { if (e.key === ' ' || e.key === 'Enter') release() })

  // Sound follows the hand's spin only, over what the logo does on its own: hovering alone stays quiet
  function listen() {
    const on = audio && o.sound !== 'none', speed = Math.min(8, s.spin)
    if (on && o.sound === 'tone') {
      s.tone ??= voice()
      s.tone.tone.frequency.setTargetAtTime(55 + 110 * speed, audio.currentTime, .015)
    }
    s.tone?.level.gain.setTargetAtTime(on && o.sound === 'tone' ? .05 * Math.min(1, speed / 1.5) : 0, audio.currentTime, .03)
    const tick = Math.floor(s.phase * 8)
    if (on && o.sound === 'ticks' && tick !== s.tick && (s.dragging || s.spin > .2)) click(Math.floor(s.phase) !== Math.floor(s.tick / 8) ? 'knock' : 'tick')
    s.tick = tick
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
    const motor = active ? hover.speed : calm ? 0 : RESTS[o.rest]
    if (!s.dragging) {
      s.velocity = motor + (s.velocity - motor) * Math.exp(-dt)
      if (Math.abs(motor) < 1e-3 && Math.abs(s.velocity) < .3 && !s.pressed)
        [s.phase, s.velocity] = spring(s.phase, s.velocity, Math.round(s.phase), dt, 40, 1)
      else s.phase += s.velocity * dt
    }
    s.spin = s.dragging ? Math.abs(s.velocity) : Math.abs(s.velocity - motor)
    const lift = s.dragging ? s.lift : 0
    const cycles = (active ? hover.cycles : 1) * (o.lift === 'tension' ? Math.min(6, Math.max(.5, 1 + lift / 40)) : 1)
    const amplitude = o.lift === 'amplitude' ? Math.min(1.8, Math.max(.1, 1 + lift / 60)) : 1
    ;[s.cycles, s.cyclesVelocity] = spring(s.cycles, s.cyclesVelocity, cycles, dt, 120, .3)
    ;[s.amplitude, s.amplitudeVelocity] = spring(s.amplitude, s.amplitudeVelocity, amplitude, dt, 120, .3)
    view.set({ phase: s.phase, cycles: s.cycles, amplitude: s.amplitude, signal: SHAPES[s.taps % SHAPES.length] })
    view.render(now)
    if (audio) listen()
    requestAnimationFrame(frame)
  }
  requestAnimationFrame(frame)

  return { set: changes => Object.assign(o, changes) }
}
