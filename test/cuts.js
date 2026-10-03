// Cut lists for video editors (fn/cuts.js): the time map under them, read against the audio it describes, and its
// CMX 3600, OpenTimelineIO and FCPXML forms read back here by readers written apart from the writers.
// Checked once against OpenTimelineIO 0.18.1 (ASWF): its cmx_3600, otio_json and fcpx_xml readers parse these lists to
// the same record positions and source ranges (fcpx_xml truncates 29.97 to 29, fcpx_xml.py `int(fps)`, so 29.97 FCPXML
// is checked here by its rational times), and OTIO's to_timecode gives the same drop-frame labels; the FCPXML is valid
// to Apple's FCPXMLv1_9.dtd (xmllint --dtdvalid).
// test/timecode.mov, a camera-style file with a QuickTime timecode track at 29.97 drop-frame:
//   ffmpeg -f lavfi -i color=c=gray:s=64x48:r=30000/1001 -f lavfi -i sine=frequency=440:sample_rate=48000 \
//     -f lavfi -i sine=frequency=660:sample_rate=48000 -filter_complex "[1:a][2:a]join=inputs=2:channel_layout=stereo[a]" \
//     -map 0:v -map "[a]" -t 2 -c:v libx264 -preset ultrafast -crf 51 -pix_fmt yuv420p -c:a aac -b:a 32k \
//     -timecode "01:00:00;00" test/timecode.mov
import test from 'tst'
import audio from '../audio.js'
import { videoInfo, timecode } from '../fn/cuts.js'
import { readFileSync, mkdtempSync, rmSync } from 'fs'
import { fileURLToPath, pathToFileURL } from 'url'
import { tmpdir } from 'os'
import { join } from 'path'

const lena = fileURLToPath(new URL('../node_modules/audio-lena/lena.wav', import.meta.url))
const lena24 = fileURLToPath(new URL('../node_modules/audio-lena/lena-24.aiff', import.meta.url))
const video = fileURLToPath(new URL('./video.mp4', import.meta.url))
const camera = fileURLToPath(new URL('./timecode.mov', import.meta.url))
const dir = mkdtempSync(join(tmpdir(), 'audio-cuts-')), tmp = name => join(dir, name)
process.on('exit', () => rmSync(dir, { recursive: true, force: true }))
const NTSC = 30000 / 1001

// ── Fixtures, written on first use (tst runs once registration settles: a module-level await would cut it short) ──

// Clicks: a 33-sample triangle every 0.37 s, each its own height, to be found again wherever the edits put it.
const SR = 48000, W = 16, CLICKS = []
for (let t = 0.2; t < 9.8; t += 0.37) CLICKS.push(Math.round(t * SR))
const clicksWav = tmp('clicks.wav'), talkWav = tmp('talk.wav')
let written
const fixtures = () => written ??= (async () => {
  let x = new Float32Array(10 * SR)
  CLICKS.forEach((c, k) => { let h = 0.2 + 0.6 * (k * 7 % 13) / 12; for (let i = -W; i <= W; i++) x[c + i] = h * (1 - Math.abs(i) / (W + 1)) })
  await audio.from([x], { sampleRate: SR }).save(clicksWav)
  // Talk: tone bursts and pauses of every length, a minute of them, for shrink to cut between frames many times
  let y = new Float32Array(60 * SR), seed = 7, rnd = () => (seed = seed * 16807 % 2147483647) / 2147483647
  for (let i = 0; i < y.length;) {
    let n = Math.round((0.3 + 0.6 * rnd()) * SR)
    for (let j = 0; j < n && i + j < y.length; j++) y[i + j] = 0.3 * Math.sin(2 * Math.PI * 220 * j / SR)
    i += n + Math.round((0.25 + 0.9 * rnd()) * SR)
  }
  await audio.from([y], { sampleRate: SR }).save(talkWav)
})()

// ── Readers, written apart from the writers ──────────────────────────────

/** Timecode → frames, SMPTE ST 12-1: drop-frame (a semicolon) leaves out 2 frame numbers a minute (4 at 59.94),
 *  but each tenth minute. */
