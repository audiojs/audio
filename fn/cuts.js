/**
 * Cut list: the output as clips of its source files, for a video editor to make the same cuts in the picture.
 *
 * await a.cuts()                        → { fps, clips: [{ at, duration, from, rate, source }] }  seconds
 * await a.cuts('edl')                   → CMX 3600 EDL (Premiere, Resolve, Avid)
 * await a.cuts('fcpxml')                → FCPXML 1.9 (Final Cut Pro, Resolve)
 * await a.cuts('otio')                  → OpenTimelineIO JSON (Resolve, OTIO pipelines)
 * await a.cuts('edl', { fps: 29.97, dropFrame: true, title, url })
 * await a.save('talk.edl'), a.encode('otio')   → the same text, written or as UTF-8 bytes (fn/save.js)
 *
 * What goes where makes the list: trim, crop, remove, cut, paste, move, shrink, split; pad and inserted silence
 * (gaps); an inserted file (its own clip); speed, stretch and warp (a clip's rate, source seconds per output second,
 * negative reversed). Processing moves nothing, so the list leaves it out (EQ, denoise, loudness, fades): to keep what
 * it does, lay the processed audio under the picture. A crossfaded splice cuts at its middle. Cuts land on frames: the
 * video track's rate (MP4/MOV), else `fps` (30). A file's own timecode (a QuickTime tmcd track) starts its source times.
 */
import audio, { LOAD } from '../core.js'
import { buildPlan, loadRefs } from '../plan.js'

const one = r => Math.abs(r - 1) < 1e-9 ? 1 : r

/** Output → source clips in seconds: { at, duration, from (the source time heard at `at`), rate, source, inst }. A
 *  segment reads a file's samples, or a timeline it maps through: a stage baked from this one, the timeline a
 *  whole-render op rendered in place (plan.js), an inserted instance's edits. Silence, and audio with no file to point
 *  at, are gaps; crossfade sides overlap. A nested timeline's clips are flattened once and windowed per segment. */
function flatten(segs, sr, inst, cx, out = []) {
  for (let [from, count, to, rate = 1, ref] of segs) {
    if (ref === null) continue
    let tl = null, owner = inst
    if (ref?.segs) tl = ref
    else if (ref?._.timeline) tl = ref._.timeline
    else if (ref) { owner = ref; if (ref.edits.length) tl = buildPlan(ref) }
    let inner = tl ? tl.sr : owner._.sr, r = one(rate * sr / inner)
    let at = to / sr, d = count / sr, lo = from / inner, hi = lo + d * Math.abs(r)
    if (!tl) {
      let source = cx.fileOf(owner)
      if (source != null) out.push({ at, duration: d, from: r < 0 ? hi : lo, rate: r, source, inst: owner })
      continue
    }
    let sub = cx.memo.get(tl)
    if (!sub) {
      sub = flatten(tl.segs, tl.sr, owner, cx).sort((p, q) => p.at - q.at)
      let m = -Infinity
      sub.ends = sub.map(c => m = Math.max(m, c.at + c.duration))
      cx.memo.set(tl, sub)
    }
    // the clips under [lo, hi), mapped here: inner time τ = τ0 + (t − at)·r, τ0 where the read enters (its end, reversed)
    let t0 = r > 0 ? lo : hi, i = 0, j = sub.length
    while (i < j) { let k = (i + j) >> 1; if (sub.ends[k] > lo) j = k; else i = k + 1 }
    for (; i < sub.length && sub[i].at < hi; i++) {
      let c = sub[i], a = Math.max(lo, c.at), b = Math.min(hi, c.at + c.duration), e = r > 0 ? a : b
      if (b - a > 1e-9) out.push({ ...c, at: at + (e - t0) / r, duration: (b - a) / Math.abs(r), from: c.from + (e - c.at) * c.rate, rate: one(c.rate * r) })
    }
  }
  return out
}

/** Does c run on from p: the same file at the same rate, the source time continuing where p ends? */
const runsOn = (p, c) => p.source === c.source && p.rate === c.rate && Math.abs(p.at + p.duration - c.at) < 1e-6 && Math.abs(p.from + p.duration * p.rate - c.from) < 1e-6

/** Clips in timeline order, one per run of a file. The pieces a run was cut into (a crossfade's fading part and the
 *  body after it, the halves of a split) join first; then crossfaded runs, overlapping, meet at the middle of their
 *  overlap (one inside another leaves it whole). */
