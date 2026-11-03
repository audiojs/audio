// The view's model: its measures, its kinds and notes, its pointers. view() is made once a page (editor.js is its one
// caller), so what it holds is the module's

// GAP between lanes is 2 px, as between the pictures and the meters. GUTTER holds the axis labels at most, seven
// characters (a frequency marked zoomed far in, 1.005k); the axis is as wide as the labels it has (axisWidth), five at
// full scale. STICK, how near the pointer takes a cue (held ⌘), and the levels zoomed onto full scale: either side, a
// 10 px reach; ONTO, how near a dragged time goes onto a cue or a marker, 3 px either side, so a drag goes where it is
// put but by what it meets
export const GUTTER = 48, RULER = 22, GAP = 2, EDGE = 6, SNAP = 6, STICK = 5, ONTO = 3, INSET = 3, NOTCH = Math.log(1.5)
// A band: a track's lane, or a sound's lanes all told, GAP px apart, and under it its foot, FOOT px: what is about the
// band but is not its sound, its takes' numbers, a selection's tools, a sound's look, its axis' last label, never over
// the sound; dragged, the band's height (Finder's column edge; with Alt, every band's), nothing drawn for it. A track's
// band its head line over it, HEAD px, where its layer is (editor.js layers: its look, its name, its mute and its
// lock), so a track never reads as a channel
export const HEAD = 20, FOOT = 18
// A track's lane TRACK px tall, a sound's lanes the picture all told, unless its foot is dragged (LOW px at least); more
// than the picture holds scroll up and down through it, as a DAW's tracks do, the room under the last always in reach:
// ROOM px at least (all there is under the last lane, a lane's foot dragged up giving it more). Pointed at, a new
// track's lane there, under tracks where the one made there will be and as tall as the last (editor.js anew), its part
// in sight; its centre line faint; pressed, its caret, which a take, a paste or a file dropped there makes a track of,
// as a layer in Figma is made by drawing, never added empty
export const TRACK = 160, LOW = 32, ROOM = 80
// What a band shows, its look drawn as it: a waveform's bars, a spectrogram's lines, a voice's notes rising
export const KINDS = {
  wave: ['Waveform', 'M4 10v4m4-8v12m4-15v18m4-14v10m4-6v2'],
  spec: ['Spectrogram', 'M4 5h16M4 9.5h10M4 14h13M4 18.5h6'],
  notes: ['Notes', 'M3 16h5m0-5h5m0-4h4m0 7h4']
}
// ⌘ (Ctrl) held while dragging aims finely: the pointer's moves go a quarter as far, and nothing snaps
export const FINE = .25
// A frequency's note, as a tuner says it, and how far off it is in cents, from `cents` off on (Infinity: the nearest
// note alone). Notes of equal temperament, A4 at 440 Hz, MIDI note 69 (ISO 16; MIDI 1.0)
export const NOTES = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B']
export const midiOf = f => 69 + 12 * Math.log2(f / 440)
export const noteOf = (f, cents = 1) => {
  const m = midiOf(f), k = Math.round(m), ct = Math.round((m - k) * 100)
  return `${NOTES[(k % 12 + 12) % 12]}${Math.floor(k / 12) - 1}${Math.abs(ct) >= cents ? `${ct > 0 ? '+' : '−'}${Math.abs(ct)}ct` : ''}`
}
// The pitch curve's bends, as Praat's Manipulation editor shows them (Stylize pitch, 2 st; PitchTier_stylize,
// praat/fon/PitchTier.cpp): of each voiced stretch, the frame that the straight line between its neighbours (in Hz)
// misses by least goes, till the least missed is more than `res` semitones off; a stretch's ends stay. Times, s
export function stylize(times, f0, res = 2) {
  const knots = []
  for (let i = 0; i < f0.length; i++) {
    if (!f0[i]) continue
    let j = i
    while (j + 1 < f0.length && f0[j + 1]) j++
    const run = []
    for (let k = i; k <= j; k++) run.push([times[k], f0[k]])
    for (;;) {
      let best = 0, least = Infinity
      for (let k = 1; k < run.length - 1; k++) {
        const [ta, fa] = run[k - 1], [t, f] = run[k], [tb, fb] = run[k + 1], d = 12 * Math.abs(Math.log2(f / (fa + (fb - fa) / (tb - ta) * (t - ta))))
        if (d < least) { least = d; best = k }
      }
      if (!best || least > res) break
      run.splice(best, 1)
    }
    knots.push(...run.map(([t]) => t))
    i = j
  }
  return knots
}
// The page's one press, wherever it is: held HOLD ms within SLOP px of where it went down, it is held, and opens what
// the press holds, as a touch's long press does, a little sooner than iOS's (0.5 s): on the picture or its time row the
// caret, no selection, the sound under it as it is dragged (iOS's loupe); on Play the speed's line. Moved SLOP px before
// that, it is a drag: a range, a handle, a card, a tab, Play's search. Whatever else holds or drags takes these
export const HOLD = 400, SLOP = 3
// Pointers of their own: a stretch's, its two ends pushed apart, arrows out to bars (the resize arrows are the edges')
const pointer = (path, hx = 12, hy = 12) => `url("data:image/svg+xml,${encodeURIComponent(`<svg xmlns='http://www.w3.org/2000/svg' width='24' height='24' fill='none' stroke-linecap='round' stroke-linejoin='round'><path d='${path}' stroke='white' stroke-width='4'/><path d='${path}' stroke='black' stroke-width='1.5'/></svg>`)}") ${hx} ${hy}`
export const STRETCH = `${pointer('M3 7v10M21 7v10M7 12h10M10 9l-3 3 3 3M14 9l3 3-3 3')}, ew-resize`
// Shift's, the I-beam with a plus on the side the selection goes out to it from; Alt's, with a plus at its foot: another
export const EXTEND = [`${pointer('M6 9v6M3 12h6M13 5h4M15 5v14M13 19h4', 15)}, text`, `${pointer('M18 9v6M15 12h6M7 5h4M9 5v14M7 19h4', 9)}, text`]
export const ADD = `${pointer('M7 5h4M9 5v14M7 19h4M17 13v6M14 16h6', 9)}, copy`
export const mac = /Mac|iP(hone|ad|od)/.test(navigator.platform)
export const LEVELS = [0, -6, -12, -24, -48, -18, -36, -30, -60, -72, 6, 12]  // dBFS the level axis marks, halvings first, where they fit
export const TICK = 12                               // a tick's length on either axis, px
export const VOICE = [60, 1000]                      // a voice's range, Hz: a tune's notes drawn within it where no pitch curve is
export const GAIN = [-36, 12]                        // the gain line's scale, dB: the lane's centre line to its edges, 0 dB
                                              // three quarters of the way out, so a boost shows above it
export const GLIDE = .3                               // a playhead past the view's middle is drawn to it in this time constant, s
