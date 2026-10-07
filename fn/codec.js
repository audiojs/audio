/**
 * Codec: the sound as a lossy codec gives it back, encoded and decoded in place (iZotope RX Streaming Preview).
 *
 * a.codec()               → as an MP3 at 128 kbps plays
 * a.codec('aac', 256)     → AAC-LC at 256 kbps
 * a.codec('opus', 96)     → Opus at 96 kbps
 * a.codec('vorbis', 160)  → Ogg Vorbis at about 160 kbps
 * a.codec('mp3', { quality: 2 })  → MP3 VBR at LAME's -V 2 (0 best, under 10; Pedalboard's MP3Compressor)
 * a.codec('gsm')          → GSM 06.10 full rate, a phone call of the 1990s (Pedalboard's GSMFullRateCompressor)
 *
 * Heard against what went in (the editor's A/B, or what the step takes out), it is what the codec costs: smeared
 * attacks, swirling highs, a low-passed top. The output lines up with the input within 0.03 of a sample (test/rx.js:
 * each codec at 44.1 and 48 kHz, mono and stereo), so the difference is the codec's alone. Each codec's delay is undone by its own gapless information, as a player undoes it: MP3 the
 * encoder delay and padding in LAME's tag (576 samples, and the decoder's 529), AAC the priming in the MP4 edit list
 * (2048 samples from FDK AAC, 2112 assumed from a browser's encoder), Opus the pre-skip in its header (RFC 7845 §4.2),
 * Vorbis its granule positions. Then it is checked: the lag at which output and input correlate best, within 4096
 * samples, is taken out where it beats lag 0 by 1 % (a codec that says its delay wrong; a held tone, which matches at
 * every period, stays as it is).
 * Opus decodes at 48 kHz, its encoder resampling the input as one stream (@audio/encode-opus 1.3.2); GSM runs at 8 kHz:
 * what comes back is brought to the input's rate by `resample`'s sinc.
 * `bitrate` in kbps; Vorbis takes a quality, the one whose nominal rate it is (Xiph's: q4 128, q5 160, q6 192 kbps);
 * GSM's is 13. Channels in pairs, GSM's one by one (libgsm 1.0.22, byte for byte as SoX). The edit's input (its range
 * and a second either side) is encoded once, before rendering.
 */
import audio, { arrived, parseTime } from '../core.js'
import { cfft, cifft } from 'fourier-transform'

const CODED = Symbol('codec.coded'), MARGIN = 1, LAG = 4096
// codec → what encode() writes it in
const CODECS = { mp3: ['mp3'], aac: ['m4a', { codec: 'aac' }], opus: ['opus'], vorbis: ['ogg'], gsm: null }
const ALIAS = { m4a: 'aac', ogg: 'vorbis' }
// libvorbis' nominal rates by quality, kbps (stereo, 44.1 kHz)
const VORBIS = [[-1, 45], [0, 64], [1, 80], [2, 96], [3, 112], [4, 128], [5, 160], [6, 192], [7, 224], [8, 256], [9, 320]]
const quality = kbps => {
  let i = VORBIS.findIndex(([, r]) => r >= kbps)
  if (i <= 0) return i ? 9.9 : -1
  let [q0, r0] = VORBIS[i - 1], [q1, r1] = VORBIS[i]
  return q0 + (kbps - r0) / (r1 - r0) * (q1 - q0)
}
const name = o => ALIAS[o.format] ?? o.format ?? 'mp3'

function check(o) {
  let fmt = name(o)
  if (!(fmt in CODECS)) throw new RangeError(`codec: '${o.format}' is none of ${Object.keys(CODECS).join(', ')}`)
  if (o.bitrate != null && !(o.bitrate > 0)) throw new RangeError(`codec: bitrate is kbps, over 0, not ${o.bitrate}`)
  if (fmt === 'gsm' && o.bitrate != null && o.bitrate !== 13) throw new RangeError(`codec: GSM 06.10 full rate runs at 13 kbps, not ${o.bitrate}`)
  if (o.quality != null && (fmt !== 'mp3' || !(o.quality >= 0 && o.quality < 10))) throw new RangeError(`codec: quality is MP3's VBR, 0 (best) to under 10, not ${fmt} ${o.quality}`)
}