function arrange(clips) {
  clips.sort((a, b) => a.at - b.at)
  let runs = [], ends = new Map(), key = t => Math.round(t * 1e6)
  for (let c of clips) {
    let k = key(c.at), r = null
    for (let j = k - 1; j <= k + 1 && !r; j++) {
      let list = ends.get(j), i = list ? list.findIndex(p => runsOn(p, c)) : -1
      if (i >= 0) r = list.splice(i, 1)[0]
    }
    if (r) r.duration += c.duration
    else runs.push(r = { ...c })
    let e = key(r.at + r.duration)
    ends.has(e) ? ends.get(e).push(r) : ends.set(e, [r])
  }
  let out = []
  for (let c of runs) {
    let p = out.at(-1), end = p && p.at + p.duration
    if (p && c.at < end - 1e-9) {
      if (c.at + c.duration <= end + 1e-9) continue
      let mid = (c.at + end) / 2
      p.duration = mid - p.at
      c = { ...c, from: c.from + (mid - c.at) * c.rate, duration: c.at + c.duration - mid, at: mid }
    }
    if (p && runsOn(p, c)) p.duration += c.duration
    else if (c.duration > 1e-9) out.push(c)
  }
  return out
}

// ── The picture of an ISO-BMFF file (MP4/MOV): frame rate, size and frames of its video track, its start timecode ──

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

const view = b => new DataView(b.buffer, b.byteOffset, b.byteLength)

/** { timescale, delta, width, height, frames, start, drop }: the video track's mdhd timescale over its dominant stts
 *  delta (ISO/IEC 14496-12 §8.4.2, §8.6.1.2), tkhd width/height in 16.16 (§8.3.2), its frames (the stts counts), and
 *  where its timecode starts, seconds (0 without a tmcd track) and whether it counts drop-frame. Null without video. */
export async function videoInfo(src) {
  let r = await reader(src)
  if (!r) return null
  try {
    let moov = (await boxes(r, 0, r.size)).find(b => b.type === 'moov')
    if (!moov) return null
    let video = null, tc = null
    for (let trak of (await boxes(r, moov.start, moov.end)).filter(b => b.type === 'trak')) {
      let mdia = await child(r, trak, 'mdia'), hdlr = mdia && await child(r, mdia, 'hdlr')
      let kind = hdlr && String.fromCharCode(...await r.read(hdlr.start + 8, 4))
      if (kind !== 'vide' && kind !== 'tmcd' || kind === 'vide' && video) continue
      let stbl = await child(r, await child(r, mdia, 'minf'), 'stbl')
      if (kind === 'tmcd') { tc ??= await timecode0(r, stbl); continue }
      let tkhd = await child(r, trak, 'tkhd'), whv = view(await r.read(tkhd.end - 8, 8))
      let mdhd = await child(r, mdia, 'mdhd'), m = await r.read(mdhd.start, 32)
      let timescale = view(m).getUint32(m[0] === 1 ? 20 : 12), stts = await child(r, stbl, 'stts')
      let tv = view(await r.read(stts.start, stts.end - stts.start)), best = null, frames = 0
      for (let i = 0, n = tv.getUint32(4); i < n; i++) {
        let count = tv.getUint32(8 + i * 8), delta = tv.getUint32(12 + i * 8)
        frames += count
        if (delta && (!best || count > best.count)) best = { count, delta }
      }
      if (best) video = { timescale, delta: best.delta, width: whv.getUint32(0) >>> 16, height: whv.getUint32(4) >>> 16, frames }
    }
    return video && { ...video, start: tc?.start ?? 0, drop: !!tc?.drop }
  } finally { await r.close() }
}

/** A QuickTime timecode track's start (Apple, QuickTime File Format › Timecode media): its 'tmcd' sample description
 *  holds flags (0x1 drop frame), a time scale and a frame duration; its first sample, a 32-bit frame number, is the
 *  timecode of the first frame. Seconds: that number of frames at the description's rate. */
