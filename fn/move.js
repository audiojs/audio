import { seg, sliceSegs, fadeSegs, planOffset, planLen } from '../plan.js'
import { xfadeLen } from './remove.js'
import { parseTime } from '../core.js'

/** Move [off, off + n) to `to`, over what is there, as a clip slides in a DAW's slip mode: silence where it was, what it
 *  lands on replaced, what runs past the end extending it. With a crossfade of `x` samples each of its edges, where it
 *  was and where it lands, is an equal-power crossfade centered on the edge, as remove()'s splice: the side going runs
 *  on into the other while it fades out (the range's own audio past its ends is its handle), the side coming in starts
 *  early while it fades in. A crossfade shrinks to fit at the file's edges and within the range. */
export function moveSegs(segs, off, n, to, x = 0) {
  let total = planLen(segs), end = Math.max(total, to + n), h = x >> 1
  // [a, a + len) of a timeline, rebased, faded from phase p0 to p1 (1 → 0 out, 0 → 1 in), placed at `at`
  let part = (list, a, len, at, p0, p1) => len > 0 ? (p0 == null ? sliceSegs(list, a, len) : fadeSegs(sliceSegs(list, a, len), len, p0, p1)).map(s => (s[2] += at, s)) : []
  let silence = (at, len) => len > 0 ? [seg(0, len, at, undefined, null)] : []
  // where it was: silence, faded into and out of, padded out to where it lands
  let h1 = Math.min(h, off, n >> 1), h2 = Math.min(h, total - off - n, n >> 1)
  let base = [...part(segs, 0, off - h1, 0), ...part(segs, off - h1, 2 * h1, off - h1, 1, 0), ...silence(off + h1, n - h1 - h2),
    ...part(segs, off + n - h2, 2 * h2, off + n - h2, 0, 1), ...part(segs, off + n + h2, total - off - n - h2, off + n + h2), ...silence(total, end - total)]
  // where it lands: over what is there, its handles (the audio either side of where it was) under its crossfades
  let g1 = Math.min(h, off, to, n >> 1), g2 = Math.min(h, total - off - n, end - to - n, n >> 1)
  return [...part(base, 0, to - g1, 0), ...part(base, to - g1, 2 * g1, to - g1, 1, 0),
    ...part(segs, off - g1, 2 * g1, to - g1, 0, 1), ...part(segs, off + g1, n - g1 - g2, to + g1), ...part(segs, off + n - g2, 2 * g2, to + n - g2, 1, 0),
    ...part(base, to + n - g2, 2 * g2, to + n - g2, 0, 1), ...part(base, to + n + g2, end - to - n - g2, to + n + g2)].sort((p, q) => p[2] - q[2])
}

const movePlan = (segs, ctx) => {
  let { total, sampleRate: sr } = ctx, off = planOffset(ctx.offset, total), n = Math.max(0, Math.min(ctx.length ?? total - off, total - off))
  let to = Math.max(0, Math.round((parseTime(ctx.to) || 0) * sr))
  return n && to !== off ? moveSegs(segs, off, n, to, xfadeLen(ctx)) : segs
}

import audio from '../core.js'
audio.op('move', { params: ['at', 'duration', 'to', 'crossfade'], plan: movePlan })