/** Encode the edit's input (its range, a margin either side) and decode it, lined up with the input. */
async function prepare(a, index) {
  let o = a.edits[index][1]
  check(o)
  await arrived(a)
  let fmt = name(o), kbps = o.bitrate ?? 128, chs = o.channel == null ? null : [o.channel].flat()
  let stamp = `${a.version}:${a._.len}:${fmt}:${kbps}:${o.quality}:${o.at}:${o.duration}:${chs ?? ''}`
  if (o[CODED]?.stamp === stamp) return
  let input = audio.from(a, { sampleRate: a._.sr })
  input.edits = a.edits.slice(0, index)
  input.version = index
  let sr = input.sampleRate, T = input.duration, at = parseTime(o.at) ?? 0, d = parseTime(o.duration)
  if (at < 0) at = Math.max(0, T + at)
  let from = Math.max(0, at - MARGIN), to = Math.min(T, d == null ? T : at + d + MARGIN), n = Math.round((to - from) * sr)
  let pcm = await input.read({ at: from, duration: n / sr })
  if (chs) pcm = chs.map(c => pcm[c])
  if (fmt === 'gsm') { o[CODED] = { stamp, from: Math.round(from * sr), pcm: await gsm(pcm, sr) }; return }
  let [ext, opts] = CODECS[fmt], out = []
  let rate = fmt === 'vorbis' ? { quality: quality(kbps) } : fmt === 'mp3' && o.quality != null ? { quality: o.quality } : { bitrate: kbps }
  for (let c = 0; c < pcm.length; c += 2) {
    let pair = pcm.slice(c, c + 2), src = audio.from(pair, { sampleRate: sr })
    let back = audio(await src.encode(ext, { ...opts, ...rate, meta: false }))
    await back.ready
    if (back.sampleRate !== sr) back.resample(sr, { type: 'sinc' })
    let y = await back.read()
    let lag = n ? offset(pair, y) : 0
    out.push(...pair.map((_, k) => { let v = new Float32Array(n), s = y[Math.min(k, y.length - 1)]; for (let i = 0; i < n; i++) v[i] = s[i + lag] ?? 0; return v }))
  }
  o[CODED] = { stamp, from: Math.round(from * sr), pcm: out }
}

/** GSM 06.10 full rate, each channel: to 8 kHz, through libgsm and back, at the input's rate. Frame by frame, no
 *  lookahead: what comes back lines up with what went in (checked, as the others). */
async function gsm(pcm, sr) {
  let [{ default: encoder }, { default: decode }] = await Promise.all([import('@audio/encode-gsm'), import('@audio/decode-gsm')])
  let at = (x, from, to) => from === to ? x : audio.from([x], { sampleRate: from }).resample(to, { type: 'sinc' }).read().then(r => r[0])
  let out = []
  for (let x of pcm) {
    let x8 = await at(x, sr, 8000), e = await encoder({ sampleRate: 8000 }), a = e.encode([x8]), b = e.flush()
    e.free()
    let bytes = new Uint8Array(a.length + b.length)
    bytes.set(a); bytes.set(b, a.length)
    let y = await at((await decode(bytes)).channelData[0].subarray(0, x8.length), 8000, sr), lag = x.length ? offset([x], [y]) : 0
    let v = new Float32Array(x.length)
    for (let i = 0; i < v.length; i++) v[i] = y[i + lag] ?? 0
    out.push(v)
  }
  return out
}

/** The lag (samples) at which the decoded y correlates best with x, over their first 2^18 samples (6 s at 44.1 kHz),
 *  where it beats lag 0 by 1 %; else 0. */
function offset(x, y) {
  let n = Math.min(x[0].length, y[0].length, 1 << 18), N = 2 ** Math.ceil(Math.log2(n + LAG))
  let ar = new Float64Array(N), ai = new Float64Array(N), br = new Float64Array(N), bi = new Float64Array(N)
  for (let c of x) for (let i = 0; i < n; i++) ar[i] += c[i]
  for (let c of y) for (let i = 0; i < n; i++) br[i] += c[i]
  cfft(ar, ai); cfft(br, bi)
  for (let k = 0; k < N; k++) { let r = br[k] * ar[k] + bi[k] * ai[k], i = bi[k] * ar[k] - br[k] * ai[k]; ar[k] = r; ai[k] = i }
  cifft(ar, ai)
  let best = 0, at = 0
  for (let l = -LAG; l <= LAG; l++) { let v = ar[(l + N) % N]; if (v > best) { best = v; at = l } }
  return best > 1.01 * ar[0] ? at : 0
}

function codec(input, output, ctx) {
  let done = ctx[CODED]
  if (!done) throw new Error('codec: the sound is encoded before rendering, through read(), stream() or save()')
  let len = input[0].length, off = Math.round((ctx.blockOffset || 0) * ctx.sampleRate) - done.from
  for (let c = 0; c < input.length; c++) {
    let v = done.pcm[c], y = output[c]
    for (let i = 0, j = off; i < len; i++, j++) y[i] = j >= 0 && j < v.length ? v[j] : input[c][i]
  }
}

audio.op('codec', { params: ['format', 'bitrate'], process: codec, prepare })
