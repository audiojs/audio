/**
 * Cut list: the output as clips of its source file, for a video editor to make the same cuts in the picture.
 *
 * await a.cuts()                        → { fps, clips: [{ at, duration, from, source }] }  seconds
 * await a.cuts('edl')                   → CMX 3600 EDL (Premiere, Resolve, Avid)
 * await a.cuts('fcpxml')                → FCPXML 1.9 (Final Cut Pro, Resolve)
 * await a.cuts('otio')                  → OpenTimelineIO JSON (Resolve, OTIO pipelines)
 * await a.cuts('edl', { fps: 25, title, url })
 *
 * Structural edits make the cuts: trim, crop, remove, cut, shrink, split, pad (a gap), insert of a
 * file (its clip). Processing (EQ, denoise, loudness) doesn't cut. Cuts land on frames: the video
 * track's rate (MP4/MOV), else `fps` (30). A crossfaded splice cuts at its middle. A speed change,
 * reversal or generated audio has no cut list: it throws.
 */
import audio, { LOAD } from '../core.js'
import { buildPlan, loadRefs, sliceSegs } from '../plan.js'

/** Output → source clips in seconds: through baked stages (the same file) and inserted files (theirs, with their edits). */
function flatten(segs, sr, file, fileSr, at = 0, out = []) {
  for (let [from, count, to, rate = 1, ref, , env] of segs) {
    if (ref === null) continue  // silence: a gap in the timeline
    let t = at + to / sr, inner = ref === undefined ? fileSr : ref.segs ? ref.sr : ref.sampleRate
    // a clip keeps time when its read rate only converts sample rates
    if (rate < 0 || Math.abs(rate * sr / inner - 1) > 1e-9) throw new Error('cuts: a speed change or reversal has no cut list')
    if (ref?.segs) flatten(sliceSegs(ref.segs, from, Math.round(count * rate)), inner, file, fileSr, t, out)
    else if (ref?.edits?.length) flatten(sliceSegs(buildPlan(ref).segs, from, Math.round(count * rate)), inner, ref.source, ref._.sr, t, out)
    else {
      let src = ref ? ref.source : file
      if (src == null) throw new Error('cuts: generated audio has no file for a cut list to point at')
      out.push({ at: t, duration: count / sr, from: from / inner, source: src, fade: !!env })
    }
  }
  return out
}

/** Clips in timeline order; crossfaded neighbours (overlapping envelope segments) meet at the middle. */
function arrange(clips) {
  clips.sort((a, b) => a.at - b.at)
  let out = []
  for (let c of clips) {
    let p = out.at(-1), end = p && p.at + p.duration
    if (p && c.at < end - 1e-9) {
      let mid = (c.at + end) / 2
      p.duration = mid - p.at
      c = { ...c, from: c.from + mid - c.at, duration: c.at + c.duration - mid, at: mid }
    }
    // a clip that continues the one before it in the same file (the halves of a split) joins it
    p = out.at(-1)
    if (p && p.source === c.source && Math.abs(p.at + p.duration - c.at) < 1e-6 && Math.abs(p.from + p.duration - c.from) < 1e-6) p.duration += c.duration
    else if (c.duration > 1e-9) out.push({ ...c })
  }
  return out.map(({ fade, ...c }) => c)
}

// ── Video frame rate from ISO-BMFF (MP4/MOV): the video track's mdhd timescale over its dominant stts delta ──

async function reader(src) {
  if (typeof src === 'string' && !/^\w+:\/\//.test(src)) {
    let fh = await (await import('fs/promises')).open(src)
    let size = (await fh.stat()).size
    return { size, read: async (o, n) => { let b = new Uint8Array(Math.min(n, size - o)); await fh.read(b, 0, b.length, o); return b }, close: () => fh.close() }
  }
  let b = src instanceof ArrayBuffer ? new Uint8Array(src) : ArrayBuffer.isView(src) ? new Uint8Array(src.buffer, src.byteOffset, src.byteLength) : null
  if (b) return { size: b.length, read: async (o, n) => b.subarray(o, o + n), close() {} }
  if (typeof Blob !== 'undefined' && src instanceof Blob) return { size: src.size, read: async (o, n) => new Uint8Array(await src.slice(o, o + n).arrayBuffer()), close() {} }
  return null
}

/** Child boxes of [start, end): { type, start (payload), end }. */
async function boxes(r, start, end) {
  let out = []
  for (let o = start; o + 8 <= end;) {
    let h = await r.read(o, 16), v = new DataView(h.buffer, h.byteOffset, h.byteLength)
    let size = v.getUint32(0), type = String.fromCharCode(h[4], h[5], h[6], h[7]), head = 8
    if (size === 1) { size = Number(v.getBigUint64(8)); head = 16 } else if (size === 0) size = end - o
    if (size < head) break
    out.push({ type, start: o + head, end: Math.min(end, o + size) })
    o += size
  }
  return out
}
const child = async (r, box, type) => (await boxes(r, box.start, box.end)).find(b => b.type === type)

