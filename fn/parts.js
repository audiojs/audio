/**
 * A file decoded in parts, each a page of its samples (core.js PAGE_SIZE frames), the samples one decoder going through
 * the whole file makes there, bit for bit. The calling side plans them, core.js decodes them:
 *  - WAV of PCM, float or G.711 (wav()): a frame is its own bytes alone, so the decoder takes a page's bytes at a time,
 *    and makes the page: its arrays are the page's, no copy.
 *  - MPEG audio (mpeg(): MP3 of MPEG-1, Layers I and II of any version): the first page decoded as any file, the rest
 *    a page each on threads (parallel.js, solve()), by fresh decoders started a few frames ahead. A frame leans on those
 *    before it: on Layer III's bit reservoir (main_data_begin, up to 511 bytes of the frames before), each granule's
 *    overlap with the last, the synthesis filter's last 16 blocks of 32 samples and where its ring buffer stands, which
 *    turns a block a time, mod 16 (mpg123's synth_1to1, `bo`). A decoder started at frame a decodes as the one from the
 *    start does from the frame after a reservoir in full on: past frames since a that hold 511 bytes of main data, the
 *    ring where it stands in the serial decoder, (a − first) · spf / 32 ≡ 0 mod 16, `first` the first frame of audio.
 *    Its samples before the part are dropped. MPEG-2 and 2.5 Layer III (LSF) do not part: started on a frame its
 *    reservoir does not hold, mpg123 decodes it as a silent frame, zeroing its side information from the third byte
 *    on, and on LSF the second byte still holds part of part2_3_length, so a frame can fail before the filter turns,
 *    and the ring stands elsewhere from then on. Each part decodes the first frame past its page too (`tail`): the
 *    calling side checks the seam, the next part's first samples, by its own decoder, against these, by one that had
 *    run a page by then.
 */

// MPEG audio frame headers (ISO/IEC 11172-3 §2.4.2.3, 13818-3): kbps by [MPEG-1?][layer 1..3][index]; Hz by version
const KBPS = [
  [[0, 32, 48, 56, 64, 80, 96, 112, 128, 144, 160, 176, 192, 224, 256], [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160], [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160]],
  [[0, 32, 64, 96, 128, 160, 192, 224, 256, 288, 320, 352, 384, 416, 448], [0, 32, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 384], [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320]]
]
const HZ = { 3: [44100, 48000, 32000], 2: [22050, 24000, 16000], 0: [11025, 12000, 8000] }
// mpg123's decoder delay, which its gapless decoding adds to the encoder's (frame.h GAPLESS_DELAY)
const DELAY = 529

const id = (h, o) => String.fromCharCode(h[o], h[o + 1], h[o + 2], h[o + 3])

/** The pages of `total` frames from page `p` on: [from, to) a page's frames */
const pages = (total, PS, p = 0) => Array.from({ length: Math.max(0, Math.ceil(total / PS) - p) }, (_, i) => [(i + p) * PS, Math.min((i + p + 1) * PS, total)])

/** A WAV's pages, from its first bytes `h` (the header in them) and its size: { pages, total }, each page the bytes
 *  that hold it, the first from the header on; null where its frames are not their own bytes alone (ADPCM; a frame
 *  wider than its samples). The header read as @audio/decode-wav reads it (scanWavHdr), the data's end where it ends.
 *  A chunk of an odd size is followed by its pad byte, zero, which the size does not count (RIFF keeps chunks on word
 *  boundaries: Multimedia Programming Interface and Data Specifications 1.0, IBM and Microsoft, August 1991, "Resource
 *  Interchange File Format"; the same in EBU Tech 3285 for BWF); where a writer left it out, the next chunk's id is
 *  there, never a zero byte, and the next chunk is read from where the size ends. */
