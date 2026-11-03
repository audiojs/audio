import { HOLD, SLOP } from '../view.js'
import player from '../player.js'
import { mark as drawMark, sways, PACE } from '../../logo/mark.js'
import { levels, cycle, trace } from '../meters.js'
import { docs, docOf, badges } from '../editor.js'
import { root, EMBED, SPEEDS, SHUTTLE } from './config.js'
import { state, eng, v, pl, output } from './context.js'
import { stamp, note } from './format.js'
import { meter, live, chordAt } from './readouts.js'
import { recorder } from './recording.js'
import { working, lend, sourceName } from './run.js'
import { laneIndex } from './tracks.js'

// Playing: each tab's player, Play and its shuttle, the playhead followed, the speed, the loop, A/B against the file,
// the caret scrubbed, and the mark in the bar that moves with what sounds

// Each tab plays on its own, as a browser's tabs do: one left as it plays plays on, heard with the one shown, its speaker
// on its tab muting it (toggleTabMute). `pl`, the shown tab's player (switchTab), each tab's made as it is first shown
export const playerOf = doc => doc.player ??= Object.assign(player({ onend: () => ended(doc) }), { scrubMode: state.scrub })
// the frame that draws the playhead (chase); the file as it opened, level-matched, heard before the edits (toggleAB)
export let ticker = 0, original = null
// the caret is where playback ends, as it is where it pauses; a tab not shown, its speaker goes
function ended(doc) {
  if (doc.player !== pl) return sway()
  state.playing = false; state.speed = pl.rate = 1; v.playhead = null; v.setCursor(pl.time); state.time = stamp(v.cursor); sway()
}
// The mark in the bar, drawn live (logo/mark.js): at rest it holds the logo's pose. Playing or recording, the logo's own
// wave runs through its window 2.5 times a second, a loop the compositor steps through (motion.js loop), so the page's
// thread is the playhead's and the take's alone; scrubbing, one cycle of the moment under the caret, turned by the
// caret's travel (2.5 turns for a second of it). The tab's icon shows the same, in a hidden tab too. Plain: nothing
// fades or blends, and what it shows next it shows at once.
let logoMark
const heard = trace()
// Its cycles across the window follow the pitch it draws, smoothly: one at 100 Hz and below, a cycle and three quarters
// more for each octave up, at most three and a half
const cyclesOf = hz => hz ? Math.min(3.5, Math.max(1, 1 + .75 * Math.log2(hz / 100))) : 1
// Heard RMS to the wave's height: half of it at −48 dBFS and below, all of it at full scale. The mark only says that
// something sounds, so it is never flat; a silence is the faint axis alone, its wave nothing.
const swell = rms => { const loud = 1 + 20 * Math.log10(rms + 1e-9) / 48; return .5 + .5 * (loud > 0 ? Math.min(1, loud) : 0) }
const still = matchMedia('(prefers-reduced-motion: reduce)')
// The caret under a scrub, and the RMS of what it hears there (the 50 ms around it): the output, or a track's lane
let scrubbed = null
const beneath = () => { const w = output && pl.heard(scrubbed), i = w && Math.round(scrubbed * output.sampleRate) - w.from; return w ? Math.max(0, ...levels(w.x, i - 1200, i + 1200).map(l => l.rms)) : 0 }
// while the engine works it turns gently, the same whether a file arrives or an output renders, no smaller or paler
// (the moves themselves, ../logo/mark.js sways; scrubbing, the moment under the caret, as only this page hears it).
// Embedded, the page around it told each, and each turn of a scrub, for a mark of its own to move with it (embed.js)
const tell = EMBED && parent !== window ? message => parent.postMessage({ audio: 'mark', ...message }, '*') : () => {}
let swaying = ''
export function sway() {
  const mode = still.matches ? 'rest' : scrubbed != null && output?.duration ? 'scrub' : recorder && !state.recording?.pending ? 'record' : docs.some(d => d.player?.playing) ? 'play' : working() ? 'work' : 'rest'
  badges()
  if (mode === swaying) return
  swaying = mode
  heard.hz = 0
  logoMark?.set(mode !== 'scrub' ? sways[mode] : { ...sways.scrub, signal: () => { const w = output && pl.heard(scrubbed); if (w) cycle(w.x, scrubbed * output.sampleRate - w.from, output.sampleRate, heard, .5); return heard.wave }, cycles: () => cyclesOf(heard.hz), amplitude: () => swell(beneath()) })
  tell({ mode })
}
// A/B: the original at the same place, level-matched to the output; the next output, or B again, returns to it.
// B, or Play > Hear it before the edits; the word over the picture says which is heard
export async function toggleAB() {
  const name = sourceName()
  if (!state.hasOutput) return
  if (!name) return note('A generated sound has no file as it opened to hear it against.')
  if (state.ab) { state.ab = false; lend(output); return note('Hearing the output, after the edits') }
  const loudness = output.stats.loudness
  if (original?.name !== name || original.loudness !== loudness) {
    const r = await eng.original(name, loudness)
    if (!r.sampleRate) return note(r.error?.message || 'The file as it opened is no longer open.')
    original = { name, loudness, ...r }
  }
  state.ab = true
  state.abGain = original.gain
  pl.out = null
  pl.set(original.channels, original.sampleRate, o => eng.voice({ ...o, source: name, loudness, ...original.channels && { held: { key: `original ${name} ${loudness}`, channels: original.channels, sampleRate: original.sampleRate } } }), original.length)
  note(`Hearing before the edits: the file as it opened, level-matched (${original.gain >= 0 ? '+' : '−'}${Math.abs(original.gain).toFixed(1)}dB). B for after`)
}
export function toggleLoop() { state.loop = !state.loop; pl.loop = state.loop }
// Transport
// What plays: the selection, looped or not, a band of it alone; else all of it, looped or not, from the caret (from the
// start once the caret is at the end)
// what Play plays: several boxes, each its band over its time, from the first to the last; a selection (a band of it),
// from the caret if it is inside it, as where playback paused there; else from the caret on
export const plays = (at = v.cursor) => v.boxes.length > 1 ? { from: v.boxes[0][0], to: Math.max(...v.boxes.map(b => b[1])), loop: state.loop, boxes: v.boxes }
  : v.selection ? { from: v.selection[0], to: v.selection[1], loop: state.loop, band: v.band, start: at > v.selection[0] && at < v.selection[1] ? at : v.selection[0] }
  : { from: 0, loop: state.loop, start: at >= v.duration ? 0 : at }