async function timecode0(r, stbl) {
  let stsd = await child(r, stbl, 'stsd'), d = stsd && await r.read(stsd.start, 40)
  if (!d || d.length < 40 || String.fromCharCode(d[12], d[13], d[14], d[15]) !== 'tmcd') return null
  let flags = view(d).getUint32(28), scale = view(d).getUint32(32), duration = view(d).getUint32(36)
  let co = await child(r, stbl, 'stco') ?? await child(r, stbl, 'co64'), c = co && view(await r.read(co.start, 16))
  if (!c || !scale || c.getUint32(4) < 1) return null
  let at = co.type === 'stco' ? c.getUint32(8) : Number(c.getBigUint64(8)), s = await r.read(at, 4)
  return s.length === 4 ? { start: view(s).getUint32(0) * duration / scale, drop: !!(flags & 1) } : null
}

// ── Frames ─────────────────────────────────────────────────────────────────

/** Clips on frames: { source, rate, rIn, rOut, sIn, sOut }, the source range ascending (a reversed clip plays it from
 *  its end). Each boundary goes to the frame nearest it, once: neighbours stay contiguous, and no error adds up however
 *  many cuts there are. The source starts at the frame nearest what is heard at the record in, so picture and sound
 *  keep within half a frame, and runs the record's frames times the rate, inside the file. A clip under half a frame
 *  goes to its neighbours; a cut that moves the source by under half a frame (shrink's shortest) is no cut. */
function events(clips, fps, files) {
  let out = []
  // halfway between two frames, the one nearer the clip's own start: a clip whose head wasn't cut keeps its first frame
  let nearest = (x, own) => Math.abs(x - Math.floor(x) - 0.5) < 1e-6 ? own < x ? Math.floor(x) : Math.ceil(x) : Math.round(x)
  clips.forEach((c, i) => {
    let end = c.at + c.duration, next = clips[i + 1]
    let rIn = Math.round(c.at * fps), rOut = Math.round((next && Math.abs(next.at - end) < 1e-6 ? next.at : end) * fps)
    if (rOut <= rIn) return
    let m = Math.max(1, Math.round((rOut - rIn) * Math.abs(c.rate))), entry = nearest((c.from + (rIn / fps - c.at) * c.rate) * fps, c.from * fps)
    let sIn = Math.max(0, Math.min(c.rate < 0 ? entry - m : entry, files.get(c.source).frames - m))
    let e = { source: c.source, rate: c.rate, rIn, rOut, sIn, sOut: sIn + m }, p = out.at(-1)
    if (p && p.source === e.source && p.rate === e.rate && p.rOut === rIn && (e.rate > 0 ? p.sOut === e.sIn : p.sIn === e.sOut))
      Object.assign(p, { rOut, sIn: Math.min(p.sIn, e.sIn), sOut: Math.max(p.sOut, e.sOut) })
    else out.push(e)
  })
  return out
}

/** Frames as SMPTE timecode, counted at the nominal rate (29.97 counts 30 a second). Drop-frame (SMPTE ST 12-1, at
 *  29.97 and 59.94) skips the first 2 frame numbers (4 at 59.94) of each minute but every tenth, so the count keeps to
 *  the clock: 1800 frames are 00:01:00;02, 17982 are 00:10:00;00, 107892 are 01:00:00;00. A semicolon before the frames
 *  marks it (CMX 3600 M2 field 6; Avid EDL Manager, table 2-2). */
export function timecode(frames, fps, drop = false) {
  let n = Math.round(fps), p = v => String(v).padStart(2, '0')
  if (drop) {
    let d = n / 15, minute = n * 60 - d, ten = minute * 10 + d, k = frames % ten
    frames += 9 * d * Math.floor(frames / ten) + (k > d ? d * Math.floor((k - d) / minute) : 0)
  }
  let s = Math.floor(frames / n)
  return `${p(Math.floor(s / 3600))}:${p(Math.floor(s / 60) % 60)}:${p(s % 60)}${drop ? ';' : ':'}${p(frames % n)}`
}

/** A frame rate as timescale/delta: whole rates whole, the NTSC ones (29.97…) exactly ×1000/1001. */
function rational(fps) {
  let n = Math.round(fps)
  if (Math.abs(fps - n) < 1e-6) return { timescale: n, delta: 1 }
  if (Math.abs(fps - n * 1000 / 1001) < 0.005) return { timescale: n * 1000, delta: 1001 }
  return { timescale: Math.round(fps * 1000), delta: 1000 }
}