export function wav(h, size, PS) {
  if (h.length < 12 || id(h, 0) !== 'RIFF' || id(h, 8) !== 'WAVE') return null
  let dv = new DataView(h.buffer, h.byteOffset, h.byteLength), fmt = null
  for (let o = 12; o + 8 <= h.length;) {
    let type = id(h, o), n = dv.getUint32(o + 4, true)
    if (type === 'fmt ') {
      if (o + 24 > h.length) return null
      let tag = dv.getUint16(o + 8, true)
      if (tag === 0xFFFE) { if (o + 48 > h.length) return null; tag = dv.getUint16(o + 32, true) }
      fmt = { tag, channels: dv.getUint16(o + 10, true), block: dv.getUint16(o + 20, true), bits: dv.getUint16(o + 22, true) }
    } else if (type === 'data') {
      if (!fmt) return null
      let { tag, channels, block, bits } = fmt, start = o + 8
      let whole = tag === 1 ? [8, 16, 24, 32].includes(bits) : tag === 3 ? bits === 32 || bits === 64 : (tag === 6 || tag === 7) && bits === 8
      if (!whole || !channels || block !== channels * bits / 8) return null
      let left = n > 0 && n < 0xFFFFFFFF ? n : Infinity, total = Math.floor(Math.min(left, size - start) / block)
      return total ? { pages: pages(total, PS).map(([a, b]) => [a ? start + a * block : 0, start + b * block]), total } : null
    }
    o += 8 + n + (n & 1 && h[o + 8 + n] === 0 ? 1 : 0)
  }
  return null
}

/** An MPEG audio frame's kind, by the three bytes after its sync: its version, layer, rate, length, samples, side
 *  information's length (with its checksum, and the tag's place, without); null for none */
function kind(b1, b2, b3) {
  if ((b1 & 0xe0) !== 0xe0) return null
  let version = b1 >> 3 & 3, layer = 4 - (b1 >> 1 & 3), kbps = KBPS[+(version === 3)][layer - 1]?.[b2 >> 4], hz = HZ[version]?.[b2 >> 2 & 3]
  if (version === 1 || layer > 3 || !kbps || !hz) return null
  let pad = b2 >> 1 & 1, mono = (b3 >> 6) === 3, spf = layer === 1 ? 384 : layer === 2 || version === 3 ? 1152 : 576
  let size = layer === 1 ? ((12 * kbps * 1000 / hz | 0) + pad) * 4 : (spf / 8 * kbps * 1000 / hz | 0) + pad
  let tag = version === 3 ? (mono ? 17 : 32) : (mono ? 9 : 17), side = layer !== 3 ? 0 : tag + (b1 & 1 ? 0 : 2)
  return { version, layer, hz, mono, spf, size, side, tag, key: b1 & 0xfe | (b2 & 0x0c) << 8 | +mono << 16 }
}

/** The frame's kind at o, each kind worked out once */
const kinds = new Map()
function frameAt(b, o) {
  if (o + 4 > b.length || b[o] !== 0xff) return null
  let k = b[o + 1] << 9 | b[o + 2] << 1 | +((b[o + 3] >> 6) === 3), f = kinds.get(k)
  if (f === undefined) kinds.set(k, f = kind(b[o + 1], b[o + 2], b[o + 3]))
  return f
}

/** Where mpg123 begins and ends its output, in samples of the frames after the first (an Xing or Info frame: the tag
 *  where a side information without its checksum ends, all zero before it but the checksum's two bytes: parse.c
 *  check_lame_tag), and how many frames it says: { first, begin, end, frames } */
function gapless(b, o, f) {
  let x = o + 4 + f.tag, none = { first: 0, begin: 0, end: 0, frames: 0 }
  if (f.layer !== 3 || x + 8 > o + f.size || !['Xing', 'Info'].includes(id(b, x))) return none
  for (let i = o + 6; i < x; i++) if (b[i]) return none
  let dv = new DataView(b.buffer, b.byteOffset, b.byteLength), flags = dv.getUint32(x + 4), p = x + 8, end = o + f.size
  if (!(flags & 1) || p + 4 > end) return { first: 1, begin: 0, end: 0, frames: 0 }
  let frames = dv.getUint32(p)
  p += 4 + (flags & 2 ? 4 : 0) + (flags & 4 ? 100 : 0) + (flags & 8 ? 4 : 0)
  // the encoder's delay and padding where the 24 bytes after the Xing fields begin with something (LAME, Lavc, …)
  if (p + 24 > end || !b[p]) return { first: 1, begin: DELAY, end: frames * f.spf + DELAY, frames }
  let delay = b[p + 21] << 4 | b[p + 22] >> 4, padding = (b[p + 22] & 15) << 8 | b[p + 23]
  return { first: 1, begin: delay + DELAY, end: frames * f.spf - padding + DELAY, frames }
}

/** An MPEG audio file's parts, from all its bytes: { first, parts, total }, a part for each page past the first,
 *  `first` where the bytes that hold the first page and a frame past it end and how many samples the decoder has made
 *  of them by then; null where it does not part: its frames not one unbroken run to its end (an ID3v1 tag at most after
 *  them), their kind changing, MPEG-2 Layer III, a gapless count of frames they disagree with, one page. The decoder's
 *  samples begin `d` samples into the first frame: frame k's start at k·spf − d. */