export async function videoRate(src) {
  let r = await reader(src)
  if (!r) return null
  try {
    let moov = (await boxes(r, 0, r.size)).find(b => b.type === 'moov')
    if (!moov) return null
    for (let trak of (await boxes(r, moov.start, moov.end)).filter(b => b.type === 'trak')) {
      let mdia = await child(r, trak, 'mdia'), hdlr = mdia && await child(r, mdia, 'hdlr')
      if (!hdlr || String.fromCharCode(...await r.read(hdlr.start + 8, 4)) !== 'vide') continue
      // tkhd ends with width and height, 16.16 fixed point
      let tkhd = await child(r, trak, 'tkhd'), wh = await r.read(tkhd.end - 8, 8), whv = new DataView(wh.buffer, wh.byteOffset, 8)
      let mdhd = await child(r, mdia, 'mdhd'), m = await r.read(mdhd.start, 32), mv = new DataView(m.buffer, m.byteOffset, m.byteLength)
      let timescale = mv.getUint32(m[0] === 1 ? 20 : 12)
      let stbl = await child(r, await child(r, mdia, 'minf'), 'stbl'), stts = await child(r, stbl, 'stts')
      let t = await r.read(stts.start, stts.end - stts.start), tv = new DataView(t.buffer, t.byteOffset, t.byteLength)
      let best = null
      for (let i = 0, n = tv.getUint32(4); i < n; i++) {
        let count = tv.getUint32(8 + i * 8), delta = tv.getUint32(12 + i * 8)
        if (delta && (!best || count > best.count)) best = { count, delta }
      }
      return best && { timescale, delta: best.delta, width: whv.getUint32(0) >>> 16, height: whv.getUint32(4) >>> 16 }
    }
    return null
  } finally { await r.close() }
}

// ── Formats ────────────────────────────────────────────────────────────────