// SMPTE ST 12-1 timecode rates (with the NTSC ×1000/1001 ones); drop-frame counts only NTSC's 30 and 60
const SMPTE = [24000 / 1001, 24, 25, 30000 / 1001, 30, 48000 / 1001, 48, 50, 60000 / 1001, 60]
const DROP = [30000 / 1001, 60000 / 1001]
const dropRate = fps => DROP.some(r => Math.abs(r - fps) < 1e-6)

// ── Formats ────────────────────────────────────────────────────────────────

/** A file's name: the last part of its path or URL (a URL's unescaped), without query or fragment. */
function nameOf(src) {
  let n = String(src).split(/[\\/]/).pop().split(/[?#]/)[0]
  try { return /^\w+:\/\//.test(src) ? decodeURIComponent(n) : n } catch { return n }
}
async function fileUrl(src) {
  if (/^\w+:\/\//.test(src)) return src
  try { let { pathToFileURL } = await import('url'); return pathToFileURL((await import('path')).resolve(src)).href }
  catch { return src }  // no file system (a browser): the path as given
}
const xml = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const oneLine = s => String(s).replace(/\s+/g, ' ').trim()
const gcd = (a, b) => b ? gcd(b, a % b) : a
/** Rational seconds as FCPXML writes them: "1001/30000s", "2s", "0s". */
const seconds = (num, den) => { let g = gcd(num, den) || 1; return den / g === 1 ? `${num / g}s` : `${num / g}/${den / g}s` }
// CMX 3600 field 3, what an event takes from its source: A audio 1, AA audio 1 and 2, B audio 1 and video, AA/V all three
const channel = f => f.video ? f.channels > 1 ? 'AA/V' : 'B' : f.channels > 1 ? 'AA' : 'A'
// FCPXMLv1_9.dtd's audioHz: the sequence rates FCPXML takes
const HZ = { 32000: '32k', 44100: '44.1k', 48000: '48k', 88200: '88.2k', 96000: '96k', 176400: '176.4k', 192000: '192k' }

const FORMATS = {
  // CMX 3600 (CMX Systems 907567): TITLE (70 characters) and FCM, then a statement per event: its number (1 to 999;
  // past that the numbers widen, as Avid's longer lists do), reel AX (an auxiliary source: a file, not a tape) named by
  // its FROM CLIP NAME comment (Premiere, Resolve, Avid), channels, C (a cut), source in and out (the range used,
  // ascending), record in and out. A rate is an M2 motion memory line: reel, speed in frames per second to a tenth
  // (negative: reversed), the event's source in (Avid; Premiere's reverse, as pycmx's samples have it). Markers are Avid
  // locators, `* LOC: <record timecode> <colour> <text>`, after the event they fall in (OpenTimelineIO reads them too).
  edl({ events, fps, drop, title, files, markers }) {
    if (!SMPTE.some(r => Math.abs(r - fps) < 0.01)) throw new RangeError(`cuts: EDL timecode runs at 23.976 to 60 fps (SMPTE ST 12-1), not ${+fps.toFixed(3)}: use fcpxml or otio, or set fps`)
    let n = Math.round(fps), tc = f => timecode(f, fps, drop), k = 0
    let lines = [`TITLE: ${oneLine(title).slice(0, 70)}`, `FCM: ${drop ? 'DROP FRAME' : 'NON-DROP FRAME'}`, '']
    events.forEach((e, i) => {
      let f = files.get(e.source), till = events[i + 1]?.rIn ?? Infinity
      lines.push(`${String(i + 1).padStart(3, '0')}  AX       ${channel(f).padEnd(5)} C        ${tc(f.start + e.sIn)} ${tc(f.start + e.sOut)} ${tc(e.rIn)} ${tc(e.rOut)}`)
      if (e.rate !== 1) lines.push(`M2   ${'AX'.padEnd(8)}       ${(e.rate < 0 ? '-' : '') + Math.abs(e.rate * n).toFixed(1).padStart(5, '0')}                ${tc(f.start + e.sIn)}`)
      lines.push(`* FROM CLIP NAME: ${f.name}`)
      // a marker in a gap goes with the event before it: a locator carries its own timecode
      for (; k < markers.length && markers[k].at < till; k++) lines.push(`* LOC: ${tc(markers[k].at)} ${'RED'.padEnd(7)} ${oneLine(markers[k].label)}`.trimEnd())
      lines.push('')
    })
    return lines.join('\n')
  },
  // OpenTimelineIO (ASWF), its JSON as opentimelineio 0.18 writes it: a Timeline of a Stack of tracks, a video track
  // when a file has a picture and an audio track, each its Clips (an ExternalReference to the file) and Gaps tiling the
  // output. A clip's source_range starts where it reads and lasts as long as it lasts on the track; a LinearTimeWarp's
  // time_scalar sets how fast it reads (it "does not affect the duration of the item this effect is attached to",
  // OTIO's time_scalar docs). The markers are the timeline's: on the Stack.
  otio({ events, fps, title, files, markers, total }) {
    let rt = v => ({ OTIO_SCHEMA: 'RationalTime.1', rate: fps, value: v })
    let range = (s, d) => ({ OTIO_SCHEMA: 'TimeRange.1', duration: rt(d), start_time: rt(s) })
    let item = (schema, name, source_range) => ({ OTIO_SCHEMA: schema, metadata: {}, name, source_range, effects: [], markers: [], enabled: true, color: null })
    let track = (kind, takes) => {
      let children = [], at = 0, gap = n => n > 0 && children.push(item('Gap.1', '', range(0, n)))
      for (let e of events) {
        let f = files.get(e.source)
        if (!takes(f)) continue
        gap(e.rIn - at)
        children.push({ ...item('Clip.2', f.name, range(f.start + e.sIn, e.rOut - e.rIn)),
          ...e.rate !== 1 && { effects: [{ OTIO_SCHEMA: 'LinearTimeWarp.1', metadata: {}, name: '', effect_name: 'LinearTimeWarp', enabled: true, time_scalar: e.rate }] },
          media_references: { DEFAULT_MEDIA: { OTIO_SCHEMA: 'ExternalReference.1', metadata: {}, name: '', available_range: range(f.start, f.frames), available_image_bounds: null, target_url: f.url } },
          active_media_reference_key: 'DEFAULT_MEDIA' })
        at = e.rOut
      }
      gap(total - at)
      return { ...item('Track.1', kind[0] + '1', null), children, kind }
    }
    let marks = markers.map(m => ({ OTIO_SCHEMA: 'Marker.2', metadata: {}, name: m.label, color: 'RED', marked_range: range(m.at, m.duration), comment: '' }))
    let video = [...files.values()].some(f => f.video)
    return JSON.stringify({ OTIO_SCHEMA: 'Timeline.1', metadata: {}, name: title, global_start_time: null,
      tracks: { ...item('Stack.1', 'tracks', null), markers: marks, children: [...video ? [track('Video', f => f.video)] : [], track('Audio', () => true)] } }, null, 2)
  },
  // FCPXML 1.9 (Apple, FCPXMLv1_9.dtd: the first with media-rep, read by Final Cut Pro 10.5 on and Resolve): a format
  // of the frame duration, an asset per file (its start: the file's timecode), a project whose spine tiles the output
  // with asset-clips and gaps, every time a whole number of frames as a rational ("1001/30000s"). A rate is a timeMap:
  // timept time is the clip's own, retimed time, value the file's, linear between. A marker goes in the clip or gap it
  // falls in, at that item's own time.
  fcpxml({ events, frame, drop, title, files, markers, total, sampleRate, channels }) {
    let t = n => seconds(n * frame.delta, frame.timescale), id = new Map([...files.keys()].map((s, i) => [s, `r${i + 2}`]))
    let picture = [...files.values()].find(f => f.video)?.video, fmt = drop ? 'DF' : 'NDF'
    let assets = [...files].map(([s, f]) => `    <asset id="${id.get(s)}" name="${xml(f.name)}" start="${t(f.start)}" hasVideo="${f.video ? 1 : 0}" hasAudio="1"${f.video ? ' format="r1"' : ''} audioSources="1" audioChannels="${f.channels}" audioRate="${f.sampleRate}">\n      <media-rep kind="original-media" src="${xml(f.url)}"/>\n    </asset>`)
    let items = [], at = 0
    let gap = n => { if (n > 0) items.push({ at, n, start: 0, open: `gap name="Gap" offset="${t(at)}" start="0s" duration="${t(n)}"`, tag: 'gap', body: [] }); at += Math.max(0, n) }
    for (let e of events) {
      gap(e.rIn - at)
      let f = files.get(e.source), s = f.start + e.sIn, n = e.rOut - e.rIn, [v0, v1] = e.rate > 0 ? [e.sIn, e.sOut] : [e.sOut, e.sIn]
      items.push({ at, n, start: s, tag: 'asset-clip', open: `asset-clip ref="${id.get(e.source)}" offset="${t(at)}" name="${xml(f.name)}" start="${t(s)}" duration="${t(n)}" tcFormat="${fmt}"`,
        body: e.rate === 1 ? [] : ['<timeMap>', `  <timept time="${t(s)}" value="${t(f.start + v0)}" interp="linear"/>`, `  <timept time="${t(s + n)}" value="${t(f.start + v1)}" interp="linear"/>`, '</timeMap>'] })
      at += n
    }
    gap(total - at)
    let k = 0, spine = []
    for (let it of items) {
      for (; k < markers.length && markers[k].at < it.at + it.n; k++)
        it.body.push(`<marker start="${t(it.start + markers[k].at - it.at)}" duration="${t(Math.max(1, markers[k].duration))}" value="${xml(oneLine(markers[k].label))}"/>`)
      spine.push(...it.body.length ? [`<${it.open}>`, ...it.body.map(b => '  ' + b), `</${it.tag}>`] : [`<${it.open}/>`])
    }
    return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE fcpxml>
<fcpxml version="1.9">
  <resources>
    <format id="r1" frameDuration="${t(1)}"${picture ? ` width="${picture.width}" height="${picture.height}"` : ''}/>
${assets.join('\n')}
  </resources>
  <library>
    <event name="${xml(title)}">
      <project name="${xml(title)}">
        <sequence format="r1" duration="${t(total)}" tcStart="0s" tcFormat="${fmt}" audioLayout="${channels > 2 ? 'surround' : channels > 1 ? 'stereo' : 'mono'}"${HZ[sampleRate] ? ` audioRate="${HZ[sampleRate]}"` : ''}>
          <spine>
${spine.map(l => '            ' + l).join('\n')}
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
  // this instance's file: its source, or what `url` names when it has none (bytes, a dropped file), which audio sharing
  // its pages (a clone, the clipboard) plays too
  let main = this.source ?? opts.url ?? null, page = this.pages[0]
  let fileOf = i => i === this || i.source == null && page && i.pages[0] === page ? main : i.source
  let plan = buildPlan(this), clips = arrange(flatten(plan.segs, plan.sr, this, { memo: new Map(), fileOf }))
  if (!clips.length) throw new Error('cuts: generated audio has no file for a cut list to point at')
  let video = await videoInfo(main).catch(() => null)
  let frame = opts.fps ? rational(opts.fps) : video ?? { timescale: 30, delta: 1 }
  let fps = frame.timescale / frame.delta
  if (!format) return { fps, clips: clips.map(({ inst, ...c }) => c) }
  // drop-frame when asked, else when the file's own timecode counts it
  let drop = opts.dropFrame ?? (!!video?.drop && dropRate(fps))
  if (drop && !dropRate(fps)) throw new RangeError(`cuts: drop-frame timecode counts 29.97 or 59.94 fps (SMPTE ST 12-1), not ${+fps.toFixed(3)}`)
  // each file the list points at: its name and URL, what an editor finds in it, where its timecode starts, its frames
  let files = new Map()
  for (let { source, inst } of clips) if (!files.has(source)) {
    let v = source === main ? video : await videoInfo(source).catch(() => null)
    files.set(source, { name: nameOf(source), url: source === main && opts.url || await fileUrl(source), video: v, channels: inst._.ch, sampleRate: inst._.sr,
      start: Math.round((v?.start ?? 0) * fps), frames: v ? Math.round(v.frames * v.delta / v.timescale * fps) : Math.ceil(inst._.len / inst._.sr * fps - 1e-9) })
  }
  let marks = opts.meta === false ? [] : [
    ...(opts.markers ?? this.markers).map(m => ({ at: Math.round(m.time * fps), duration: 0, label: m.label || '' })),
    ...(opts.regions ?? this.regions).map(r => ({ at: Math.round(r.at * fps), duration: Math.round(r.duration * fps), label: r.label || '' }))
  ].sort((a, b) => a.at - b.at)
  return FORMATS[format]({ events: events(clips, fps, files), fps, frame, drop, files, markers: marks, total: Math.round(this.duration * fps),
    title: opts.title ?? `${nameOf(main ?? clips[0].source).replace(/\.\w+$/, '')} cuts`, sampleRate: this.sampleRate, channels: this.channels })
}
