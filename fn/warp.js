/**
 * Warp — move moments in time; the audio between them stretches to fit, pitch kept.
 *
 * a.warp([[2, 2.4]])                  → what played at 2 s plays at 2.4 s: 0–2 s lasts 2.4 s, the rest is shorter
 * a.warp([[1, 1], [2, 2.4], [3, 3]])  → only 1–3 s changes (Logic flex markers, Ableton warp markers)
 *
 * Markers are [from, to] pairs in seconds. The start and the end stay where they are; a marker at the end moves it.
 * Each span between neighbouring markers stretches by Δto / Δfrom with `stretch`'s phase-locked vocoder.
 */
import audio from '../core.js'

audio.op('warp', {
  params: ['markers'],
  expand: ctx => {
    let end = ctx.totalDuration, points = [[0, 0]]
    for (let [from, to] of [...ctx.markers || []].map(m => [+m[0], +m[1]]).sort((a, b) => a[0] - b[0])) {
      if (!(from >= 0 && from <= end + 1e-9) || !Number.isFinite(to)) throw new RangeError(`warp: a marker at ${from} s is outside the audio (0–${end} s)`)
      if (from === 0) { if (to !== 0) throw new RangeError('warp: the start stays at 0 s'); continue }
      let [f0, t0] = points.at(-1)
      if (from === f0 || to <= t0) throw new RangeError('warp: markers keep their order; each lands after the one before it')
      points.push([from, to])
    }
    if (points.at(-1)[0] < end) {
      if (points.at(-1)[1] >= end) throw new RangeError('warp: a marker lands past the end; a marker at the end moves the end')
      points.push([end, end])
    }
    let stretch = audio.op('stretch'), edits = []
    for (let i = 1; i < points.length; i++) {
      let [from, at] = points[i - 1], duration = points[i][0] - from, factor = (points[i][1] - at) / duration
      for (let [type, o] of stretch.expand({ ...ctx, factor, at, duration }) || []) edits.push([type, { at, duration, ...o }])
    }
    return edits.length ? edits : false
  }
})
