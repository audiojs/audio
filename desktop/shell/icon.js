// The app's icon, drawn as the audiojs logo is (~/projects/@audiojs/logo/logo.js): one sine cycle through a Hann
// window, −sin πx · (1 + cos πx) / 2 over −1…1, its lobes standing .94 of the half-width, filled from the axis out by
// the Bartlett gradient (white at the axis, fading linearly to nothing at the edge), the axis drawn across. White on
// nothing, its opacity the tone: the icon's ground (black) is the icon's own (Icon Composer's fill, or the .icns').
//   node desktop/shell/icon.js out.png [size=1024] [ground]   ground: a hex colour to draw on, none for transparent
import { writeFileSync } from 'node:fs'
import { deflateSync } from 'node:zlib'

const [out, size = 1024, ground] = [process.argv[2], +(process.argv[3] || 1024), process.argv[4]]
const N = size, cx = N / 2, cy = N / 2, half = N * .36, SS = 4
const PEAK = .94, H = PEAK / (3 * Math.sqrt(3) / 8)
const wave = x => Math.abs(x) <= 1 ? H * (1 + Math.cos(Math.PI * x)) / 2 * -Math.sin(Math.PI * x) : 0
const AXIS = N * .0045   // the axis' half-thickness, px
const bg = ground && ground !== 'none' ? [1, 3, 5].map(i => parseInt(ground.slice(i, i + 2), 16)) : null

const px = Buffer.alloc(N * N * 4)
for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
  let tone = 0
  for (let sj = 0; sj < SS; sj++) for (let si = 0; si < SS; si++) {
    const x = (i + (si + .5) / SS - cx) / half, y = (cy - (j + (sj + .5) / SS)) / half, h = wave(x)
    let v = 0
    if (h !== 0 && Math.sign(y) === Math.sign(h) && Math.abs(y) <= Math.abs(h)) v = 1 - Math.abs(y) / Math.abs(h)
    if (Math.abs(x) <= 1 && Math.abs(y) * half <= AXIS) v = 1
    tone += v
  }
  tone /= SS * SS
  const o = (j * N + i) * 4
  if (bg) { for (let c = 0; c < 3; c++) px[o + c] = Math.round(bg[c] + (255 - bg[c]) * tone); px[o + 3] = 255 }
  else px[o] = px[o + 1] = px[o + 2] = 255, px[o + 3] = Math.round(255 * tone)
}

// PNG: RGBA, each row filtered with none
const crc = b => { let c, t = crc.t ??= Array.from({ length: 256 }, (_, n) => { c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; return c >>> 0 }); c = ~0; for (const x of b) c = t[(c ^ x) & 255] ^ (c >>> 8); return ~c >>> 0 }
const chunk = (type, data) => { const len = Buffer.alloc(4), tc = Buffer.concat([Buffer.from(type), data]), sum = Buffer.alloc(4); len.writeUInt32BE(data.length); sum.writeUInt32BE(crc(tc)); return Buffer.concat([len, tc, sum]) }
const head = Buffer.alloc(13); head.writeUInt32BE(N, 0); head.writeUInt32BE(N, 4); head[8] = 8; head[9] = 6
const rows = Buffer.alloc(N * (N * 4 + 1)); for (let j = 0; j < N; j++) px.copy(rows, j * (N * 4 + 1) + 1, j * N * 4, (j + 1) * N * 4)
writeFileSync(out, Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', head), chunk('IDAT', deflateSync(rows)), chunk('IEND', Buffer.alloc(0))]))