function frames(tc, fps) {
  let [h, m, s, f] = tc.split(/[:;]/).map(Number), n = Math.round(fps), mins = h * 60 + m
  return (mins * 60 + s) * n + f - (tc.includes(';') ? n / 15 * (mins - Math.floor(mins / 10)) : 0)
}

/** A CMX 3600 list: title, FCM, events with their M2, FROM CLIP NAME and LOC lines. Throws on a line it can't place. */
function readEdl(text, fps) {
  let lines = text.split('\n'), edl = { title: lines[0].replace(/^TITLE: /, ''), fcm: lines[1], events: [] }, e
  for (let l of lines.slice(2)) {
    let m
    if (m = l.match(/^(\d{3,})  (\S+)\s+(\S+)\s+C\s+(\S+) (\S+) (\S+) (\S+)$/))
      edl.events.push(e = { n: +m[1], reel: m[2], ch: m[3], sIn: frames(m[4], fps), sOut: frames(m[5], fps), rIn: frames(m[6], fps), rOut: frames(m[7], fps), tc: [m[4], m[5], m[6], m[7]], locs: [] })
    else if (m = l.match(/^M2   (\S+)\s+(-?\d{3}\.\d)\s+(\S+)$/)) e.m2 = { reel: m[1], speed: +m[2], at: frames(m[3], fps) }
    else if (m = l.match(/^\* FROM CLIP NAME: (.+)$/)) e.name = m[1]
    else if (m = l.match(/^\* LOC: (\S+) (\S+)\s+(.*)$/)) e.locs.push({ at: frames(m[1], fps), color: m[2], label: m[3] })
    else if (l) throw new Error(`EDL: what is "${l}"?`)
  }
  return edl
}

/** XML 1.0, well-formed: tags nested and closed, attributes quoted and unique, text and values escaped (the five
 *  entities, §4.6); a tree of { name, attrs, children }. */
