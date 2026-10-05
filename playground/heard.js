// What plays of a sound, as the page asks to hear it: all of it, a band of it [low, high] Hz, its boxes, or a moment of
// it [from, to] s through an edit [type, ...args], a call of the library's (a pitch dragged, heard as it will sound).
// Library calls only, so the page's library and the engine's make the same (player.js, worker.js voice). A sound heard
// as it is comes back itself; any other is a copy
export function heard(a, { from, to, edit, band, boxes } = {}) {
  if (from != null || edit) {
    a = a.clone()
    if (from != null) a = a.crop({ at: from, duration: to - from })
    if (edit) a = a[edit[0]](...edit.slice(1))
  }
  return boxes ? boxed(a, boxes) : band ? banded(a, band) : a
}

// A band of a sound, [low, high] Hz: through 24 dB an octave highpass and lowpass, each open where it would cut nothing
export function banded(a, [low, high]) {
  let b = a.clone()
  if (low > 20) b = b.highpass(low, 4)
  if (high < a.sampleRate * .47) b = b.lowpass(high, 4)
  return b
}
// Boxes of a sound, [a, b, low, high] each: each box's band over its time, where it was, silence around them as long as
// the sound; boxes that meet in time sound together
export function boxed(a, boxes) {
  const band = ([from, to, low, high]) => banded(a.clone().crop({ at: from, duration: to - from }), [low, high])
  const [first, ...rest] = boxes
  let b = band(first).pad(first[0], Math.max(0, a.duration - first[1]))
  for (const box of rest) b = b.mix(band(box), { at: box[0] })
  return b
}