export function mpeg(b, PS) {
  let o = 0
  if (b[0] === 0x49 && b[1] === 0x44 && b[2] === 0x33 && b.length >= 10) o = 10 + (b[6] << 21 | b[7] << 14 | b[8] << 7 | b[9]) + (b[5] & 16 ? 10 : 0)
  let f0 = frameAt(b, o)
  if (!f0 || f0.layer === 3 && f0.version !== 3) return null
  // each frame's start, bytes of main data, and main_data_begin: how many bytes of the frames before its main data
  // begins in (Layer III; 9 bits after the header and checksum)
  let at = [], main = [], begin = [], key = f0.key
  for (let f = f0; f; f = frameAt(b, o)) {
    if (f.key !== key || o + f.size > b.length) return null
    let p = o + 4 + f.side - f.tag
    at.push(o); main.push(f.size - 4 - f.side); begin.push(f.layer === 3 ? b[p] << 1 | b[p + 1] >> 7 : 0); o += f.size
  }
  if (o !== b.length && !(o + 128 === b.length && id(b, o).startsWith('TAG'))) return null
  at.push(o)
  let F = at.length - 1, { spf } = f0, g = gapless(b, at[0], f0), actual = (F - g.first) * spf
  if (g.end && g.frames !== F - g.first) return null
  let d = g.first * spf + g.begin, total = (g.end ? Math.min(g.end, actual) : actual) - g.begin
  if (total < 2 * PS) return null
  let frame = s => Math.floor((s + d) / spf), period = 16 / gcd(16, spf / 32)
  // the first frame of a part's decoder: where the ring stands, its frames before frame k − 1 holding 511 bytes of main
  // data past the last frame it silences, one whose main_data_begin reaches past the frames it has (layer3.c
  // III_get_side_info: it zeroes the side information from its third byte, and the checksum's two bytes into the main
  // data after it)
  let start = k => {
    let a = k - 1, held = 0
    if (f0.layer === 3) while (a > g.first && held < 511) held += main[--a]
    for (;;) {
      while (a > g.first && (a - g.first) % period) a--
      let last = a - 1, kept = 0
      for (let j = a, res = 0; j < k - 1; res = Math.min(511, res + main[j++])) if (begin[j] > res) last = j
      for (let j = last + 1; j < k - 1; j++) kept += main[j]
      if (f0.layer !== 3 || kept >= 511 || a <= g.first) return a
      a--
    }
  }
  let parts = pages(total, PS, 1).map(([s, e]) => {
    let tail = Math.min(spf, total - e), a = start(frame(s)), z = Math.min(F, frame(e + tail - 1) + 1)
    return { from: at[a], to: at[z], drop: s - (a * spf - d), keep: e - s, tail, count: (z - a) * spf }
  })
  let k = frame(PS - 1) + 2
  return { first: { end: at[k], count: k * spf - d }, parts, total }
}

const gcd = (a, b) => b ? gcd(b, a % b) : a

// ── On a thread ──

const decoders = {}, fs = typeof process !== 'undefined' && process.versions?.node ? await import('node:fs') : null

/** The bytes [from, to) of the file at `path` */
function bytesOf(path, from, to) {
  let fd = fs.openSync(path, 'r'), b = new Uint8Array(to - from)
  try { for (let n = 0; n < b.length;) { let r = fs.readSync(fd, b, n, b.length - n, from + n); if (!r) break; n += r } }
  finally { fs.closeSync(fd) }
  return b
}

/** A part decoded by a fresh decoder of `format`: its page's channels, then the tail's, each its own array; null where
 *  the decoder made other than the samples of the frames it was given (a frame it could not decode) */
export async function solve({ path, format }, { from, to, drop, keep, tail, count }) {
  let { decoder } = await (decoders[format] ??= import(`@audio/decode/${format}`))
  let dec = await decoder()
  try {
    let r = dec.decode(bytesOf(path, from, to)), n = r.samplesDecoded ?? r.channelData[0]?.length ?? 0
    if (n !== count) return null
    let cut = (a, b) => r.channelData.map(c => c.slice(a, b))
    return [...cut(drop, drop + keep), ...tail ? cut(drop + keep, drop + keep + tail) : []]
  } finally { dec.free() }
}