function readXml(s) {
  let root = { children: [] }, stack = [root], unescape = v => v.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&')
  let bad = v => /&(?!(amp|lt|gt|quot|apos);)/.test(v)
  s = s.replace(/^<\?xml [^?]*\?>\s*<!DOCTYPE \w+>\s*/, '')
  for (let m of s.matchAll(/<(\/?)([\w-]+)((?:\s+[\w-]+="[^"<]*")*)\s*(\/?)>|([^<]+)|(<)/g)) {
    if (m[6]) throw new Error(`XML: a stray < at ${m.index}`)
    if (m[5] != null) { if (bad(m[5]) || m[5].trim() && stack.length < 2) throw new Error(`XML: text "${m[5].trim()}"`); continue }
    let [, close, name, attrs, empty] = m
    if (close) { if (stack.pop().name !== name) throw new Error(`XML: </${name}> closes another element`); continue }
    let el = { name, attrs: {}, children: [] }
    for (let [, k, v] of attrs.matchAll(/([\w-]+)="([^"]*)"/g)) {
      if (k in el.attrs || bad(v)) throw new Error(`XML: attribute ${k} of <${name}>`)
      el.attrs[k] = unescape(v)
    }
    stack.at(-1).children.push(el)
    if (!empty) stack.push(el)
  }
  if (stack.length > 1 || root.children.length !== 1) throw new Error('XML: not one closed root element')
  return root.children[0]
}
const kids = (el, name) => el.children.filter(c => c.name === name)
const find = (el, name) => el.name === name ? el : el.children.map(c => find(c, name)).find(Boolean)
/** FCPXML time ("1001/30000s", "2s", "0s") → frames at fps, and that it is a whole number of them. */
function fcpFrames(v, fps) {
  let m = v.match(/^(\d+)(?:\/(\d+))?s$/)
  if (!m) throw new Error(`FCPXML: time "${v}"`)
  let f = +m[1] / (+m[2] || 1) * fps
  if (Math.abs(f - Math.round(f)) > 1e-6) throw new Error(`FCPXML: ${v} is not on a frame`)
  return Math.round(f)
}

// ── The three lists against the time map and each other ──────────────────

/** Reads all three lists of `a` back and checks them against its time map at fps: each event's record bounds the frame
 *  nearest a cut, the source within half a frame of what is heard at its record in, contiguous where the audio is,
 *  the speed where a clip has one; OTIO and FCPXML hold the same events, tile the output and carry the markers. */
async function lists(t, a, opts, name) {
  let { fps, clips } = await a.cuts(opts), total = Math.round(a.duration * fps), nominal = Math.round(fps)
  let edl = readEdl(await a.cuts('edl', opts), fps), ev = edl.events
  let start = (await videoInfo(clips[0].source).catch(() => null))?.start ?? 0, s0 = Math.round(start * fps)
  let bounds = clips.flatMap(c => [c.at, c.at + c.duration]).map(b => b * fps)
  let near = f => bounds.some(b => Math.abs(f - b) <= 0.5 + 1e-6)
  let worst = 0
  for (let e of ev) {
    let c = clips.find(c => (e.rIn + 0.5) / fps >= c.at && (e.rIn + 0.5) / fps < c.at + c.duration)
    let heard = (c.from + (e.rIn / fps - c.at) * c.rate) * fps + s0, edge = c.rate < 0 ? e.sOut : e.sIn
    worst = Math.max(worst, Math.abs(edge - heard))
    if (!near(e.rIn) || !near(e.rOut)) return t.fail(`${name}: event ${e.n} record ${e.rIn}–${e.rOut} is half a frame off every cut`)
    if (c.rate === 1 && e.sOut - e.sIn !== e.rOut - e.rIn) return t.fail(`${name}: event ${e.n} source and record lengths differ`)
    if (c.rate !== 1 && (e.m2?.speed !== +(c.rate * nominal).toFixed(1) || e.m2.at !== e.sIn)) return t.fail(`${name}: event ${e.n} M2 ${JSON.stringify(e.m2)} for rate ${c.rate}`)
    if (e.name !== c.source.split('/').pop()) return t.fail(`${name}: event ${e.n} names ${e.name}`)
  }
  t.ok(worst <= 0.5 + 1e-6, `${name}: EDL, ${ev.length} events, picture within ${worst.toFixed(2)} of half a frame of the sound`)
  t.ok(ev.every((e, i) => e.n === i + 1 && e.rIn < e.rOut && (!i || ev[i - 1].rOut <= e.rIn)) && ev.at(-1).rOut <= total, `${name}: events numbered in order, never overlapping, inside the output`)
  let rows = ev.map(e => [e.rIn, e.rOut, e.sIn, e.sOut])

  // OTIO: the schema names opentimelineio 0.18 writes, tracks tiling the output, the same events
  let o = JSON.parse(await a.cuts('otio', opts)), schemas = new Set(), rates = new Set()
  JSON.stringify(o, (k, v) => { if (k === 'OTIO_SCHEMA') schemas.add(v); if (v?.OTIO_SCHEMA === 'RationalTime.1') rates.add(v.rate); return v })
  t.ok([...schemas].every(s => ['Timeline.1', 'Stack.1', 'Track.1', 'Clip.2', 'Gap.1', 'ExternalReference.1', 'RationalTime.1', 'TimeRange.1', 'Marker.2', 'LinearTimeWarp.1'].includes(s)) && o.OTIO_SCHEMA === 'Timeline.1' && o.tracks.OTIO_SCHEMA === 'Stack.1', `${name}: OTIO schemas ${[...schemas].join(', ')}`)
  t.is([...rates], [fps], `${name}: OTIO times at ${+fps.toFixed(3)} fps`)
  for (let track of o.tracks.children) {
    let at = 0, got = []
    for (let c of track.children) {
      let d = c.source_range.duration.value
      if (c.OTIO_SCHEMA === 'Clip.2') {
        let warp = c.effects.find(x => x.OTIO_SCHEMA === 'LinearTimeWarp.1')?.time_scalar ?? 1, m = Math.max(1, Math.round(d * Math.abs(warp)))
        got.push([at, at + d, c.source_range.start_time.value, c.source_range.start_time.value + m])
        if (c.media_references.DEFAULT_MEDIA.target_url !== pathToFileURL(clips.find(k => k.source.endsWith(c.name)).source).href) return t.fail(`${name}: OTIO URL of ${c.name}`)
      }
      at += d
    }
    t.is(at, total, `${name}: OTIO ${track.kind} track tiles the output, ${total} frames`)
    if (track.kind === 'Audio') t.is(got, rows, `${name}: OTIO clips are the EDL's events`)
  }
  t.is(o.tracks.markers.map(m => [m.OTIO_SCHEMA, m.marked_range.start_time.value, m.name]), a.markers.map(m => ['Marker.2', Math.round(m.time * fps), m.label]), `${name}: OTIO markers on the timeline`)

  // FCPXML: well-formed, every time a whole frame, a spine that tiles the output with the same events
  let x = readXml(await a.cuts('fcpxml', opts)), F = v => fcpFrames(v, fps)
  t.is([x.attrs.version, F(find(x, 'format').attrs.frameDuration)], ['1.9', 1], `${name}: FCPXML 1.9, a frame per frameDuration`)
  let assets = Object.fromEntries(kids(find(x, 'resources'), 'asset').map(r => [r.attrs.id, F(r.attrs.start)]))
  let spine = find(x, 'spine').children, at = 0, got = [], marks = []
  for (let c of spine) {
    if (F(c.attrs.offset) !== at) return t.fail(`${name}: FCPXML spine not contiguous at ${at}`)
    let d = F(c.attrs.duration), s = F(c.attrs.start)
    if (c.name === 'asset-clip') {
      let map = find(c, 'timeMap'), v = map ? kids(map, 'timept').map(p => [F(p.attrs.time), F(p.attrs.value)]) : [[s, s], [s + d, s + d]]
      if (v[0][0] !== s || v[1][0] !== s + d) return t.fail(`${name}: FCPXML timeMap of the clip at ${at}`)
      got.push([at, at + d, Math.min(v[0][1], v[1][1]) - assets[c.attrs.ref], Math.max(v[0][1], v[1][1]) - assets[c.attrs.ref]])
    }
    for (let m of kids(c, 'marker')) { let ms = F(m.attrs.start); if (ms < s || ms >= s + d) return t.fail(`${name}: FCPXML marker outside its item`); marks.push([at + ms - s, m.attrs.value]) }
    at += d
  }
  t.is([at, F(find(x, 'sequence').attrs.duration)], [total, total], `${name}: FCPXML spine tiles the sequence, ${total} frames`)
  t.is(got, rows.map(([a, b, c, d]) => [a, b, c - s0, d - s0]), `${name}: FCPXML clips are the EDL's events`)
  t.is(marks, a.markers.map(m => [Math.round(m.time * fps), m.label]), `${name}: FCPXML markers where they were`)
  return { edl, clips, fps }
}

/** Every click the source holds is in the output where the time map plays it: the same sample and height where it is
 *  copied (rate ±1), within 2 samples and 10 % where a rate resamples it; the output holds no other, and where no clip
 *  plays it is silent. */
async function landed(t, a, name) {
  let { clips } = await a.cuts(), [y] = await a.read(), [x] = await (await audio(clicksWav)).read(), want = [], found = []
  for (let c of clips) {
    let lo = Math.min(c.from, c.from + c.duration * c.rate) * SR, hi = Math.max(c.from, c.from + c.duration * c.rate) * SR
    for (let j of CLICKS) if (j - W > lo + 2 && j + W < hi - 2) want.push({ at: c.at * SR + (j - c.from * SR) / c.rate - (c.rate < 0 ? 1 : 0), h: x[j], exact: Math.abs(c.rate) === 1 })
  }
  for (let i = W; i < y.length - W; i++) {
    if (y[i] < 0.05) continue
    let top = true
    for (let k = 1; k <= W && top; k++) top = y[i] >= y[i - k] && y[i] > y[i + k]
    if (top) found.push(i)
  }
  let missed = want.filter(w => !found.some(i => w.exact ? i === Math.round(w.at) && y[i] === w.h : Math.abs(i - w.at) <= 2 && Math.abs(y[i] - w.h) <= 0.1 * w.h))
  t.ok(!missed.length && found.length === want.length, `${name}: ${want.length} clicks where the time map puts them${missed.length ? `, missed at ${missed.map(w => (w.at / SR).toFixed(4))}` : ''}${found.length !== want.length ? `, found ${found.length}` : ''}`)
  let end = 0, loud = 0
  for (let c of [...clips, { at: a.duration }]) {
    for (let i = Math.round(end * SR); i < Math.round(c.at * SR); i++) loud = Math.max(loud, Math.abs(y[i]))
    end = Math.max(end, c.at + (c.duration ?? 0))
  }
  t.is(loud, 0, `${name}: silent where no clip plays`)
}

// ── Tests ────────────────────────────────────────────────────────────────

test('cuts: the time map plays each moment of the source where the audio has it', { timeout: 60000 }, async t => {
  await fixtures()
  let src = () => audio(clicksWav)
  let chains = {
    'remove': a => a.remove(1.03, 0.61),
    'two removes': a => a.remove(1.03, 0.61).remove(3.3, 1.17),
    'insert silence': a => a.insert(0.73, 2.11),
    'pad': a => a.pad(0.41, 0.2),
    'crop': a => a.crop({ at: 1.3, duration: 5 }),
    'move': a => a.move({ at: 1.1, duration: 0.9, to: 5.3 }),
    'cut, paste': a => a.cut(2.2, 1.1).paste(5.05),
    'copy, paste': a => a.copy(1, 1).paste(7),
    'repeat': a => a.repeat(1, { at: 2, duration: 1.5 }),
    'speed 2 on a range': a => a.speed(2, { at: 3, duration: 2 }),
    'speed ½ on a range': a => a.speed(0.5, { at: 1, duration: 1 }),
    'speed 1.25': a => a.speed(1.25),
    'reverse a range': a => a.reverse({ at: 2.1, duration: 1.5 }),
    'reverse, then remove': a => a.reverse().remove(2, 1),
    'insert a file': async a => a.insert((await src()).crop({ at: 6, duration: 1.3 }), 2.5),
    'move over the start': a => a.remove(1.03, 0.61).move({ at: 4, duration: 1, to: 0.5 }),
    // processing between structural edits bakes a stage the later ones cut into: rates read through it
    'speed, gain, remove': a => a.speed(1.5, { at: 1, duration: 3 }).gain(0).remove(2.5, 0.4),
    'reverse, gain, remove': a => a.reverse({ at: 2.1, duration: 3 }).gain(0).remove(3, 0.5),
    'remove, gain, reverse': a => a.remove(1.03, 0.61).gain(0).reverse({ at: 2.1, duration: 3 }),
    'insert a file sped up': async a => a.insert((await src()).crop({ at: 6, duration: 2 }).speed(2), 2.5),
  }
  for (let [name, chain] of Object.entries(chains)) await landed(t, await chain(await src()), name)
})

test('cuts: processing leaves the list alone; a crossfade cuts at its middle; whole-render ops keep the map', async t => {
  let map = async a => (await a.cuts()).clips.map(c => [+c.at.toFixed(6), +c.duration.toFixed(6), +c.from.toFixed(6), c.rate])
  let plain = await map((await audio(lena)).remove(2, 1))
  t.is(await map((await audio(lena)).highpass(80).gain(-6).remove(2, 1).fade(0.5)), plain, 'EQ, gain and a fade before and after: the same clips')
  t.is(await map((await audio(lena)).roomtone().remove(2, 1)), plain, 'roomtone (rendered whole) before a remove: the same clips')
  t.is(await map((await audio(lena)).highpass(80).remove(2, 1, 0.1)), plain, 'a crossfaded remove cuts at its middle: 2 s, from 3 s')
  let D = (await audio(lena)).duration, rest = +(D - 5).toFixed(6)
  t.is(await map((await audio(lena)).move({ at: 1, duration: 1, to: 4, crossfade: 0.02 })), [[0, 1.01, 0, 1], [1.99, 2.01, 1.99, 1], [4, 1, 1, 1], [5, rest, 5, 1]],
    'a crossfaded move: where it lands its edges meet at their middles; where it was, the fades into silence play on')
  t.almost((await map((await audio(lena)).stretch(0.8)))[0][3], 1.25, 1e-9, 'stretch 0.8: the source read 1.25 times as fast')
  t.almost((await map((await audio(lena)).warp([[2, 3]]))).map(c => c[3]), [2 / 3, (D - 2) / (D - 3)], 1e-9, 'warp [2 s → 3 s]: each span its own rate')
  let r = (await (await audio(lena)).speed(-1).cuts()).clips
  t.is(r.map(c => [c.at, +c.from.toFixed(6), c.rate]), [[0, +D.toFixed(6), -1]], 'speed(-1): from the end, backwards')
})

test('cuts: an inserted file is its own clip; audio with no file is a gap, and none at all throws', async t => {
  let ins = (await (await audio(lena)).crop({ at: 0, duration: 2 }).insert((await audio(lena24)).crop({ at: 5, duration: 1 }), 1).cuts()).clips
  t.is(ins.map(c => [c.at, +c.from.toFixed(6), c.source.split('/').pop()]), [[0, 0, 'lena.wav'], [1, 5, 'lena-24.aiff'], [2, 1, 'lena.wav']], 'lena-24.aiff between, with its own edits')
  let tone = audio.from(x => Math.sin(2 * Math.PI * 440 * x), { duration: 0.5, sampleRate: 44100 })
  let gen = (await (await audio(lena)).insert(tone, 1).cuts()).clips
  t.is(gen.map(c => [c.at, c.from]), [[0, 0], [1.5, 1]], 'a generated tone: a gap where it plays')
  await t.rejects(() => audio.from([new Float32Array(44100)], { sampleRate: 44100 }).cuts(), /generated audio/, 'nothing from a file: throws')
  let named = await audio(readFileSync(lena)).remove(1, 1).copy(0, 0.5).paste(3).cuts('edl', { fps: 25, url: 'lena.wav' })
  t.is(readEdl(named, 25).events.map(e => [e.name, e.sIn, e.rIn]), [['lena.wav', 0, 0], ['lena.wav', 50, 25], ['lena.wav', 0, 75], ['lena.wav', 100, 88]], 'from bytes, `url` names the file, its clipboard\'s too')
})

test('cuts: CMX 3600 at 25 fps, cut by cut', async t => {
  let a = (await audio(lena)).remove(1, 0.5)
  t.is((await a.cuts('edl', { fps: 25 })).split('\n').slice(0, 7), ['TITLE: lena cuts', 'FCM: NON-DROP FRAME', '',
    '001  AX       A     C        00:00:00:00 00:00:01:00 00:00:00:00 00:00:01:00', '* FROM CLIP NAME: lena.wav', '',
    '002  AX       A     C        00:00:01:13 00:00:12:07 00:00:01:00 00:00:11:19'], 'lena (mono, no picture: channel A): 1.5 s = 37.5 frames, halfway: 38, the clip\'s own; 12.2717 s = 306.8 → 307')
  let s = (await audio(lena)).speed(1.25, { at: 3, duration: 2 }).reverse({ at: 6, duration: 1 })
  let lines = (await s.cuts('edl', { fps: 25 })).split('\n').filter(l => l.startsWith('M2'))
  t.is(lines, ['M2   AX             031.3                00:00:03:00', 'M2   AX             -025.0                00:00:06:10'], 'M2: 1.25 × 25 = 31.25 fps to a tenth; reversed, negative; at the event\'s source in (6.4 s, the speed-up before it)')
  let x = readXml(await a.cuts('fcpxml', { fps: NTSC }))
  t.is(find(x, 'format').attrs.frameDuration, '1001/30000s', 'FCPXML: the NTSC frame duration exact')
  t.is(kids(find(x, 'spine'), 'asset-clip').map(c => ['offset', 'start', 'duration'].map(k => fcpFrames(c.attrs[k], NTSC))), [[0, 0, 30], [30, 45, 323]], 'FCPXML at 29.97: 1 s = 29.97 → 30 frames, 1.5 s = 44.96 → 45, 12.2717 s = 367.8 → 368')
  t.is(JSON.parse(await a.cuts('otio', { fps: 25 })).tracks.children[0].children.map(c => [c.OTIO_SCHEMA, c.source_range.start_time.value, c.source_range.duration.value]), [['Clip.2', 0, 25], ['Clip.2', 38, 269]], 'OTIO: the same frames')
  let g = (await audio(lena)).crop({ at: 0, duration: 2 }).pad(0.5, 0)
  t.ok((await g.cuts('edl', { fps: 25 })).includes('00:00:00:00 00:00:02:00 00:00:00:13 00:00:02:13'), 'a gap first: record in 0.5 s = 12.5 → 13 frames, the source from its first')
  t.is(JSON.parse(await g.cuts('otio', { fps: 25 })).tracks.children[0].children.map(c => [c.OTIO_SCHEMA, c.source_range.start_time.value, c.source_range.duration.value]), [['Gap.1', 0, 13], ['Clip.2', 0, 50]], 'OTIO: the gap, then the clip')
  t.is(find(readXml(await g.cuts('fcpxml', { fps: 25 })), 'gap').attrs, { name: 'Gap', offset: '0s', start: '0s', duration: '13/25s' }, 'FCPXML: a gap of 13 frames')
  let m = readEdl(await (await audio(lena)).remove(1, 0.5).mark(0.2, 'Intro').mark(5, 'Part two').cuts('edl', { fps: 25 }), 25)
  t.is(m.events.map(e => e.locs.map(l => [l.at, l.color, l.label])), [[[5, 'RED', 'Intro']], [[125, 'RED', 'Part two']]], 'markers: Avid locators at their record timecode, under the event they fall in')
  let many = readEdl(await (await audio(lena)).crop({ at: 0, duration: 0.2 }).repeat(1099).cuts('edl', { fps: 25 }), 25)
  t.is([many.events.length, many.events[999].n, many.events.at(-1).rOut], [1100, 1000, 5500], 'past 999 events the numbers widen')
  await t.rejects(() => audio(video).then(v => v.remove(0.5, 0.5).cuts('edl')), /SMPTE/, '10 fps has no SMPTE timecode')
  await t.rejects(() => a.cuts('edl', { fps: 25, dropFrame: true }), /drop-frame/, 'no drop-frame at 25 fps')
})

test('cuts: drop-frame timecode (SMPTE ST 12-1)', t => {
  // Drop-frame leaves out frame numbers 00 and 01 (00 to 03 at 59.94) at the start of each minute, except minutes 00, 10,
  // 20, 30, 40 and 50 (SMPTE ST 12-1): a minute holds 1798 frames (3596), ten minutes 17982 (35964), an hour 107892.
  t.is([0, 1799, 1800, 3597, 3598, 17981, 17982, 107892].map(f => timecode(f, NTSC, true)),
    ['00:00:00;00', '00:00:59;29', '00:01:00;02', '00:01:59;29', '00:02:00;02', '00:09:59;29', '00:10:00;00', '01:00:00;00'], '29.97')
  t.is([3599, 3600, 35963, 35964, 215784].map(f => timecode(f, 2 * NTSC, true)), ['00:00:59;59', '00:01:00;04', '00:09:59;59', '00:10:00;00', '01:00:00;00'], '59.94')
  t.is([107892, 307].map(f => timecode(f, NTSC)), ['00:59:56:12', '00:00:10:07'], 'non-drop counts 30 a second at 29.97')
  for (let fps of [NTSC, 2 * NTSC]) {
    let n = Math.round(fps), d = n / 15, ok = true
    for (let f = 0; f < 3 * 10 * 60 * n && ok; f++) {
      let tc = timecode(f, fps, true), [, m, s, ff] = tc.split(/[:;]/).map(Number)
      ok = frames(tc, fps) === f && !(m % 10 && !s && ff < d)
    }
    t.ok(ok, `${+fps.toFixed(2)}: every frame of 30 minutes reads back, no dropped label written`)
  }
})

test('cuts: the three lists read back alike, cut for cut, at 25 and 29.97', async t => {
  await fixtures()
  let src = () => audio(clicksWav)
  let chains = {
    'removes and a move': a => a.remove(1.03, 0.61).remove(3.3, 1.17).move({ at: 1, duration: 0.9, to: 5.3 }).mark(0.5, 'start & <go>').mark(4, 'Part two'),
    'speeds and a reverse': a => a.speed(1.25, { at: 1, duration: 2 }).speed(0.5, { at: 4, duration: 1 }).reverse({ at: 6, duration: 1.5 }),
    'gaps': a => a.insert(0.73, 2.11).pad(0.41, 0.3).mark(1, 'In the gap'),
    'an inserted file': async a => a.crop({ at: 0, duration: 4 }).insert((await audio(lena24)).crop({ at: 5, duration: 1 }), 1),
  }
  for (let fps of [25, NTSC]) for (let [name, chain] of Object.entries(chains)) await lists(t, await chain(await src()), { fps }, `${name}, ${+fps.toFixed(2)} fps`)
})

test('cuts: many cuts between frames never drift (shrink over a minute of talk)', async t => {
  await fixtures()
  let a = (await audio(talkWav)).shrink(0.1), { clips } = await a.cuts()
  t.ok(clips.length > 40, `${clips.length} clips`)
  let { edl } = await lists(t, a, { fps: NTSC }, 'shrink, 29.97')
  t.is(edl.events.at(-1).rOut, Math.round(a.duration * NTSC), 'the last event ends where the audio does')
})

test('cuts: a video file\'s rate, size and timecode; drop-frame from its timecode track', async t => {
  t.is(await videoInfo(video), { timescale: 10240, delta: 1024, width: 64, height: 48, frames: 20, start: 0, drop: false }, 'test/video.mp4: 10 fps, 64×48, 20 frames, no timecode track')
  let v = await videoInfo(camera)
  t.is([v.timescale, v.delta, v.width, v.height, v.frames, Math.round(v.start * NTSC), v.drop], [30000, 1001, 64, 48, 60, 107892, true], 'test/timecode.mov: 29.97, 60 frames, from 01:00:00;00 drop-frame (frame 107892)')
  let m = (await (await audio(video)).remove(0.5, 0.5).cuts())
  t.is([m.fps, m.clips.map(c => [c.at, c.from, +c.duration.toFixed(6)])], [10, [[0, 0, 0.5], [0.5, 1, 1]]], 'the video track\'s 10 fps')
  let a = (await audio(camera)).remove(0.5, 0.25).move({ at: 1, duration: 0.25, to: 1.5 }).mark(0.1, 'Slate')
  let edl = await a.cuts('edl')
  t.is(edl.split('\n').slice(0, 5), ['TITLE: timecode cuts', 'FCM: DROP FRAME', '', '001  AX       AA/V  C        01:00:00;00 01:00:00;15 00:00:00;00 00:00:00;15', '* FROM CLIP NAME: timecode.mov'], 'its timecode starts the source; stereo with picture: AA/V; drop-frame as the file counts')
  t.ok((await a.cuts('edl', { dropFrame: false })).includes('00:59:56:12 00:59:56:27 00:00:00:00 00:00:00:15'), 'dropFrame: false counts the same frames non-drop')
  await lists(t, a, {}, 'timecode.mov, 29.97 drop-frame')
  let o = JSON.parse(await a.cuts('otio')).tracks.children
  t.is(o.map(k => k.kind), ['Video', 'Audio'], 'OTIO: a video track and an audio track')
  t.is(o[0].children[0].media_references.DEFAULT_MEDIA.available_range.start_time.value, 107892, 'OTIO: the file\'s range starts at its timecode')
  let x = readXml(await a.cuts('fcpxml'))
  t.is([find(x, 'asset').attrs.start, find(x, 'sequence').attrs.tcFormat, find(x, 'format').attrs.width], ['8999991/2500s', 'DF', '64'], 'FCPXML: the asset starts at 01:00:00;00 (107892 × 1001/30000 s)')
})

test('cuts: encode() and save() take the lists by name and extension; sound formats unchanged', async t => {
  let a = (await audio(lena)).remove(1, 0.5).mark(3, 'Here')
  for (let f of ['edl', 'otio', 'fcpxml']) {
    let text = await a.cuts(f, { fps: 25 })
    t.is(new TextDecoder().decode(await a.encode(f, { fps: 25 })), text, `encode('${f}'): its text as UTF-8`)
    await a.save(tmp(`cut.${f}`), { fps: 25 })
    t.is(readFileSync(tmp(`cut.${f}`), 'utf8'), text, `save('cut.${f}')`)
  }
  t.is(new TextDecoder().decode((await a.encode('wav')).subarray(0, 4)), 'RIFF', 'encode(\'wav\') is still sound')
  await t.rejects(() => a.save(tmp('cut.xyz')), /unknown format/, 'an unknown extension still throws')
})