const base = s => String(s ?? 'audio').split(/[\\/]/).pop().split(/[?#]/)[0]
const xml = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
async function fileUrl(src) {
  if (typeof src !== 'string') return base(src)
  if (/^\w+:\/\//.test(src)) return src
  let { pathToFileURL } = await import('url')
  return pathToFileURL((await import('path')).resolve(src)).href
}

/** Frame-snapped events: source in/out and record in/out in frames, record contiguous where the clips are. */
function events(clips, rate) {
  let out = [], prev = null
  for (let c of clips) {
    let sIn = Math.round(c.from * rate), sOut = Math.round((c.from + c.duration) * rate)
    if (sOut <= sIn) continue
    let rIn = prev && Math.abs(c.at - prev.end) < 1e-6 ? prev.rOut : Math.round(c.at * rate)
    let e = { source: c.source, sIn, sOut, rIn, rOut: rIn + sOut - sIn, end: c.at + c.duration }
    out.push(prev = e)
  }
  return out
}

function tc(frames, fps) {
  let f = frames % fps, s = Math.floor(frames / fps), p = n => String(n).padStart(2, '0')
  return `${p(Math.floor(s / 3600))}:${p(Math.floor(s / 60) % 60)}:${p(s % 60)}:${p(f)}`
}

/** A frame rate as timescale/delta: whole rates whole, the NTSC ones (29.97…) exactly ×1000/1001. */
function rational(fps) {
  let n = Math.round(fps)
  if (Math.abs(fps - n) < 1e-6) return { timescale: n, delta: 1 }
  if (Math.abs(fps - n * 1000 / 1001) < 0.005) return { timescale: n * 1000, delta: 1001 }
  return { timescale: Math.round(fps * 1000), delta: 1000 }
}

// SMPTE ST 12-1 timecode rates (with the NTSC ×1000/1001 ones)
const SMPTE = [24000 / 1001, 24, 25, 30000 / 1001, 30, 48000 / 1001, 48, 50, 60000 / 1001, 60]

const FORMATS = {
  // CMX 3600: reel AX (a file, not a tape) named by FROM CLIP NAME; non-drop timecode counted at the nominal rate
  edl({ events, rate, title, video }) {
    if (!SMPTE.some(r => Math.abs(r - rate) < 0.01)) throw new RangeError(`cuts: EDL timecode runs at 23.976 to 60 fps (SMPTE ST 12-1), not ${+rate.toFixed(3)}: use fcpxml or otio, or set fps`)
    let fps = Math.round(rate), track = video ? 'AA/V' : 'AA', lines = [`TITLE: ${title}`, 'FCM: NON-DROP FRAME', '']
    events.forEach((e, i) => lines.push(
      `${String(i + 1).padStart(3, '0')}  AX       ${track.padEnd(5)} C        ${tc(e.sIn, fps)} ${tc(e.sOut, fps)} ${tc(e.rIn, fps)} ${tc(e.rOut, fps)}`,
      `* FROM CLIP NAME: ${base(e.source)}`, ''))
    return lines.join('\n')
  },
  // OpenTimelineIO: a video and an audio track of the same clips, gaps where the timeline is silent
  otio({ events, rate, title, urls, video }) {
    let rt = v => ({ OTIO_SCHEMA: 'RationalTime.1', rate, value: v })
    let range = (s, d) => ({ OTIO_SCHEMA: 'TimeRange.1', duration: rt(d), start_time: rt(s) })
    let item = { metadata: {}, effects: [], markers: [], enabled: true }
    let track = kind => {
      let children = [], at = 0
      for (let e of events) {
        if (e.rIn > at) children.push({ OTIO_SCHEMA: 'Gap.1', ...item, name: '', source_range: range(0, e.rIn - at) })
        children.push({ OTIO_SCHEMA: 'Clip.1', ...item, name: base(e.source), source_range: range(e.sIn, e.sOut - e.sIn),
          media_reference: { OTIO_SCHEMA: 'ExternalReference.1', metadata: {}, name: '', available_range: null, available_image_bounds: null, target_url: urls.get(e.source) } })
        at = e.rOut
      }
      return { OTIO_SCHEMA: 'Track.1', ...item, name: kind[0] + '1', source_range: null, kind, children }
    }
    return JSON.stringify({ OTIO_SCHEMA: 'Timeline.1', metadata: {}, name: title, global_start_time: null,
      tracks: { OTIO_SCHEMA: 'Stack.1', ...item, name: 'tracks', source_range: null, children: [...video ? [track('Video')] : [], track('Audio')] } }, null, 2)
  },
  // FCPXML 1.9: one asset per file, the spine its clips (gaps between), times in frames of the frame duration
  fcpxml({ events, rate, frame, title, urls, video, sampleRate, channels }) {
    let t = n => `${n * frame.delta}/${frame.timescale}s`
    let files = [...new Set(events.map(e => e.source))], ids = new Map(files.map((f, i) => [f, `r${i + 2}`]))
    let assets = files.map(f => `    <asset id="${ids.get(f)}" name="${xml(base(f))}" start="0s" hasVideo="${video ? 1 : 0}" hasAudio="1" format="r1" audioSources="1" audioChannels="${channels}" audioRate="${sampleRate}">\n      <media-rep kind="original-media" src="${xml(urls.get(f))}"/>\n    </asset>`)
    let spine = [], at = 0
    for (let e of events) {
      if (e.rIn > at) spine.push(`            <gap name="Gap" offset="${t(at)}" start="0s" duration="${t(e.rIn - at)}"/>`)
      spine.push(`            <asset-clip ref="${ids.get(e.source)}" offset="${t(e.rIn)}" name="${xml(base(e.source))}" start="${t(e.sIn)}" duration="${t(e.sOut - e.sIn)}" tcFormat="NDF"/>`)
      at = e.rOut
    }
    return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE fcpxml>
<fcpxml version="1.9">
  <resources>
    <format id="r1" frameDuration="${t(1)}"${frame.width ? ` width="${frame.width}" height="${frame.height}"` : ''}/>
${assets.join('\n')}
  </resources>
  <library>
    <event name="${xml(title)}">
      <project name="${xml(title)}">
        <sequence format="r1" duration="${t(at)}" tcStart="0s" tcFormat="NDF" audioLayout="${channels > 1 ? 'stereo' : 'mono'}" audioRate="${+(sampleRate / 1000).toFixed(1)}k">
          <spine>
${spine.join('\n')}
          </spine>
        </sequence>
      </project>
    </event>
  </library>
</fcpxml>
`
  },
}
export const formats = Object.keys(FORMATS)

audio.fn.cuts = async function(format, opts = {}) {
  if (format && typeof format === 'object') opts = format, format = null
  if (format && !FORMATS[format]) throw new RangeError(`cuts: unknown format '${format}' (${formats.join(', ')})`)
  await this[LOAD]()
  if (!this.decoded && this.ready) await this.ready
  await loadRefs(this)
  let plan = buildPlan(this), clips = arrange(flatten(plan.segs, plan.sr, this.source, this._.sr))
  let rate = await videoRate(this.source).catch(() => null)
  let frame = opts.fps ? rational(opts.fps) : rate ?? { timescale: 30, delta: 1 }
  let fps = frame.timescale / frame.delta
  if (!format) return { fps, clips }
  let urls = new Map()
  for (let c of clips) if (!urls.has(c.source)) urls.set(c.source, c.source === this.source && opts.url || await fileUrl(c.source))
  let name = base(this.source ?? 'audio')
  return FORMATS[format]({ events: events(clips, fps), rate: fps, frame, title: opts.title ?? `${name.replace(/\.\w+$/, '')} cuts`, urls, video: !!rate, sampleRate: this._.sr, channels: this._.ch })
}