// A head drawn as it runs, from a clock that comes in steps: the device's as it plays, the samples come as it records.
// Read at the frame's own time, not when its callback runs, which a busy page makes later by a few ms now and then.
// The steps: Chrome's device clock a fraction of a ms off where the last ran on to, Firefox's and Safari's moved by the
// audio callbacks, the microphone's blocks by theirs, standing between. Drawn toward the clock by a time constant, the
// head took each step for a change of speed, a tenth and more faster, then slower, several times a second. So it runs
// on by the frames' own time at the speed, as a video's frames follow its sound, the speed trimmed by its lead on the
// clock over LOCK, never by more than TRIM: a step's few ms trim it by a hundredth, nothing the eye takes for a change
// of speed, and a lead that stays is caught up in about a second. A clock ahead by more than JUMP (a seek, a loop come
// round) is taken at once, as is one gone back (the caret put back); one standing behind by as much (starved) is waited
// for, never run further past, as one not yet moved (the device starting) is.
// follow(clock, frame time, speed) → where the head is drawn; follow.speed, how fast it goes from there (0 standing)
const LOCK = .5, TRIM = .1, JUMP = .05
export function follower() {
  let clock = null, shown = null, then = 0, moved = false
  const follow = (c, now, r) => {
    const heard = c - (performance.now() - now) / 1000 * r
    let t = heard, k = 1
    if (clock != null && c >= clock) {
      const dt = (now - then) / 1000, run = shown + dt * r, lead = heard - run
      k = !moved || lead < -JUMP ? 0 : lead >= JUMP ? 1 : 1 + Math.max(-TRIM, Math.min(TRIM, lead / LOCK))
      t = !moved ? Math.max(shown, heard) : lead >= JUMP ? heard : lead < -JUMP ? shown : run + dt * r * (k - 1)
    }
    moved ||= clock != null && c > clock
    clock = c; shown = t; then = now
    follow.speed = moved ? r * k : 0
    return t
  }
  return follow
}
// Play answers the press, as a transport key does, not the release; a key or a script clicking it (detail 0) still works.
// Held and dragged across, it searches (SHUTTLE): a line over it, the pointer hidden, a tenth of 1× each 4 px from the
// speed it plays at, a step taken only three quarters of the way to the next, so a hand resting between two holds one;
// let go forward, it plays on at that speed, at 0 or back it stops there. Held still for HOLD (within SLOP), as the
// picture's caret is, the line shows, to be seen or dragged. So a press while it plays pauses at its release, unless it
// was dragged or held, the caret where the playhead got to, as a key's pause leaves it.
export function playPress(event) {
  if (event.button !== 0 || state.recording) return
  const button = event.currentTarget, x0 = event.clientX, was = pl.playing, step = SHUTTLE.px / 10
  let moved = false, shown = false, at = state.speed * 10, back = null
  if (!was) togglePlay()
  button.setPointerCapture?.(event.pointerId)
  // the line where it starts, the speed there over Play, within the window
  const show = () => {
    if (shown) return
    shown = true
    const r = button.getBoundingClientRect()
    state.speedAxis = { left: Math.max(8, Math.min(innerWidth - SHUTTLE.span - 36, r.left + r.width / 2 - 14 - SHUTTLE.at(state.speed) * SHUTTLE.span)), top: r.top, span: SHUTTLE.span }
    root.classList.add('shuttling')
  }
  const held = setTimeout(show, HOLD)
  // at 0 and back, the deck stops and the scrub voice hears the moments the line passes, the playhead with them, each
  // frame as far as the speed goes in it; forward again, or let go, the deck plays on from there
  const rewind = () => {
    let then = performance.now(), t = v.playhead ?? pl.time
    const frame = now => {
      t = Math.max(0, Math.min(v.duration, t + state.shuttle * (now - then) / 1000))
      then = now
      onscrub(t)
      v.speed = t > 0 && t < v.duration ? state.shuttle : 0
      v.playhead = t; state.time = stamp(t); state.played = t / (v.duration || 1)
      back.id = requestAnimationFrame(frame)
    }
    back = { id: requestAnimationFrame(frame), at: () => t }
  }
  // the search back stopped: the playhead, its line run back, goes, the caret where it stood (forward again, playing
  // brings the playhead back from there)
  const halt = () => {
    cancelAnimationFrame(back.id)
    const t = back.at()
    back = null
    resume = false
    onscrub(null)
    v.playhead = null
    v.setCursor(t)
  }
  const forward = () => { halt(); togglePlay() }
  const move = e => {
    const dx = e.clientX - x0
    if (!moved && !shown && Math.abs(dx) < SLOP) return
    moved = true
    show()
    const to = Math.max(SHUTTLE.min * 10, Math.min(SHUTTLE.max * 10, state.speed * 10 + dx / step))
    if (Math.abs(to - at) < .75) return
    at = Math.round(to)
    const r = state.shuttle = at / 10
    if (r > 0) { pl.rate = r; if (back) forward() }
    else if (!back) rewind()
  }
  const up = () => {
    for (const [type, f] of on) button.removeEventListener(type, f)
    clearTimeout(held)
    state.speedAxis = null
    root.classList.remove('shuttling')
    if (back) { halt(); state.speed = pl.rate = 1 }
    else if (moved) state.speed = pl.rate
    state.shuttle = null
    if (!shown && was) togglePlay()
  }
  const on = [['pointermove', move], ['pointerup', up], ['pointercancel', up]]
  for (const [type, f] of on) button.addEventListener(type, f)
}
// The speed of this playback, 0.5× to 3×, the pitch kept
export function setSpeed(r) { state.speed = pl.rate = SPEEDS.range(r) }
export function playClick(event) { if (!event.detail) togglePlay() }
// Playing and recording are one or the other: while it records, Play is off (Space stops the recording)
export async function togglePlay() {
  if (!(state.whole || state.arriving) || state.recording) return
  // paused, the caret where the playhead line is, what was last heard: the line becomes it, nothing jumps
  if (pl.playing) {
    const t = v.playhead ?? pl.time
    pl.pause()
    cancelAnimationFrame(ticker)
    state.playing = false
    state.speed = pl.rate = 1
    v.playhead = null
    v.setCursor(t)
    sway()
    return
  }
  state.playing = true
  // The clock follows once the device has started. A band selection plays only its frequencies.
  const p = pl
  await p.play(plays())
  if (p !== pl) return
  if (!pl.playing) { state.playing = false; return }
  sway()
  chase()
}
// The playhead where the speakers are at the frame's own time, drawn as it runs (follow): the shown tab's, till it stops
// or another tab shows
export function chase() {
  cancelAnimationFrame(ticker)
  const follow = follower(), p = pl
  live.text = undefined
  const tick = frame => {
    if (!p.playing || p !== pl) return
    const t = follow(p.time, frame ?? performance.now(), p.rate)
    v.speed = follow.speed
    v.playhead = t; state.time = stamp(t); state.played = t / (v.duration || 1); meter(t); chordAt(t)
    ticker = requestAnimationFrame(tick)
  }
  tick()
}
// A tab's speaker pressed: its playback muted, or heard again, as it plays on
export function toggleTabMute(id) {
  const p = docOf(id)?.player
  if (!p) return
  p.muted = !p.muted
  badges()
}
// Scrubbing: the moment under a held or dragged caret, or an edge, sounds; playback pauses for it and plays on from the
// caret, or the selection, when the pointer lets go.
let resume = false
export function onscrub(t, band) {
  if (t != null) {
    if (pl.playing) { resume = true; cancelAnimationFrame(ticker); state.playing = false; v.playhead = null }
    // the mark turns with the caret's travel
    if (scrubbed != null) logoMark?.turn(PACE * (t - scrubbed)), tell({ turn: PACE * (t - scrubbed) })
    scrubbed = t
    sway()
    // with tracks, the one edited alone, as its lane shows it
    return pl.scrub(t, band, laneIndex())
  }
  scrubbed = null
  pl.scrub(null)
  if (resume) { resume = false; togglePlay() }
  sway()
}

export function wire() {
  logoMark = drawMark(root.querySelector('.bar .wordmark'))
}
